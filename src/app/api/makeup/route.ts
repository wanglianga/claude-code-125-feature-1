import { NextRequest } from 'next/server';
import { one, query, tx } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';
import {
  findMissingStudents, neededSizes, classPriority, sampleShortage, recomputeClass,
} from '@/lib/makeup';

// 缺测/补测总览：候选时段、补测学生、异常、班级正式数量重算
export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const planId = sp.get('plan_id');
  const classId = sp.get('class_id');

  const sWhere: string[] = [];
  const sArgs: any[] = [];
  if (planId) { sWhere.push('ms.plan_id=?'); sArgs.push(planId); }
  if (classId) { sWhere.push('ms.class_id=?'); sArgs.push(classId); }
  if (user.role === 'head_teacher') { sWhere.push('ms.teacher_user_id=?'); sArgs.push(user.id); }
  if (user.role === 'supplier' || user.role === 'factory') { sWhere.push('ms.supplier_id=?'); sArgs.push(user.supplier_id); }

  const sessions = await query(
    `SELECT ms.*, c.name class_name, cp.name campus_name, u.real_name teacher_name, p.name plan_name,
            p.production_deadline,
            (SELECT COUNT(*) FROM makeup_students mk WHERE mk.makeup_session_id=ms.id) student_cnt,
            (SELECT COUNT(*) FROM makeup_students mk WHERE mk.makeup_session_id=ms.id AND mk.status='closed') closed_cnt,
            (SELECT GROUP_CONCAT(CONCAT(sr.size,':',sr.status) SEPARATOR ';')
               FROM sample_reservations sr WHERE sr.makeup_session_id=ms.id) sample_holds
       FROM makeup_sessions ms
       JOIN classes c ON c.id=ms.class_id
       JOIN campuses cp ON cp.id=ms.campus_id
       JOIN users u ON u.id=ms.teacher_user_id
       JOIN plans p ON p.id=ms.plan_id
       ${sWhere.length ? 'WHERE ' + sWhere.join(' AND ') : ''}
       ORDER BY ms.priority_score DESC, ms.start_time`,
    sArgs);

  const mWhere: string[] = [];
  const mArgs: any[] = [];
  if (planId) { mWhere.push('mk.plan_id=?'); mArgs.push(planId); }
  if (classId) { mWhere.push('mk.class_id=?'); mArgs.push(classId); }
  if (user.role === 'head_teacher') { mWhere.push('c.teacher_user_id=?'); mArgs.push(user.id); }
  if (user.role === 'parent') { mWhere.push('s.parent_user_id=?'); mArgs.push(user.id); }
  if (user.role === 'supplier' || user.role === 'factory') { mWhere.push('p.supplier_id=?'); mArgs.push(user.supplier_id); }

  const students = await query(
    `SELECT mk.*, s.name student_name, s.student_no, s.parent_user_id,
            c.name class_name, cp.name campus_name, o.order_no, o.status order_status,
            o.size_lock, o.risk_placeholder, p.name plan_name, p.production_deadline
       FROM makeup_students mk
       JOIN students s ON s.id=mk.student_id
       JOIN classes c ON c.id=mk.class_id
       JOIN campuses cp ON cp.id=s.campus_id
       JOIN orders o ON o.id=mk.order_id
       JOIN plans p ON p.id=mk.plan_id
       ${mWhere.length ? 'WHERE ' + mWhere.join(' AND ') : ''}
       ORDER BY mk.class_id, mk.status, s.student_no`,
    mArgs);

  // 当前仍漏测（无任何试穿/补测记录）的学生，其中未挂到场次的可再次生成候选（generate 幂等）
  let missing: any[] = [];
  if (planId && user.role !== 'parent') {
    missing = await findMissingStudents(Number(planId), classId ? Number(classId) : undefined);
  }

  const eWhere: string[] = [];
  const eArgs: any[] = [];
  if (planId) { eWhere.push('me.plan_id=?'); eArgs.push(planId); }
  if (classId) { eWhere.push('me.class_id=?'); eArgs.push(classId); }
  if (user.role === 'supplier' || user.role === 'factory') { eWhere.push('p.supplier_id=?'); eArgs.push(user.supplier_id); }
  const exceptions = await query(
    `SELECT me.*, c.name class_name, s.name student_name, p.name plan_name,
            ur.real_name resolver_name
       FROM makeup_exceptions me
       LEFT JOIN classes c ON c.id=me.class_id
       LEFT JOIN students s ON s.id=me.student_id
       JOIN plans p ON p.id=me.plan_id
       LEFT JOIN users ur ON ur.id=me.resolved_by
       ${eWhere.length ? 'WHERE ' + eWhere.join(' AND ') : ''}
       ORDER BY (me.status='open') DESC, me.id DESC`,
    eArgs);

  // 班级正式数量重算（按当前排产口径，供班级进度/批次/到校承诺展示）
  const recomputes: any[] = [];
  const classIds = [...new Set([...sessions.map((x: any) => x.class_id), ...students.map((x: any) => x.class_id)])];
  for (const cid of classIds.slice(0, 20)) {
    const pid = planId ? Number(planId) : (sessions.find((x: any) => x.class_id === cid)?.plan_id as number);
    if (!pid) continue;
    recomputes.push({ class_id: cid, ...(await recomputeClass(pid, cid)) });
  }

  const summary = {
    risk: students.filter((s: any) => s.size_lock === 'risk_placeholder' || Number(s.risk_placeholder) === 1).length,
    review: students.filter((s: any) => s.size_lock === 'review').length,
    prelocked: students.filter((s: any) => s.size_lock === 'prelocked').length,
    locked: students.filter((s: any) => s.size_lock === 'locked').length,
    openExceptions: exceptions.filter((e: any) => e.status === 'open').length,
  };

  return ok({ sessions, students, missing, exceptions, recomputes, summary });
});

