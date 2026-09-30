import { NextRequest } from 'next/server';
import { one, query } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';

// 订单完整详情：明细 + 试穿建议 + 批次 + 发货 + 签收 + 售后 + 时间线
export const GET = api(async (_req: NextRequest, _b: any, user, ctx) => {
  const id = ctx.params.id;
  const o = await one<any>(
    `SELECT o.*, s.name student_name, s.student_no, s.height_cm, s.weight_kg, s.usual_size,
            s.special_fit, s.special_fit_note, s.status student_status,
            c.name class_name, g.name grade_name, cp.name campus_name, p.name plan_name,
            sb.ratio subsidy_ratio, sb.status subsidy_status
     FROM orders o
     JOIN students s ON s.id=o.student_id
     JOIN classes c ON c.id=o.class_id
     JOIN grades g ON g.id=s.grade_id
     JOIN campuses cp ON cp.id=s.campus_id
     JOIN plans p ON p.id=o.plan_id
     LEFT JOIN subsidies sb ON sb.student_id=s.id
     WHERE o.id=?`, [id]);
  if (!o) return fail('订单不存在', 404);
  if (user.role === 'parent') {
    const st = await one('SELECT parent_user_id FROM students WHERE id=?', [o.student_id]);
    if (st?.parent_user_id !== user.id) return fail('无权限', 403);
  }

  const [items, cases, logs, fr] = await Promise.all([
    query(
      `SELECT oi.*,
        (SELECT GROUP_CONCAT(CONCAT(pb.batch_no,':',ba.qty) SEPARATOR ';')
           FROM batch_allocations ba JOIN batch_items bi ON bi.id=ba.batch_item_id
           JOIN production_batches pb ON pb.id=bi.batch_id
          WHERE ba.order_item_id=oi.id) batches,
        (SELECT GROUP_CONCAT(CONCAT(sh.shipment_no,':',sl.qty,'/',IFNULL(sl.arrived_qty,0)) SEPARATOR ';')
           FROM shipment_lines sl JOIN shipments sh ON sh.id=sl.shipment_id
          WHERE sl.order_item_id=oi.id) shipments,
        (SELECT GROUP_CONCAT(CONCAT(rc.status,':',rc.qty,IF(rc.handled,'✓','')) SEPARATOR ';')
           FROM receipts rc WHERE rc.order_item_id=oi.id) receipts
       FROM order_items oi WHERE oi.order_id=?`, [id]),
    query(
      `SELECT ac.*, u.real_name creator_name FROM aftersales_cases ac
       LEFT JOIN users u ON u.id=ac.created_by WHERE ac.order_id=? ORDER BY ac.id`, [id]),
    query('SELECT * FROM activity_log WHERE order_id=? OR student_id=? ORDER BY id', [id, o.student_id]),
    one<any>(
      `SELECT fr.* FROM fitting_records fr JOIN fitting_sessions fs ON fs.id=fr.session_id
       WHERE fr.student_id=? AND fs.plan_id=? ORDER BY fr.id DESC LIMIT 1`, [o.student_id, o.plan_id]),
  ]);

  const makeup = await one<any>(
    `SELECT mk.*, ms.makeup_no, ms.start_time makeup_start, ms.end_time makeup_end, ms.location makeup_location,
            ms.manual_adjust_reason
       FROM makeup_students mk
       LEFT JOIN makeup_sessions ms ON ms.id=mk.makeup_session_id
      WHERE mk.order_id=? ORDER BY mk.id DESC LIMIT 1`, [id]);
  const mkDecisions = makeup
    ? await query(
        `SELECT md.*, u.real_name decider_name FROM makeup_decisions md
          LEFT JOIN users u ON u.id=md.decided_by WHERE md.makeup_student_id=? ORDER BY md.id`, [makeup.id])
    : [];

  return ok({ order: o, items, cases, logs, fitting: fr, makeup, mkDecisions });
});

