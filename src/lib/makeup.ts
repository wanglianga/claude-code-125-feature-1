// 集中试穿漏测：补测与生产锁定 领域逻辑
import { one, query, tx } from './db';
import { logActivity, genNo } from './api';
import type { SessionUser } from './auth';

export const GARMENTS = ['top', 'pants', 'skirt', 'coat', 'shoes'] as const;
export type Garment = (typeof GARMENTS)[number];
export const GARMENT_COL: Record<Garment, string> = {
  top: 'top', pants: 'pants', skirt: 'skirt', coat: 'coat', shoes: 'shoes',
};

export function sizeFromRow(r: any, prefix: string): Record<Garment, string | null> {
  return {
    top: r[`${prefix}_size_top`] ?? null,
    pants: r[`${prefix}_size_pants`] ?? null,
    skirt: r[`${prefix}_size_skirt`] ?? null,
    coat: r[`${prefix}_size_coat`] ?? null,
    shoes: r[`${prefix}_size_shoes`] ?? null,
  };
}

export function sizesEqual(a: Record<Garment, string | null>, b: Record<Garment, string | null>) {
  return GARMENTS.every((g) => (a[g] || '') === (b[g] || ''));
}

export const MK_STATUS_LABELS: Record<string, string> = {
  need_makeup: '待补测',
  referenced: '已交参考尺码(风险占位)',
  scheduled: '补测已安排',
  measured: '班主任已确认测量',
  locked: '尺码已锁定',
  review: '两次确认不一致·待复核',
  prelocked: '已按参考尺码预锁',
  deferred: '已延后',
};

// 是否首次订购：该生在其他计划中没有过有效订单
export async function computeFirstOrder(studentId: number, planId: number) {
  const r = await one<any>(
    `SELECT COUNT(*) n FROM orders o
      WHERE o.student_id=? AND o.plan_id<>? AND o.status<>'cancelled'`,
    [studentId, planId]);
  return Number(r?.n || 0) === 0 ? 1 : 0;
}

// 登记漏测学生：覆盖班级内有有效订单、但本计划无任何试穿记录的在校学生
export async function registerMissing(planId: number, classId?: number) {
  const rows = await query<any>(
    `SELECT s.id student_id, s.class_id, o.id order_id
       FROM students s
       JOIN orders o ON o.student_id=s.id AND o.plan_id=? AND o.status<>'cancelled'
      WHERE s.status='active'
        ${classId ? 'AND s.class_id=?' : ''}
        AND NOT EXISTS (
          SELECT 1 FROM fitting_records fr JOIN fitting_sessions fs ON fs.id=fr.session_id
           WHERE fr.student_id=s.id AND fs.plan_id=?)`,
    classId ? [planId, classId, planId] : [planId, planId]);

  let created = 0;
  for (const r of rows) {
    const exist = await one('SELECT id FROM makeup_students WHERE plan_id=? AND student_id=?', [planId, r.student_id]);
    if (exist) continue;
    const first = await computeFirstOrder(r.student_id, planId);
    // 以订单明细现有尺码作为家长最初提交的参考尺码
    const items = await query<any>('SELECT garment_type, size FROM order_items WHERE order_id=?', [r.order_id]);
    const ref: any = { top: null, pants: null, skirt: null, coat: null, shoes: null };
    for (const it of items) if (ref[it.garment_type] === null) ref[it.garment_type] = it.size;
    await tx(async (conn) => {
      await conn.query(
        `INSERT INTO makeup_students
          (plan_id,student_id,class_id,order_id,is_first_order,status,
           ref_size_top,ref_size_pants,ref_size_skirt,ref_size_coat,ref_size_shoes,ref_submitted_at)
         VALUES (?,?,?,?,?, 'referenced', ?,?,?,?, NOW())`,
        [planId, r.student_id, r.class_id, r.order_id, first,
         ref.top, ref.pants, ref.skirt, ref.coat, ref.shoes]);
      // 参考尺码 = 风险占位，供应商不能计入正式数量
      await conn.query("UPDATE orders SET production_lock='placeholder' WHERE id=? AND production_lock='none'", [r.order_id]);
    });
    created++;
  }
  return { registered: created, candidates: rows.length };
}

// 班级在该计划的已确认人数（家长已确认/已缴费/待复核）
async function classConfirmedCount(planId: number, classId: number) {
  const r = await one<any>(
    `SELECT COUNT(*) n FROM orders o
      WHERE o.plan_id=? AND o.class_id=? AND o.status IN ('confirmed','paid','review')`,
    [planId, classId]);
  return Number(r?.n || 0);
}

async function classSetting(planId: number, classId: number) {
  return one<any>('SELECT * FROM class_production_settings WHERE plan_id=? AND class_id=?', [planId, classId]);
}

// 补测班级需要的样衣：按 plan_item+尺码 汇总人数（仅尚未安排补测场的漏测学生）
async function classSampleNeeds(planId: number, classId: number) {
  const rows = await query<any>(
    `SELECT oi.plan_item_id, oi.garment_type, oi.size, COUNT(DISTINCT oi.order_id) need_qty
       FROM makeup_students mk
       JOIN order_items oi ON oi.order_id=mk.order_id
      WHERE mk.plan_id=? AND mk.class_id=?
        AND mk.status IN ('need_makeup','referenced')
      GROUP BY oi.plan_item_id, oi.size`,
    [planId, classId]);
  return rows;
}