export const POST = api(async (_req: NextRequest, body: any, user) => {
  // 动作：generate 生成候选时段 / sweep 逾期巡检 / resolve_exception 异常闭环
  if (body.action === 'generate') return generate(body, user);
  if (body.action === 'sweep') return sweep(body, user);
  if (body.action === 'resolve_exception') return resolveException(body, user);
  return fail('未知操作');
}, ['head_teacher', 'general_affairs', 'admin']);

// 生成补测候选：按班级/校区/供应商样衣/班主任空闲，多班竞争按优先级
async function generate(body: any, user: any) {
  const planId = Number(body.plan_id);
  const plan = await one<any>('SELECT * FROM plans WHERE id=?', [planId]);
  if (!plan) return fail('订购计划不存在', 404);
  if (user.role === 'supplier' && plan.supplier_id !== user.supplier_id) return fail('无权限', 403);

  const missing = await findMissingStudents(planId, body.class_id ? Number(body.class_id) : undefined);
  if (!missing.length) return fail('没有漏测学生（均已完成试穿/补测）');

  // 1) 为漏测学生建立/补全补测台账，并把订单置为风险占位
  for (const m of missing) {
    const exist = await one('SELECT id FROM makeup_students WHERE plan_id=? AND student_id=?', [planId, m.student_id]);
    if (exist) continue;
    const firstOrder = await one(
      `SELECT COUNT(*) c FROM orders WHERE student_id=? AND status='paid'`, [m.student_id]);
    await tx(async (conn) => {
      await conn.query(
        `INSERT INTO makeup_students (makeup_session_id,plan_id,student_id,class_id,order_id,is_first_order,status)
         VALUES (NULL,?,?,?,?,?, 'pending_ref')`,
        [planId, m.student_id, m.class_id, m.order_id, Number(firstOrder?.c || 0) === 0 ? 1 : 0]);
      await conn.query(
        `UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1 WHERE id=? AND size_lock IN ('none','review')`,
        [m.order_id]);
    });
  }

  // 2) 按班级组织候选
  const byClass = new Map<number, any[]>();
  for (const m of missing) {
    if (!byClass.has(m.class_id)) byClass.set(m.class_id, []);
    byClass.get(m.class_id)!.push(m);
  }

  const created: any[] = [];
  const blocked: any[] = [];

  // 优先级高的班级先占用样衣/老师时段（多班竞争）
  const classEntries = [...byClass.entries()].map(([cid, rows]) => ({ cid, rows }));
  const scored = await Promise.all(classEntries.map(async (e) => ({
    ...e,
    score: await classPriority(planId, e.cid, e.rows.map((r) => r.student_id)),
  })));
  scored.sort((a, b) => b.score - a.score);

  for (const { cid, rows, score } of scored) {
    const cls = rows[0];
    const sizeMap = await neededSizes(rows.map((r) => r.student_id), planId);

    // 该班进行中的候选/已排补测（可能由上次生成覆盖了部分学生）
    const existing = await one<any>(
      `SELECT * FROM makeup_sessions WHERE plan_id=? AND class_id=? AND status IN ('candidate','scheduled')
       ORDER BY start_time LIMIT 1`, [planId, cid]);

    // 尚未挂到进行中场次的漏测学生
    let unattached = rows;
    if (existing) {
      const attached = await query<any>(
        `SELECT student_id FROM makeup_students WHERE makeup_session_id=?`, [existing.id]);
      const attachedIds = new Set(attached.map((x) => x.student_id));
      unattached = rows.filter((r) => !attachedIds.has(r.student_id));
    }
    if (!unattached.length) continue;

    const freeSlots = await query<any>(
      `SELECT * FROM teacher_availabilities
        WHERE teacher_user_id=? AND campus_id=? AND end_time > NOW()
        ORDER BY start_time`,
      [cls.teacher_user_id, cls.campus_id]);

    // 逐学生判断在某时段能否被样衣覆盖
    const coverAt = async (slot: any, sessionId?: number) => {
      const okRows: any[] = [];
      const shortRows: any[] = [];
      for (const r of unattached) {
        const need = sizeMap.get(r.student_id) || [];
        const short = await sampleShortage(cls.campus_id, plan.supplier_id, slot.start_time, slot.end_time, need, sessionId);
        (short.length ? shortRows : okRows).push({ r, need, short });
      }
      return { okRows, shortRows };
    };

    let slot: any = existing ? existing : null;
    let cover = existing
      ? await coverAt(existing, existing.id)
      : { okRows: [] as any[], shortRows: [] as any[] };

    if (!existing) {
      if (!freeSlots.length) {
        blocked.push({ class_id: cid, class_name: cls.class_name, reason: '班主任暂无可安排的空闲时间', need_sizes: [...new Set(unattached.flatMap((r) => sizeMap.get(r.student_id) || []))] });
        continue;
      }
      // 选择能覆盖最多学生的空闲时段（样衣竞争）
      let best: { slot: any; ok: number } | null = null;
      for (const fs2 of freeSlots) {
        const c = await coverAt(fs2);
        if (!best || c.okRows.length > best.ok) best = { slot: fs2, ok: c.okRows.length };
        if (c.shortRows.length === 0) { best = { slot: fs2, ok: c.okRows.length }; break; }
      }
      slot = best!.slot;
      cover = await coverAt(slot);
    }

    // 样衣不足的学生：可追溯异常（幂等 open）
    for (const { r, need, short } of cover.shortRows) {
      const dup = await one(
        `SELECT id FROM makeup_exceptions WHERE plan_id=? AND student_id=? AND type='sample_shortage' AND status='open'`,
        [planId, r.student_id]);
      if (!dup) {
        await query(
          `INSERT INTO makeup_exceptions (plan_id,class_id,student_id,makeup_session_id,type,detail,created_at)
           VALUES (?,?,?,?, 'sample_shortage', ?, NOW())`,
          [planId, cid, r.student_id, existing?.id || null,
           `补测样衣不足，缺尺码 ${short.join('/')}（需要 ${need.join('/')}），待供应商调拨后再排`]);
      }
      await query("UPDATE makeup_students SET status='sample_shortage' WHERE plan_id=? AND student_id=? AND status IN ('pending_ref','waiting')",
        [planId, r.student_id]);
    }
    if (cover.shortRows.length) {
      blocked.push({ class_id: cid, class_name: cls.class_name,
        reason: `部分学生样衣不足：${cover.shortRows.map((x) => x.r.student_name).join('、')}`,
        need_sizes: [...new Set(cover.shortRows.flatMap((x) => x.short))] });
    }
    if (!cover.okRows.length) continue;

    const needSizes = [...new Set(cover.okRows.flatMap((x) => x.need))];
    let sessionId = existing?.id;
    if (!sessionId) {
      sessionId = await tx(async (conn) => {
        const [r]: any = await conn.query(
          `INSERT INTO makeup_sessions
             (plan_id,class_id,campus_id,supplier_id,start_time,end_time,location,teacher_user_id,priority_score,status,created_by)
           VALUES (?,?,?,?,?,?,?,?,?, 'candidate', ?)`,
          [planId, cid, cls.campus_id, plan.supplier_id, slot.start_time, slot.end_time,
           `${cls.campus_name}补测室（候选）`, cls.teacher_user_id, score, user.id]);
        const sid = r.insertId;
        for (const z of needSizes) {
          await conn.query('INSERT INTO sample_reservations (makeup_session_id,size,qty,status) VALUES (?,?,1,\'reserved\')',
            [sid, z]);
        }
        return sid;
      });
    } else {
      // 挂入已有场次：补齐新尺码的样衣占用
      await tx(async (conn) => {
        for (const z of needSizes) {
          await conn.query(
            `INSERT IGNORE INTO sample_reservations (makeup_session_id,size,qty,status) VALUES (?,?,1,'reserved')`,
            [sessionId, z]);
        }
      });
    }
    // 关联可覆盖的补测学生
    await query(
      `UPDATE makeup_students SET makeup_session_id=?,
          status=CASE WHEN status IN ('sample_shortage','pending_ref') THEN IF(ref_submitted_at IS NULL,'pending_ref','waiting') ELSE status END
        WHERE plan_id=? AND class_id=? AND student_id IN (?)`,
      [sessionId, planId, cid, cover.okRows.map((x) => x.r.student_id)]);
    await logActivity({ actor: user, action: existing ? '补测候选补挂学生' : '生成补测候选时段',
      detail: `${cls.class_name} 优先级${score}：${slot.start_time}~${slot.end_time}，` +
        `覆盖学生 ${cover.okRows.map((x) => x.r.student_name).join('、')}，需样衣 ${needSizes.join('/')}` +
        (cover.shortRows.length ? `；样衣不足 ${cover.shortRows.map((x) => x.r.student_name).join('、')}` : '') });
    created.push({ session_id: sessionId, class_id: cid, class_name: cls.class_name, priority: score,
      covered: cover.okRows.map((x) => x.r.student_name), shortage: cover.shortRows.map((x) => x.r.student_name) });
  }

  return ok({ created, blocked });
}

