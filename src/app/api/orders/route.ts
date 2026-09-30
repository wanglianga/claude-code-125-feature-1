import { NextRequest } from 'next/server';
import { query, one, tx } from '@/lib/db';
import { api, ok, fail, logActivity, genNo } from '@/lib/api';

// 订单列表（按角色过滤）
export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const where: string[] = [];
  const params: any[] = [];
  if (user.role === 'parent') { where.push('o.student_id IN (SELECT id FROM students WHERE parent_user_id=?)'); params.push(user.id); }
  if (user.role === 'head_teacher') { where.push('c.teacher_user_id=?'); params.push(user.id); }
  if (user.role === 'supplier' || user.role === 'factory') { where.push('p.supplier_id=?'); params.push(user.supplier_id); }
  if (user.campus_id && ['general_affairs', 'admin'].includes(user.role)) { where.push('s.campus_id=?'); params.push(user.campus_id); }
  for (const k of ['plan_id', 'class_id', 'student_id', 'status']) {
    const v = sp.get(k);
    if (v) { where.push(`o.${k}=?`); params.push(v); }
  }
  const rows = await query(
    `SELECT o.*, s.name student_name, s.student_no, c.name class_name, p.name plan_name,
            cp.name campus_name,
            (SELECT status FROM subsidies sb WHERE sb.student_id=s.id) subsidy_status
     FROM orders o
     JOIN students s ON s.id=o.student_id
     JOIN classes c ON c.id=o.class_id
     JOIN plans p ON p.id=o.plan_id
     JOIN campuses cp ON cp.id=s.campus_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY o.id DESC`, params);
  const itemCounts = rows.length
    ? await query(
        `SELECT oi.order_id, COUNT(*) kinds, SUM(oi.qty) total_qty,
                SUM(oi.shipped_qty) shipped_qty, SUM(oi.signed_qty) signed_qty
         FROM order_items oi WHERE oi.order_id IN (?) GROUP BY oi.order_id`,
        [rows.map((r: any) => r.id)])
    : [];
  const m = new Map(itemCounts.map((r: any) => [r.order_id, r]));
  return ok({ orders: rows.map((r: any) => ({ ...r, progress: m.get(r.id) || null })) });
});

// 家长下单：依据试穿建议生成订单明细
export const POST = api(async (_req: NextRequest, body: any, user) => {
  const student = await one<any>('SELECT * FROM students WHERE id=?', [body.student_id]);
  if (!student) return fail('学生不存在', 404);
  if (student.status === 'transferred') return fail('该生已转学，不能新建订单');
  if (user.role === 'parent' && student.parent_user_id !== user.id) return fail('只能为自己孩子下单', 403);
  const plan = await one<any>('SELECT * FROM plans WHERE id=?', [body.plan_id]);
  if (!plan || plan.status !== 'open') return fail('订购计划未开放');

  const dup = await one('SELECT id FROM orders WHERE plan_id=? AND student_id=? AND status<>?',
    [plan.id, student.id, 'cancelled']);
  if (dup) return fail('该生在此计划下已有订单');

  const items: any[] = body.items || [];
  if (!items.length) return fail('请至少选择一个品类');
  const planItems = await query<any>('SELECT * FROM plan_items WHERE plan_id=? AND id IN (?)',
    [plan.id, items.map((i) => i.plan_item_id)]);
  const pim = new Map(planItems.map((p: any) => [p.id, p]));

  const orderId = await tx(async (conn) => {
    const [r]: any = await conn.query(
      `INSERT INTO orders (order_no,plan_id,student_id,class_id,status,payable_amount,subsidy_amount,due_amount,parent_note)
       VALUES (?,?,?,?, 'draft', 0,0,0,?)`,
      [genNo('OD'), plan.id, student.id, student.class_id, body.note || null]);
    const oid = r.insertId;
    let payable = 0;
    for (const it of items) {
      const pi = pim.get(Number(it.plan_item_id));
      if (!pi) throw Object.assign(new Error('品类不存在'), { status: 400 });
      const qty = Math.max(1, Number(it.qty) || 1);
      await conn.query(
        `INSERT INTO order_items (order_id,plan_item_id,garment_type,name,size,price,qty,is_extra)
         VALUES (?,?,?,?,?,?,?,?)`,
        [oid, pi.id, pi.garment_type, pi.name, it.size || 'M', pi.price, qty, pi.required ? 0 : 1]);
      payable += Number(pi.price) * qty;
    }
    const sb = await one<any>('SELECT * FROM subsidies WHERE student_id=? AND status=?', [student.id, 'approved']);
    const subsidy = sb ? Math.round(payable * Number(sb.ratio) * 100) / 100 : 0;
    await conn.query('UPDATE orders SET payable_amount=?, subsidy_amount=?, due_amount=? WHERE id=?',
      [payable, subsidy, Math.round((payable - subsidy) * 100) / 100, oid]);
    return oid;
  });
  // 集中试穿漏测：无该计划试穿（含补测）记录的学生，订单自动标记“风险占位”，
  // 家长只能提交参考尺码，供应商不得计入正式生产数量，并进入补测台账
  const fitted = await one(
    `SELECT 1 FROM fitting_records fr JOIN fitting_sessions fs ON fs.id=fr.session_id
      WHERE fr.student_id=? AND fs.plan_id=? LIMIT 1`,
    [student.id, plan.id]);
  if (!fitted) {
    const firstOrder = await one(`SELECT COUNT(*) c FROM orders WHERE student_id=? AND id<>? AND status='paid'`,
      [student.id, orderId]);
    await tx(async (conn) => {
      await conn.query("UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1 WHERE id=?", [orderId]);
      await conn.query(
        `INSERT INTO makeup_students (makeup_session_id,plan_id,student_id,class_id,order_id,is_first_order,status)
         VALUES (NULL,?,?,?,?,?, 'pending_ref')
         ON DUPLICATE KEY UPDATE order_id=VALUES(order_id)`,
        [plan.id, student.id, student.class_id, orderId, Number(firstOrder?.c || 0) === 0 ? 1 : 0]);
    });
  }
  await logActivity({ student_id: student.id, order_id: orderId, actor: user, action: '家长创建订单',
    detail: fitted ? plan.name : `${plan.name}（集中试穿漏测，已置风险占位，等待补测，不计正式生产数量）` });
  return ok({ id: orderId });
}, ['parent', 'admin', 'general_affairs']);