// 某样衣在指定时间窗内的可用量：总量 - 时间重叠的、已确认/调整中的其他补测场占用
async function sampleAvailableAt(stockId: number, start: string, end: string, excludeSessionId?: number) {
  const st = await one<any>('SELECT * FROM sample_stocks WHERE id=?', [stockId]);
  if (!st) return { total: 0, held: 0, avail: 0 };
  const held = await one<any>(
    `SELECT COALESCE(SUM(sr.qty),0) held
       FROM sample_reservations sr
       JOIN makeup_sessions ms ON ms.id=sr.makeup_session_id
      WHERE sr.sample_stock_id=? AND sr.status='held'
        AND ms.status IN ('confirmed','adjusted')
        AND ms.start_time < ? AND ms.end_time > ?
        ${excludeSessionId ? 'AND ms.id<>?' : ''}`,
    excludeSessionId ? [stockId, end, start, excludeSessionId] : [stockId, end, start]);
  const heldQty = Number(held?.held || 0);
  return { total: Number(st.total_qty), held: heldQty, avail: Number(st.total_qty) - heldQty };
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// 优先级：生产截止日越近越高、首次订购人数越多越高、已确认人数越多越高
async function priorityScore(planId: number, classId: number) {
  const plan = await one<any>('SELECT * FROM plans WHERE id=?', [planId]);
  const setting = await classSetting(planId, classId);
  const deadline = setting?.production_deadline || plan?.order_deadline;
  const firstCnt = Number((await one<any>(
    'SELECT COUNT(*) n FROM makeup_students WHERE plan_id=? AND class_id=? AND is_first_order=1',
    [planId, classId]))?.n || 0);
  const confirmedCnt = await classConfirmedCount(planId, classId);
  const now = new Date();
  const dlDate = deadline ? new Date(String(deadline).replace(' ', 'T')) : now;
  const days = deadline ? daysBetween(now, dlDate) : 30;
  const deadlineScore = Math.max(0, 30 - days) * 100;
  const score = deadlineScore + firstCnt * 20 + confirmedCnt * 5;
  const detail = `距生产截止日 ${days} 天（${deadline || '未设置'}，${deadlineScore} 分）；首次订购 ${firstCnt} 人（${firstCnt * 20} 分）；已确认 ${confirmedCnt} 人（${confirmedCnt * 5} 分）`;
  return { score, detail, deadline, firstCnt, confirmedCnt, days };
}

// 生成某班补测候选时段（重算并以 status=candidate 落库，便于多班竞争可见）
export async function generateCandidates(planId: number, classId: number) {
  await registerMissing(planId, classId);
  const cls = await one<any>(
    `SELECT c.*, g.campus_id FROM classes c JOIN grades g ON g.id=c.grade_id WHERE c.id=?`, [classId]);
  if (!cls) throw Object.assign(new Error('班级不存在'), { status: 404 });
  const mkStudents = await query<any>(
    `SELECT mk.* FROM makeup_students mk
      WHERE mk.plan_id=? AND mk.class_id=? AND mk.status IN ('need_makeup','referenced')`,
    [planId, classId]);
  if (!mkStudents.length) return { candidates: [], message: '该班暂无待安排补测场的漏测学生（可能已安排/已闭环）' };

  const needs = await classSampleNeeds(planId, classId);
  const slots = await query<any>(
    `SELECT * FROM teacher_slots
      WHERE teacher_user_id=? AND campus_id=? AND end_time >= NOW()
      ORDER BY start_time`,
    [cls.teacher_user_id, cls.campus_id]);

  // 清理该班旧的候选（未被确认的候选重算）
  await query(
    `DELETE FROM makeup_sessions WHERE plan_id=? AND class_id=? AND status='candidate'`, [planId, classId]);
  if (!slots.length) return { candidates: [], message: '班主任尚未维护空闲时段，无法生成候选' };

  const { score, detail, deadline, firstCnt, confirmedCnt, days } = await priorityScore(planId, classId);

  const candidates: any[] = [];
  for (const sl of slots) {
    const shortages: any[] = [];
    for (const n of needs) {
      const stock = await one<any>(
        'SELECT * FROM sample_stocks WHERE plan_id=? AND campus_id=? AND plan_item_id=? AND size=?',
        [planId, cls.campus_id, n.plan_item_id, n.size]);
      if (!stock) {
        shortages.push({ plan_item_id: n.plan_item_id, size: n.size, need: n.need_qty, avail: 0, reason: '供应商未配备该尺码样衣' });
        continue;
      }
      const a = await sampleAvailableAt(stock.id, sl.start_time, sl.end_time);
      if (a.avail < n.need_qty) {
        shortages.push({ plan_item_id: n.plan_item_id, size: n.size, need: n.need_qty, avail: a.avail, total: a.total, held: a.held, reason: `可用 ${a.avail} < 需 ${n.need_qty}` });
      }
    }
    // 同校区、时间重叠、需要相同样衣的其他班级竞争方
    const competing = await query<any>(
      `SELECT ms.id, ms.class_id, c.name class_name, ms.status, ms.priority_score,
              ms.start_time, ms.end_time
         FROM makeup_sessions ms JOIN classes c ON c.id=ms.class_id
        WHERE ms.plan_id=? AND ms.class_id<>? AND ms.status IN ('candidate','confirmed','adjusted')
          AND ms.start_time < ? AND ms.end_time > ?
        ORDER BY ms.priority_score DESC`,
      [planId, classId, sl.end_time, sl.start_time]);

    const r = await query(
      `INSERT INTO makeup_sessions
        (makeup_no,plan_id,class_id,campus_id,supplier_id,start_time,end_time,location,organizer_user_id,
         status,priority_score,priority_detail,created_by)
       SELECT ?,?,?,?, p.supplier_id, ?,?,?,?, 'candidate', ?, ?, NULL
         FROM plans p WHERE p.id=?`,
      [genNo('MK'), planId, classId, cls.campus_id,
       sl.start_time, sl.end_time, sl.location || '待定', cls.teacher_user_id,
       score, detail, planId]);
    candidates.push({
      id: (r as any).insertId,
      start_time: sl.start_time, end_time: sl.end_time, location: sl.location || '待定',
      feasible: shortages.length === 0, shortages,
      priority_score: score, priority_detail: detail,
      factors: { deadline, days, first_order: firstCnt, confirmed: confirmedCnt },
      competing: competing.map((x) => ({ ...x, higher: Number(x.priority_score) > score })),
    });
  }

  // 所有候选都不可行且确实缺样衣 → 形成可追溯的样衣不足异常
  const hasShortage = candidates.some((c) => c.shortages.length > 0);
  if (hasShortage) {
    const open = await one(
      `SELECT id FROM makeup_exceptions
        WHERE type='sample_shortage' AND plan_id=? AND class_id=? AND status IN ('open','acknowledged')`,
      [planId, classId]);
    if (!open) {
      const worst = candidates.flatMap((c) => c.shortages.map((s: any) => `时段${c.start_time} 尺码${s.size} 需${s.need} 可用${s.avail}`));
      await query(
        `INSERT INTO makeup_exceptions (exc_no,type,status,plan_id,class_id,detail,raised_by)
         VALUES (?, 'sample_shortage','open',?,?,?, 'system')`,
        [genNo('EX'), planId, classId, `补测样衣不足：${worst.slice(0, 6).join('；')}`]);
    }
  }
  return { candidates };
}

// 确认候选场：原子校验样衣与竞争，建补测试穿场（fitting_sessions kind=makeup）并占用样衣
export async function confirmCandidate(sessionId: number, user: SessionUser) {
  return tx(async (conn) => {
    const ms = await one<any>('SELECT * FROM makeup_sessions WHERE id=? FOR UPDATE', [sessionId]);
    if (!ms) throw Object.assign(new Error('补测候选不存在'), { status: 404 });
    if (ms.status !== 'candidate') throw Object.assign(new Error('该候选已处理，不能重复确认'), { status: 400 });

    const needs = await conn.query(
      `SELECT oi.plan_item_id, oi.size, COUNT(DISTINCT oi.order_id) need_qty
         FROM makeup_students mk JOIN order_items oi ON oi.order_id=mk.order_id
        WHERE mk.plan_id=? AND mk.class_id=? AND mk.status IN ('need_makeup','referenced')
        GROUP BY oi.plan_item_id, oi.size`,
      [ms.plan_id, ms.class_id]);
    const needRows: any[] = needs[0] as any[];
    for (const n of needRows) {
      const [stRows]: any = await conn.query(
        'SELECT * FROM sample_stocks WHERE plan_id=? AND campus_id=? AND plan_item_id=? AND size=? FOR UPDATE',
        [ms.plan_id, ms.campus_id, n.plan_item_id, n.size]);
      const stock = stRows[0];
      if (!stock) throw Object.assign(new Error(`样衣缺失：品类#${n.plan_item_id} 尺码 ${n.size} 未配备`), { status: 400 });
      const [heldRows]: any = await conn.query(
        `SELECT COALESCE(SUM(sr.qty),0) held FROM sample_reservations sr
           JOIN makeup_sessions o ON o.id=sr.makeup_session_id
          WHERE sr.sample_stock_id=? AND sr.status='held' AND o.status IN ('confirmed','adjusted')
            AND o.start_time < ? AND o.end_time > ?`,
        [stock.id, ms.end_time, ms.start_time]);
      const held = Number(heldRows[0].held);
      if (Number(stock.total_qty) - held < Number(n.need_qty)) {
        throw Object.assign(new Error(`样衣竞争冲突：品类#${n.plan_item_id} 尺码 ${n.size} 仅剩 ${Number(stock.total_qty) - held} 件，需 ${n.need_qty} 件，请选择其他候选时段或改期`), { status: 409 });
      }
    }

    await conn.query(
      `UPDATE makeup_sessions SET status='confirmed', confirmed_at=NOW() WHERE id=?`, [ms.id]);
    const [fsR]: any = await conn.query(
      `INSERT INTO fitting_sessions (plan_id,class_id,kind,makeup_session_id,start_time,end_time,location,organizer_user_id)
       VALUES (?,?, 'makeup', ?,?,?,?,?)`,
      [ms.plan_id, ms.class_id, ms.id, ms.start_time, ms.end_time, ms.location, ms.organizer_user_id || user.id]);
    for (const n of needRows) {
      const [stRows]: any = await conn.query(
        'SELECT id FROM sample_stocks WHERE plan_id=? AND campus_id=? AND plan_item_id=? AND size=?',
        [ms.plan_id, ms.campus_id, n.plan_item_id, n.size]);
      await conn.query(
        'INSERT INTO sample_reservations (makeup_session_id,sample_stock_id,qty) VALUES (?,?,?)',
        [ms.id, stRows[0].id, n.need_qty]);
    }
    await conn.query(
      `UPDATE makeup_students SET makeup_session_id=?, status='scheduled'
        WHERE plan_id=? AND class_id=? AND status IN ('need_makeup','referenced')`,
      [ms.id, ms.plan_id, ms.class_id]);
    await logActivity({ actor: user, action: '确认补测候选时段', detail: `${ms.start_time} @ ${ms.location}（优先级 ${ms.priority_score}）` });
    return { id: ms.id, fitting_session_id: fsR.insertId };
  });
}

// 人工调整补测场（必须留原因），重建样衣占用
export async function adjustSession(sessionId: number, body: any, user: SessionUser) {
  if (!body.reason) throw Object.assign(new Error('人工调整必须填写原因'), { status: 400 });
  return tx(async (conn) => {
    const ms = await one<any>('SELECT * FROM makeup_sessions WHERE id=? FOR UPDATE', [sessionId]);
    if (!ms) throw Object.assign(new Error('补测场不存在'), { status: 404 });
    if (!['confirmed', 'adjusted'].includes(ms.status)) throw Object.assign(new Error('仅已确认的补测场可调整'), { status: 400 });
    const start = body.start_time || ms.start_time, end = body.end_time || ms.end_time;
    const location = body.location || ms.location;
    const [resRows]: any = await conn.query(
      "SELECT * FROM sample_reservations WHERE makeup_session_id=? AND status='held'", [ms.id]);
    const reservations: any[] = resRows;
    // 原占用保持 held，仅校验新时间窗内「其他场次」是否挤占了样衣（自身占用不参与冲突计算）
    for (const sr of reservations) {
      const [heldRows]: any = await conn.query(
        `SELECT COALESCE(SUM(x.qty),0) held FROM sample_reservations x
           JOIN makeup_sessions o ON o.id=x.makeup_session_id
          WHERE x.sample_stock_id=? AND x.status='held' AND o.status IN ('confirmed','adjusted')
            AND o.start_time < ? AND o.end_time > ? AND o.id<>?`,
        [sr.sample_stock_id, end, start, ms.id]);
      const [stRows]: any = await conn.query('SELECT total_qty FROM sample_stocks WHERE id=?', [sr.sample_stock_id]);
      if (Number(stRows[0].total_qty) - Number(heldRows[0].held) < sr.qty) {
        throw Object.assign(new Error('调整后的时段样衣被更高优先级班级占用，无法调整'), { status: 409 });
      }
    }
    await conn.query(
      `UPDATE makeup_sessions SET start_time=?,end_time=?,location=?,status='adjusted',manual_adjust_reason=? WHERE id=?`,
      [start, end, location, body.reason, ms.id]);
    await conn.query('UPDATE fitting_sessions SET start_time=?,end_time=?,location=? WHERE makeup_session_id=?',
      [start, end, location, ms.id]);
    await logActivity({ actor: user, action: '人工调整补测场', detail: `原因：${body.reason}；改为 ${start} @ ${location}` });
    return { id: ms.id };
  });
}

// 完成补测场：释放样衣
export async function completeSession(sessionId: number, user: SessionUser) {
  return tx(async (conn) => {
    const ms = await one<any>('SELECT * FROM makeup_sessions WHERE id=?', [sessionId]);
    if (!ms) throw Object.assign(new Error('补测场不存在'), { status: 404 });
    if (!['confirmed', 'adjusted'].includes(ms.status)) throw Object.assign(new Error('当前状态不能完成补测'), { status: 400 });
    await conn.query("UPDATE makeup_sessions SET status='completed', completed_at=NOW() WHERE id=?", [ms.id]);
    await conn.query("UPDATE sample_reservations SET status='released' WHERE makeup_session_id=?", [ms.id]);
    await logActivity({ actor: user, action: '完成补测场', detail: `${ms.start_time} @ ${ms.location}` });
    return { id: ms.id };
  });
}

export async function cancelSession(sessionId: number, reason: string, user: SessionUser) {
  if (!reason) throw Object.assign(new Error('取消需填写原因'), { status: 400 });
  return tx(async (conn) => {
    const ms = await one<any>('SELECT * FROM makeup_sessions WHERE id=?', [sessionId]);
    if (!ms) throw Object.assign(new Error('补测场不存在'), { status: 404 });
    if (ms.status === 'completed') throw Object.assign(new Error('已完成场不能取消'), { status: 400 });
    await conn.query("UPDATE makeup_sessions SET status='cancelled', cancelled_at=NOW(), cancel_reason=? WHERE id=?", [reason, ms.id]);
    await conn.query("UPDATE sample_reservations SET status='released' WHERE makeup_session_id=?", [ms.id]);
    // 仅把尚未推进（已安排但未测量）的学生退回待补测；已测量/锁定的学生保留链路留痕
    await conn.query(
      `UPDATE makeup_students SET makeup_session_id=NULL, status='referenced'
        WHERE makeup_session_id=? AND status='scheduled'`, [ms.id]);
    await logActivity({ actor: user, action: '取消补测场', detail: reason });
    return { id: ms.id };
  });
}

// 班级生产数量重算（用于把"选择及影响"写入订单/班级进度）
export async function classProductionSummary(planId: number, classId: number) {
  const rows = await query<any>(
    `SELECT o.production_lock, o.status,
            COUNT(DISTINCT o.id) orders,
            COALESCE(SUM(oi.qty),0) qty
       FROM orders o JOIN order_items oi ON oi.order_id=o.id
      WHERE o.plan_id=? AND o.class_id=? AND o.status<>'cancelled'
      GROUP BY o.production_lock, o.status`,
    [planId, classId]);
  const sum = {
    formal_orders: 0, formal_qty: 0,
    locked_orders: 0, prelocked_orders: 0,
    placeholder_orders: 0, placeholder_qty: 0,
    review_orders: 0, deferred_orders: 0,
  };
  for (const r of rows) {
    if (r.status === 'review') sum.review_orders += Number(r.orders);
    if (r.production_lock === 'placeholder') { sum.placeholder_orders += Number(r.orders); sum.placeholder_qty += Number(r.qty); }
    if (r.production_lock === 'deferred') sum.deferred_orders += Number(r.orders);
    if (r.production_lock === 'locked' && r.status === 'paid') { sum.locked_orders += Number(r.orders); sum.formal_orders += Number(r.orders); sum.formal_qty += Number(r.qty); }
    if (r.production_lock === 'prelocked' && r.status === 'paid') { sum.prelocked_orders += Number(r.orders); sum.formal_orders += Number(r.orders); sum.formal_qty += Number(r.qty); }
    if (r.production_lock === 'none' && r.status === 'paid') { sum.formal_orders += Number(r.orders); sum.formal_qty += Number(r.qty); }
  }
  return sum;
}

async function impactText(planId: number, classId: number, studentName: string, action: string) {
  const s = await classProductionSummary(planId, classId);
  const setting = await classSetting(planId, classId);
  return `${studentName}${action}；重算班级数量：正式可生产 ${s.formal_orders} 单/${s.formal_qty} 件（锁定 ${s.locked_orders}、预锁 ${s.prelocked_orders}），风险占位 ${s.placeholder_orders} 单/${s.placeholder_qty} 件不计入，待复核 ${s.review_orders}，延后 ${s.deferred_orders}；生产批次按正式数量重排，到校承诺 ${setting?.promised_arrival || '待重算'}`;
}

// 通用：锁定订单（把最终尺码写入订单明细）
async function lockOrder(conn: any, mk: any, sizes: Record<Garment, string | null>) {
  for (const g of GARMENTS) {
    const z = sizes[g];
    if (z) await conn.query('UPDATE order_items SET size=? WHERE order_id=? AND garment_type=?', [z, mk.order_id, g]);
  }
  const restore = Number((await one<any>('SELECT paid_amount FROM orders WHERE id=?', [mk.order_id]))?.paid_amount || 0) > 0 ? 'paid' : 'confirmed';
  await conn.query("UPDATE orders SET production_lock='locked', status=? WHERE id=?", [restore, mk.order_id]);
}

// 学生闭环（锁定）后关闭其开放/已知晓的异常（含退回重测后再次确认一致的不一致异常）
async function closeStudentOpenExceptions(conn: any, studentId: number, user: SessionUser, resolution: string) {
  await conn.query(
    `UPDATE makeup_exceptions SET status='resolved', resolved_by=?, resolved_at=NOW(), resolution=?
      WHERE student_id=? AND status<>'resolved'
        AND type IN ('makeup_overdue','teacher_timeout','parent_timeout','deadline_open','size_mismatch')`,
    [user.id, resolution, studentId]);
}

// 家长提交参考尺码（补测前唯一允许的尺码动作）
export async function submitReference(mkId: number, sizes: Record<string, string>, user: SessionUser) {
  const mk = await one<any>('SELECT * FROM makeup_students WHERE id=?', [mkId]);
  if (!mk) throw Object.assign(new Error('补测记录不存在'), { status: 404 });
  if (['locked', 'prelocked'].includes(mk.status)) throw Object.assign(new Error('已锁定，不能再修改参考尺码'), { status: 400 });
  await tx(async (conn) => {
    await conn.query(
      `UPDATE makeup_students SET ref_size_top=?,ref_size_pants=?,ref_size_skirt=?,ref_size_coat=?,ref_size_shoes=?,
         ref_submitted_at=NOW(), status='referenced' WHERE id=?`,
      [sizes.top || null, sizes.pants || null, sizes.skirt || null, sizes.coat || null, sizes.shoes || null, mkId]);
    for (const g of GARMENTS) {
      if (sizes[g]) await conn.query('UPDATE order_items SET size=? WHERE order_id=? AND garment_type=?', [sizes[g], mk.order_id, g]);
    }
    await conn.query("UPDATE orders SET production_lock='placeholder' WHERE id=? AND production_lock IN ('none','deferred')", [mk.order_id]);
  });
  const st = await one<any>('SELECT name FROM students WHERE id=?', [mk.student_id]);
  await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: '家长提交参考尺码（风险占位）', detail: `上衣${sizes.top || '-'} 裤${sizes.pants || '-'}` });
  return { id: mkId };
}