// 修改明细尺码（家长确认前）
export const PATCH = api(async (_req: NextRequest, body: any, user) => {
  const o = await one<any>('SELECT * FROM orders WHERE id=?', [body.id]);
  if (!o) return fail('订单不存在', 404);
  if (user.role === 'parent') {
    const st = await one('SELECT parent_user_id FROM students WHERE id=?', [o.student_id]);
    if (st?.parent_user_id !== user.id) return fail('无权限', 403);
  }
  if (o.status !== 'draft') return fail('仅草稿订单可修改');
  if (body.items) {
    for (const it of body.items) {
      await query('UPDATE order_items SET size=?, qty=? WHERE id=? AND order_id=?',
        [it.size, it.qty || 1, it.id, o.id]);
    }
  }
  if (body.note !== undefined) await query('UPDATE orders SET parent_note=? WHERE id=?', [body.note, o.id]);
  return ok();
});

// 订单动作：confirm / pay / hold / release / cancel
export const POST = api(async (req: NextRequest, body: any, user) => {
  const o = await one<any>('SELECT * FROM orders WHERE id=?', [body.id]);
  if (!o) return fail('订单不存在', 404);
  const ownChild = async () => {
    const st = await one('SELECT parent_user_id FROM students WHERE id=?', [o.student_id]);
    return st?.parent_user_id === user.id;
  };

  switch (body.action) {
    case 'confirm': {
      if (user.role === 'parent' && !(await ownChild())) return fail('无权限', 403);
      if (o.status !== 'draft') return fail('仅草稿订单可确认');
      const s = await one('SELECT status FROM students WHERE id=?', [o.student_id]);
      if (s?.status === 'transferred') return fail('学生已转学，不能确认');
      await query("UPDATE orders SET status='confirmed', confirmed_at=NOW() WHERE id=?", [o.id]);
      await logActivity({ student_id: o.student_id, order_id: o.id, actor: user, action: '家长确认订单', detail: `应付 ¥${o.due_amount}` });
      return ok();
    }
    case 'pay': {
      if (user.role === 'parent' && !(await ownChild())) return fail('无权限', 403);
      if (o.status !== 'confirmed' && !(o.status === 'hold' && (o.hold_reason || '').includes('迟缴费')))
        return fail('当前状态不能缴费');
      const plan = await one<any>('SELECT * FROM plans WHERE id=?', [o.plan_id]);
      const late = plan && new Date(plan.order_deadline) < new Date();
      await query(
        "UPDATE orders SET status='paid', paid_amount=due_amount, paid_at=NOW(), hold_reason=NULL WHERE id=?",
        [o.id]);
      await logActivity({ student_id: o.student_id, order_id: o.id, actor: user,
        action: '家长缴费', detail: `¥${o.due_amount}${late ? '（超过截止日期的迟缴费，已通知总务）' : ''}` });
      return ok({ late: !!late });
    }
    case 'hold': {
      if (!['admin', 'general_affairs'].includes(user.role)) return fail('仅总务可挂起订单', 403);
      await query("UPDATE orders SET status='hold', hold_reason=? WHERE id=?", [body.reason || '学校暂缓', o.id]);
      await logActivity({ student_id: o.student_id, order_id: o.id, actor: user, action: '订单挂起', detail: body.reason });
      return ok();
    }
    case 'release': {
      if (!['admin', 'general_affairs'].includes(user.role)) return fail('仅总务可解除挂起', 403);
      if (o.status === 'review') return fail('两次确认不一致待复核，请到「集中补测」完成复核裁决，不能直接解除', 400);
      const target = Number(o.paid_amount) > 0 ? 'paid' : 'confirmed';
      await query("UPDATE orders SET status=?, hold_reason=NULL WHERE id=?", [target, o.id]);
      await logActivity({ student_id: o.student_id, order_id: o.id, actor: user, action: '解除挂起', detail: `状态→${target}` });
      return ok();
    }
    case 'cancel': {
      if (!['admin', 'general_affairs'].includes(user.role)) return fail('仅总务可取消订单', 403);
      await query("UPDATE orders SET status='cancelled', cancelled_at=NOW(), hold_reason=NULL WHERE id=?", [o.id]);
      await logActivity({ student_id: o.student_id, order_id: o.id, actor: user, action: '取消订单', detail: body.reason });
      return ok();
    }
    default:
      return fail('未知操作');
  }
});
