import { NextRequest } from 'next/server';
import { query, one } from '@/lib/db';
import { api, ok, fail } from '@/lib/api';
import {
  generateCandidates, confirmCandidate, adjustSession, completeSession, cancelSession,
  registerMissing, scanExceptions,
} from '@/lib/makeup';

// 补测总览：漏测学生链路 + 补测场（候选/已确认/完成）+ 班级汇总 + 异常台账
export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const planId = sp.get('plan_id');
  // 每次查看先做一次幂等异常扫描（逾期/超时/截止日）
  await scanExceptions(planId ? Number(planId) : undefined).catch(() => {});

  const w: string[] = [];
  const a: any[] = [];
  if (planId) { w.push('mk.plan_id=?'); a.push(planId); }
  if (user.role === 'parent') { w.push('s.parent_user_id=?'); a.push(user.id); }
  if (user.role === 'head_teacher') { w.push('c.teacher_user_id=?'); a.push(user.id); }
  if (user.role === 'supplier' || user.role === 'factory') { w.push('p.supplier_id=?'); a.push(user.supplier_id); }
  if (user.campus_id && ['general_affairs', 'admin'].includes(user.role)) { w.push('s.campus_id=?'); a.push(user.campus_id); }

  const students = await query(
    `SELECT mk.*, s.name student_name, s.student_no, s.height_cm, s.weight_kg, s.usual_size,
            c.name class_name, cp.name campus_name, p.name plan_name, p.supplier_id,
            o.order_no, o.status order_status, o.production_lock, o.paid_amount,
            cps.production_deadline, cps.promised_arrival
       FROM makeup_students mk
       JOIN students s ON s.id=mk.student_id
       JOIN classes c ON c.id=mk.class_id
       JOIN campuses cp ON cp.id=s.campus_id
       JOIN plans p ON p.id=mk.plan_id
       LEFT JOIN orders o ON o.id=mk.order_id
       LEFT JOIN class_production_settings cps ON cps.plan_id=mk.plan_id AND cps.class_id=mk.class_id
       ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
       ORDER BY mk.plan_id, c.id, s.student_no`, a);

  const decisions = await query<any>(
    `SELECT md.* FROM makeup_decisions md
      ${planId ? 'JOIN makeup_students mk2 ON mk2.id=md.makeup_student_id WHERE mk2.plan_id=?' : ''}
      ORDER BY md.id`, planId ? [planId] : []);
  const dmap = new Map<number, any[]>();
  for (const d of decisions) {
    const arr = dmap.get(d.makeup_student_id) || [];
    arr.push(d); dmap.set(d.makeup_student_id, arr);
  }

  const sw: string[] = [];
  const sa: any[] = [];
  if (planId) { sw.push('ms.plan_id=?'); sa.push(planId); }
  if (user.role === 'head_teacher') { sw.push('c.teacher_user_id=?'); sa.push(user.id); }
  const sessions = await query(
    `SELECT ms.*, c.name class_name, cp.name campus_name, u.real_name organizer_name,
            (SELECT COUNT(*) FROM makeup_students x WHERE x.makeup_session_id=ms.id) student_count,
            (SELECT GROUP_CONCAT(CONCAT(pi.name,':',sr.qty) SEPARATOR ';')
               FROM sample_reservations sr JOIN sample_stocks ss ON ss.id=sr.sample_stock_id
               JOIN plan_items pi ON pi.id=ss.plan_item_id
              WHERE sr.makeup_session_id=ms.id AND sr.status='held') reserved
       FROM makeup_sessions ms
       JOIN classes c ON c.id=ms.class_id
       JOIN campuses cp ON cp.id=ms.campus_id
       LEFT JOIN users u ON u.id=ms.organizer_user_id
       ${sw.length ? 'WHERE ' + sw.join(' AND ') : ''}
       ORDER BY ms.start_time DESC, ms.id DESC`, sa);

  const ew: string[] = [];
  const ea: any[] = [];
  if (planId) { ew.push('e.plan_id=?'); ea.push(planId); }
  if (user.role === 'head_teacher') { ew.push('c.teacher_user_id=?'); ea.push(user.id); }
  if (user.role === 'parent') { ew.push('s.parent_user_id=?'); ea.push(user.id); }
  if (user.role === 'supplier' || user.role === 'factory') { ew.push('p.supplier_id=?'); ea.push(user.supplier_id); }
  const exceptions = await query(
    `SELECT e.*, c.name class_name, s.name student_name, p.name plan_name,
            u.real_name acknowledged_name, u2.real_name resolved_name
       FROM makeup_exceptions e
       JOIN plans p ON p.id=e.plan_id
       LEFT JOIN classes c ON c.id=e.class_id
       LEFT JOIN students s ON s.id=e.student_id
       LEFT JOIN users u ON u.id=e.acknowledged_by
       LEFT JOIN users u2 ON u2.id=e.resolved_by
       ${ew.length ? 'WHERE ' + ew.join(' AND ') : ''}
       ORDER BY (e.status='open') DESC, e.id DESC`, ea);

  // 班级数量重算汇总
  const classSummary: any[] = [];
  const planClass = Array.from(new Set(students.map((x: any) => `${x.plan_id}:${x.class_id}`)));
  for (const k of planClass) {
    const [pid, cid] = k.split(':').map(Number);
    const rows = await query(
      `SELECT o.production_lock, o.status, COUNT(DISTINCT o.id) orders, COALESCE(SUM(oi.qty),0) qty
         FROM orders o JOIN order_items oi ON oi.order_id=o.id
        WHERE o.plan_id=? AND o.class_id=? AND o.status<>'cancelled'
        GROUP BY o.production_lock, o.status`, [pid, cid]);
    const formal = rows.filter((r: any) => r.status === 'paid' && ['locked', 'prelocked', 'none'].includes(r.production_lock))
      .reduce((acc: any, r: any) => ({ orders: acc.orders + Number(r.orders), qty: acc.qty + Number(r.qty) }), { orders: 0, qty: 0 });
    const placeholder = rows.filter((r: any) => r.production_lock === 'placeholder')
      .reduce((acc: any, r: any) => ({ orders: acc.orders + Number(r.orders), qty: acc.qty + Number(r.qty) }), { orders: 0, qty: 0 });
    classSummary.push({
      plan_id: pid, class_id: cid,
      class_name: students.find((x: any) => x.plan_id === pid && x.class_id === cid)?.class_name,
      formal_orders: formal.orders, formal_qty: formal.qty,
      placeholder_orders: placeholder.orders, placeholder_qty: placeholder.qty,
      review_orders: rows.filter((r: any) => r.status === 'review').reduce((n: number, r: any) => n + Number(r.orders), 0),
      deferred_orders: rows.filter((r: any) => r.production_lock === 'deferred').reduce((n: number, r: any) => n + Number(r.orders), 0),
    });
  }

  return ok({
    students: students.map((x: any) => ({ ...x, decisions: dmap.get(x.id) || [] })),
    sessions, exceptions, classSummary,
  });
});