// 班主任录入补测测量（同步一条 fitting_records）
export async function teacherRecord(mkId: number, body: any, user: SessionUser) {
  const mk = await one<any>('SELECT * FROM makeup_students WHERE id=?', [mkId]);
  if (!mk) throw Object.assign(new Error('补测记录不存在'), { status: 404 });
  if (!['scheduled', 'measured'].includes(mk.status)) throw Object.assign(new Error('当前状态不能录入测量'), { status: 400 });
  if (!mk.makeup_session_id) throw Object.assign(new Error('该生尚未安排补测场'), { status: 400 });
  await tx(async (conn) => {
    await conn.query(
      `UPDATE makeup_students SET m_size_top=?,m_size_pants=?,m_size_skirt=?,m_size_coat=?,m_size_shoes=?,
         m_staff_name=?,m_special_note=?,m_recorded_at=NOW() WHERE id=?`,
      [body.size_top || null, body.size_pants || null, body.size_skirt || null, body.size_coat || null, body.size_shoes || null,
       body.staff_name || user.real_name, body.special_note || null, mkId]);
    // 同步一条补测场（fitting_sessions kind=makeup）的试穿记录
    const fs = await one<any>('SELECT id FROM fitting_sessions WHERE makeup_session_id=?', [mk.makeup_session_id]);
    if (fs) {
      const old = await one<any>('SELECT id FROM fitting_records WHERE session_id=? AND student_id=?', [fs.id, mk.student_id]);
      if (old) {
        await conn.query(
          `UPDATE fitting_records SET staff_name=?,size_top=?,size_pants=?,size_skirt=?,size_coat=?,size_shoes=?,special_note=? WHERE id=?`,
          [body.staff_name || user.real_name, body.size_top || null, body.size_pants || null, body.size_skirt || null,
           body.size_coat || null, body.size_shoes || null, body.special_note || null, old.id]);
      } else {
        await conn.query(
          `INSERT INTO fitting_records (session_id,student_id,staff_name,size_top,size_pants,size_skirt,size_coat,size_shoes,special_note)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [fs.id, mk.student_id, body.staff_name || user.real_name, body.size_top || null, body.size_pants || null,
           body.size_skirt || null, body.size_coat || null, body.size_shoes || null, body.special_note || null]);
      }
    }
  });
  await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: '班主任录入补测测量', detail: `上衣${body.size_top || '-'} 裤${body.size_pants || '-'}` });
  return { id: mkId };
}

// 班主任确认测量记录（家长最终确认的前置）
export async function teacherConfirm(mkId: number, user: SessionUser) {
  const mk = await one<any>('SELECT * FROM makeup_students WHERE id=?', [mkId]);
  if (!mk) throw Object.assign(new Error('补测记录不存在'), { status: 404 });
  if (!mk.m_recorded_at) throw Object.assign(new Error('请先录入测量记录再确认'), { status: 400 });
  if (!['scheduled', 'measured'].includes(mk.status)) throw Object.assign(new Error('当前状态不能确认测量'), { status: 400 });
  await tx(async (conn) => {
    await conn.query(`UPDATE makeup_students SET m_confirmed_at=NOW(), m_confirmed_by=?, status='measured' WHERE id=?`, [user.id, mkId]);
  });
  await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: '班主任确认测量记录', detail: '家长可进行最终尺码确认' });
  return { id: mkId };
}

// 家长最终确认：与班主任测量一致 → 锁定；不一致 → 订单待复核（供应商不能锁定生产）
export async function parentConfirm(mkId: number, sizes: Record<string, string>, user: SessionUser) {
  const mk = await one<any>('SELECT * FROM makeup_students WHERE id=?', [mkId]);
  if (!mk) throw Object.assign(new Error('补测记录不存在'), { status: 404 });
  if (!mk.m_confirmed_at) throw Object.assign(new Error('班主任尚未确认测量记录'), { status: 400 });
  if (mk.status !== 'measured') throw Object.assign(new Error('当前状态不能进行家长最终确认'), { status: 400 });
  const finalSizes: Record<Garment, string | null> = {
    top: sizes.top || null, pants: sizes.pants || null, skirt: sizes.skirt || null,
    coat: sizes.coat || null, shoes: sizes.shoes || null,
  };
  const measured = sizeFromRow(mk, 'm');
  const mismatch = !sizesEqual(finalSizes, measured);
  await tx(async (conn) => {
    await conn.query(
      `UPDATE makeup_students SET f_size_top=?,f_size_pants=?,f_size_skirt=?,f_size_coat=?,f_size_shoes=?,
         f_confirmed_at=NOW(),f_confirmed_by=?,mismatch=? WHERE id=?`,
      [finalSizes.top, finalSizes.pants, finalSizes.skirt, finalSizes.coat, finalSizes.shoes, user.id, mismatch ? 1 : 0, mkId]);
    if (mismatch) {
      await conn.query("UPDATE makeup_students SET status='review' WHERE id=?", [mkId]);
      await conn.query("UPDATE orders SET status='review' WHERE id=?", [mk.order_id]);
      const open = await one('SELECT id FROM makeup_exceptions WHERE type=\'size_mismatch\' AND student_id=? AND status IN (\'open\',\'acknowledged\')', [mk.student_id]);
      if (!open) {
        await conn.query(
          `INSERT INTO makeup_exceptions (exc_no,type,status,plan_id,class_id,student_id,makeup_session_id,detail,raised_by)
           VALUES (?, 'size_mismatch','open',?,?,?,?,?, 'system')`,
          [genNo('EX'), mk.plan_id, mk.class_id, mk.student_id, mk.makeup_session_id,
           `班主任测量[上${measured.top || '-'} 裤${measured.pants || '-'} 鞋${measured.shoes || '-'}] 与家长确认[上${finalSizes.top || '-'} 裤${finalSizes.pants || '-'} 鞋${finalSizes.shoes || '-'}]不一致`]);
      }
      await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: '两次确认不一致·订单待复核', detail: '供应商不能锁定生产，等待总务复核' });
    } else {
      await conn.query("UPDATE makeup_students SET status='locked' WHERE id=?", [mkId]);
      await lockOrder(conn, mk, finalSizes);
      await closeStudentOpenExceptions(conn, mk.student_id, user, '两次确认一致，尺码正式锁定');
      await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: '家长最终确认尺码一致·正式锁定', detail: `上衣${finalSizes.top || '-'} 裤${finalSizes.pants || '-'}` });
    }
  });
  return { id: mkId, mismatch };
}

// 总务复核裁决
export async function reviewDecision(mkId: number, decision: string, reason: string, user: SessionUser) {
  if (!reason) throw Object.assign(new Error('复核裁决必须填写原因'), { status: 400 });
  const mk = await one<any>('SELECT * FROM makeup_students WHERE id=?', [mkId]);
  if (!mk) throw Object.assign(new Error('补测记录不存在'), { status: 404 });
  if (mk.status !== 'review') throw Object.assign(new Error('仅待复核记录可裁决'), { status: 400 });
  const resolutionMap: any = { use_teacher: 'review_teacher', use_parent: 'review_parent', remeasure: 'review_remeasure' };
  await tx(async (conn) => {
    if (decision === 'remeasure') {
      await conn.query(
        `UPDATE makeup_students SET status='scheduled', review_resolution='remeasure',
           decision_reason=?, decided_by=?, decided_at=NOW(),
           m_confirmed_at=NULL, m_confirmed_by=NULL, f_confirmed_at=NULL, f_confirmed_by=NULL WHERE id=?`,
        [reason, user.id, mkId]);
    } else {
      const sizes = decision === 'use_teacher' ? sizeFromRow(mk, 'm') : sizeFromRow(mk, 'f');
      const resolution = decision === 'use_teacher' ? 'use_teacher' : 'use_parent';
      await conn.query("UPDATE makeup_students SET status='locked', review_resolution=?, decision_reason=?, decided_by=?, decided_at=NOW() WHERE id=?",
        [resolution, reason, user.id, mkId]);
      await lockOrder(conn, mk, sizes);
      await closeStudentOpenExceptions(conn, mk.student_id, user, `复核裁决：${reason}`);
    }
    await conn.query(
      `INSERT INTO makeup_decisions (makeup_student_id,order_id,decision,reason,decided_by)
       VALUES (?,?,?,?,?)`,
      [mkId, mk.order_id, resolutionMap[decision] || decision, reason, user.id]);
    if (decision === 'remeasure') {
      // 退回重测：不一致异常标记为已知晓，待重测后再次确认时由系统处理
      await conn.query("UPDATE makeup_exceptions SET status='acknowledged', acknowledged_by=?, resolution=? WHERE type='size_mismatch' AND student_id=? AND status='open'",
        [user.id, `退回重新补测：${reason}`, mk.student_id]);
    } else {
      await conn.query("UPDATE makeup_exceptions SET status='resolved', resolved_by=?, resolved_at=NOW(), resolution=? WHERE type='size_mismatch' AND student_id=? AND status<>'resolved'",
        [user.id, reason, mk.student_id]);
    }
  });
  await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: '总务复核裁决', detail: `${decision}：${reason}` });
  return { id: mkId };
}

// 截止日处置：按参考尺码预锁 / 延后该学生，并重算班级数量、批次、到校承诺
export async function deadlineDecision(mkId: number, decision: 'prelock' | 'defer', reason: string, user: SessionUser, promisedArrival?: string) {
  if (!reason) throw Object.assign(new Error('必须填写处置原因'), { status: 400 });
  const mk = await one<any>('SELECT * FROM makeup_students WHERE id=?', [mkId]);
  if (!mk) throw Object.assign(new Error('补测记录不存在'), { status: 404 });
  if (['locked', 'prelocked', 'deferred'].includes(mk.status)) throw Object.assign(new Error('该生已闭环'), { status: 400 });
  const student = await one<any>('SELECT name FROM students WHERE id=?', [mk.student_id]);
  let impact = '';
  await tx(async (conn) => {
    if (decision === 'prelock') {
      const ref = sizeFromRow(mk, 'ref');
      for (const g of GARMENTS) if (ref[g]) await conn.query('UPDATE order_items SET size=? WHERE order_id=? AND garment_type=?', [ref[g], mk.order_id, g]);
      const restore = Number((await one<any>('SELECT paid_amount FROM orders WHERE id=?', [mk.order_id]))?.paid_amount || 0) > 0 ? 'paid' : 'confirmed';
      await conn.query("UPDATE orders SET production_lock='prelocked', status=? WHERE id=?", [restore, mk.order_id]);
      await conn.query("UPDATE makeup_students SET status='prelocked', decision_reason=?, decided_by=?, decided_at=NOW() WHERE id=?",
        [reason, user.id, mkId]);
    } else {
      await conn.query("UPDATE orders SET production_lock='deferred' WHERE id=?", [mk.order_id]);
      await conn.query("UPDATE makeup_students SET status='deferred', decision_reason=?, decided_by=?, decided_at=NOW() WHERE id=?",
        [reason, user.id, mkId]);
      // 退出既有批次分配（延后不计入生产批次）
      await conn.query(
        `DELETE ba FROM batch_allocations ba
           JOIN batch_items bi ON bi.id=ba.batch_item_id
           JOIN order_items oi ON oi.id=ba.order_item_id
          WHERE oi.order_id=?`, [mk.order_id]);
    }
    await conn.query(
      `INSERT INTO makeup_decisions (makeup_student_id,order_id,decision,reason,decided_by)
       VALUES (?,?,?,?,?)`, [mkId, mk.order_id, decision, reason, user.id]);
    if (promisedArrival) {
      await conn.query(
        `UPDATE class_production_settings SET promised_arrival=?, updated_by=?
          WHERE plan_id=? AND class_id=?`,
        [promisedArrival, user.id, mk.plan_id, mk.class_id]);
    }
    for (const t of ['makeup_overdue', 'deadline_open', 'teacher_timeout', 'parent_timeout', 'size_mismatch']) {
      await conn.query("UPDATE makeup_exceptions SET status='resolved', resolved_by=?, resolved_at=NOW(), resolution=? WHERE student_id=? AND type=? AND status<>'resolved'",
        [user.id, `截止日处置：${reason}`, mk.student_id, t]);
    }
  });
  impact = await impactText(mk.plan_id, mk.class_id, student.name, decision === 'prelock' ? '按参考尺码预锁' : '延后');
  await tx(async (conn) => {
    await conn.query('UPDATE makeup_decisions SET impact=? WHERE makeup_student_id=? ORDER BY id DESC LIMIT 1', [impact, mkId]);
  });
  await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: decision === 'prelock' ? '总务批准按参考尺码预锁' : '总务批准延后', detail: `${reason}｜${impact}` });
  return { id: mkId, impact };
}

// 异常扫描（幂等）
export async function scanExceptions(planId?: number) {
  if (planId) await registerMissing(planId);
  const plans = planId
    ? await query<any>('SELECT * FROM plans WHERE id=?', [planId])
    : await query<any>('SELECT * FROM plans');
  let raised = 0;
  for (const p of plans) {
    // 1) 补测逾期：已确认/调整但时间已过仍未完成
    const overdue = await query<any>(
      `SELECT ms.id, ms.class_id FROM makeup_sessions ms
        WHERE ms.plan_id=? AND ms.status IN ('confirmed','adjusted') AND ms.end_time < NOW()`, [p.id]);
    for (const ms of overdue) {
      const open = await one('SELECT id FROM makeup_exceptions WHERE type=\'makeup_overdue\' AND makeup_session_id=? AND status IN (\'open\',\'acknowledged\')', [ms.id]);
      if (!open) {
        await query(
          `INSERT INTO makeup_exceptions (exc_no,type,status,plan_id,class_id,makeup_session_id,detail,raised_by)
           VALUES (?, 'makeup_overdue','open',?,?,?, ?, 'system')`,
          [genNo('EX'), p.id, ms.class_id, ms.id, '补测时段已过但未标记完成，补测逾期']);
        raised++;
      }
    }
    // 2) 班主任超时：录入后未确认 / 补测场完成后仍未录入确认
    const tTimeout = await query<any>(
      `SELECT mk.* FROM makeup_students mk
        WHERE mk.plan_id=? AND (
          (mk.m_recorded_at IS NOT NULL AND mk.m_confirmed_at IS NULL
             AND TIMESTAMPADD(HOUR, ?, mk.m_recorded_at) < NOW())
          OR (mk.m_recorded_at IS NULL AND mk.makeup_session_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM makeup_sessions x WHERE x.id=mk.makeup_session_id AND x.status='completed')
             AND TIMESTAMPADD(HOUR, ?, (SELECT MAX(x.end_time) FROM makeup_sessions x WHERE x.id=mk.makeup_session_id)) < NOW())
        )`,
      [p.id, p.teacher_confirm_hours || 24, p.teacher_confirm_hours || 24]);
    for (const mk of tTimeout) {
      if (['locked', 'prelocked', 'deferred'].includes(mk.status)) continue;
      const open = await one('SELECT id FROM makeup_exceptions WHERE type=\'teacher_timeout\' AND student_id=? AND status IN (\'open\',\'acknowledged\')', [mk.student_id]);
      if (!open) {
        await query(
          `INSERT INTO makeup_exceptions (exc_no,type,status,plan_id,class_id,student_id,makeup_session_id,detail,raised_by)
           VALUES (?, 'teacher_timeout','open',?,?,?,?,?, 'system')`,
          [genNo('EX'), p.id, mk.class_id, mk.student_id, mk.makeup_session_id, `班主任超过 ${p.teacher_confirm_hours || 24} 小时未确认测量记录`]);
        raised++;
      }
    }
    // 3) 家长超时：班主任已确认，家长未最终确认
    const pTimeout = await query<any>(
      `SELECT * FROM makeup_students mk
        WHERE mk.plan_id=? AND mk.m_confirmed_at IS NOT NULL AND mk.f_confirmed_at IS NULL
          AND mk.status NOT IN ('locked','prelocked','deferred','review')
          AND TIMESTAMPADD(HOUR, ?, mk.m_confirmed_at) < NOW()`,
      [p.id, p.parent_confirm_hours || 48]);
    for (const mk of pTimeout) {
      const open = await one('SELECT id FROM makeup_exceptions WHERE type=\'parent_timeout\' AND student_id=? AND status IN (\'open\',\'acknowledged\')', [mk.student_id]);
      if (!open) {
        await query(
          `INSERT INTO makeup_exceptions (exc_no,type,status,plan_id,class_id,student_id,makeup_session_id,detail,raised_by)
           VALUES (?, 'parent_timeout','open',?,?,?,?,?, 'system')`,
          [genNo('EX'), p.id, mk.class_id, mk.student_id, mk.makeup_session_id, `家长超过 ${p.parent_confirm_hours || 48} 小时未确认最终尺码`]);
        raised++;
      }
    }
    // 4) 截止日未闭环
    const deadlineRows = await query<any>(
      `SELECT mk.*, cps.production_deadline FROM makeup_students mk
         JOIN class_production_settings cps ON cps.plan_id=mk.plan_id AND cps.class_id=mk.class_id
        WHERE mk.plan_id=? AND mk.status IN ('need_makeup','referenced','scheduled','measured','review')
          AND cps.production_deadline < NOW()`, [p.id]);
    for (const mk of deadlineRows) {
      const open = await one('SELECT id FROM makeup_exceptions WHERE type=\'deadline_open\' AND student_id=? AND status IN (\'open\',\'acknowledged\')', [mk.student_id]);
      if (!open) {
        await query(
          `INSERT INTO makeup_exceptions (exc_no,type,status,plan_id,class_id,student_id,makeup_session_id,detail,raised_by)
           VALUES (?, 'deadline_open','open',?,?,?,?,?, 'system')`,
          [genNo('EX'), p.id, mk.class_id, mk.student_id, mk.makeup_session_id, `生产截止日 ${mk.production_deadline} 已到仍未闭环，等待总务预锁/延后`]);
        raised++;
      }
    }
  }
  return { raised };
}