// 逾期巡检：补测逾期 / 家长超时未确认 → 异常台账（幂等）
async function sweep(body: any, user: any) {
  const planId = body.plan_id ? Number(body.plan_id) : null;
  const args: any[] = [];
  let pw = '';
  if (planId) { pw = 'AND plan_id=?'; args.push(planId); }

  // 补测场次已过结束时间仍未完成
  const expired = await query<any>(
    `SELECT * FROM makeup_sessions WHERE status IN ('candidate','scheduled') AND end_time < NOW() ${pw}`, args);
  let overdueCnt = 0;
  for (const ms of expired) {
    await tx(async (conn) => {
      await conn.query("UPDATE makeup_sessions SET status='overdue' WHERE id=?", [ms.id]);
      await conn.query(
        `UPDATE makeup_students SET status='overdue'
          WHERE makeup_session_id=? AND status IN ('pending_ref','waiting','measured','teacher_done','sample_shortage')`,
        [ms.id]);
      const [dup]: any = await conn.query(
        `SELECT id FROM makeup_exceptions WHERE makeup_session_id=? AND type='makeup_overdue'`, [ms.id]);
      if (!dup.length) {
        await conn.query(
          `INSERT INTO makeup_exceptions (plan_id,class_id,makeup_session_id,type,detail,created_at)
           VALUES (?,?,?, 'makeup_overdue', ?, NOW())`,
          [ms.plan_id, ms.class_id, ms.id, `补测场次超过 ${ms.end_time} 仍未完成，学生未能闭环，转总务处理`]);
      }
    });
    overdueCnt++;
  }

  // 家长超过确认截止时间仍未确认最终尺码
  const timeouts = await query<any>(
    `SELECT * FROM makeup_students
      WHERE status='teacher_done' AND deadline IS NOT NULL AND deadline < NOW() ${pw}`, args);
  let timeoutCnt = 0;
  for (const mk of timeouts) {
    await tx(async (conn) => {
      await conn.query("UPDATE makeup_students SET status='parent_timeout' WHERE id=?", [mk.id]);
      await conn.query("UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1 WHERE id=?", [mk.order_id]);
      const [dup]: any = await conn.query(
        `SELECT id FROM makeup_exceptions WHERE makeup_student_id=? AND type='parent_timeout'`, [mk.id]);
      if (!dup.length) {
        await conn.query(
          `INSERT INTO makeup_exceptions (plan_id,class_id,makeup_session_id,makeup_student_id,student_id,type,detail,created_at)
           VALUES (?,?,?,?,?, 'parent_timeout', ?, NOW())`,
          [mk.plan_id, mk.class_id, mk.makeup_session_id, mk.id, mk.student_id,
           `班主任已确认测量记录，家长超过 ${mk.deadline} 仍未确认最终尺码，订单保持风险占位`]);
      }
    });
    timeoutCnt++;
  }
  if (overdueCnt || timeoutCnt) {
    await logActivity({ actor: user, action: '补测逾期巡检',
      detail: `补测逾期场次 ${overdueCnt}，家长超时未确认 ${timeoutCnt}` });
  }
  return ok({ overdue_sessions: overdueCnt, parent_timeouts: timeoutCnt });
}

async function resolveException(body: any, user: any) {
  const ex = await one<any>('SELECT * FROM makeup_exceptions WHERE id=?', [body.id]);
  if (!ex) return fail('异常不存在', 404);
  await query(
    `UPDATE makeup_exceptions SET status='resolved', resolved_by=?, resolved_at=NOW(), resolution=? WHERE id=?`,
    [user.id, body.resolution || '已人工处理', body.id]);
  await logActivity({ student_id: ex.student_id, actor: user, action: '补测异常闭环',
    detail: `${ex.type}：${body.resolution || '已人工处理'}` });
  return ok();
}