// 补测场/候选动作
export const POST = api(async (_req: NextRequest, body: any, user) => {
  switch (body.action) {
    case 'register': {
      if (!['general_affairs', 'admin', 'head_teacher'].includes(user.role)) return fail('无权限', 403);
      const r = await registerMissing(body.plan_id, body.class_id);
      return ok(r);
    }
    case 'generate': {
      if (!['general_affairs', 'admin', 'head_teacher'].includes(user.role)) return fail('无权限', 403);
      if (!body.plan_id || !body.class_id) return fail('请选择计划与班级');
      const r = await generateCandidates(Number(body.plan_id), Number(body.class_id));
      return ok(r);
    }
    case 'confirm_candidate': {
      if (!['general_affairs', 'admin', 'head_teacher'].includes(user.role)) return fail('无权限', 403);
      return ok(await confirmCandidate(Number(body.session_id), user));
    }
    case 'adjust': {
      if (!['general_affairs', 'admin', 'head_teacher'].includes(user.role)) return fail('无权限', 403);
      return ok(await adjustSession(Number(body.session_id), body, user));
    }
    case 'complete': {
      if (!['general_affairs', 'admin', 'head_teacher'].includes(user.role)) return fail('无权限', 403);
      return ok(await completeSession(Number(body.session_id), user));
    }
    case 'cancel': {
      if (!['general_affairs', 'admin', 'head_teacher'].includes(user.role)) return fail('无权限', 403);
      return ok(await cancelSession(Number(body.session_id), body.reason, user));
    }
    case 'scan': {
      if (!['general_affairs', 'admin', 'supplier', 'factory'].includes(user.role)) return fail('无权限', 403);
      return ok(await scanExceptions(body.plan_id ? Number(body.plan_id) : undefined));
    }
    default:
      return fail('未知操作');
  }
}, ['head_teacher', 'general_affairs', 'admin', 'supplier', 'factory', 'parent']);
