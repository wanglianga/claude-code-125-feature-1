import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { api, ok } from '@/lib/api';

// 供应商生产锁定看板：正式可生产数量 与 风险占位/待复核/延后 分开列示
export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const w: string[] = [];
  const a: any[] = [];
  if (user.role === 'supplier' || user.role === 'factory') { w.push('p.supplier_id=?'); a.push(user.supplier_id); }
  if (sp.get('plan_id')) { w.push('o.plan_id=?'); a.push(sp.get('plan_id')); }
  const WHERE = w.join(' AND ') || '1=1';

  // 按品类+尺码汇总：正式（已锁定/预锁/无锁定的已缴费）vs 风险占位
  const rows = await query(
    `SELECT o.plan_id, p.name plan_name, oi.plan_item_id, pi.name item_name, oi.garment_type, oi.size,
            o.production_lock, o.status,
            COUNT(DISTINCT o.id) orders, SUM(oi.qty) qty
       FROM orders o
       JOIN plans p ON p.id=o.plan_id
       JOIN order_items oi ON oi.order_id=o.id
       JOIN plan_items pi ON pi.id=oi.plan_item_id
      WHERE ${WHERE} AND o.status<>'cancelled'
      GROUP BY o.plan_id, oi.plan_item_id, oi.size, o.production_lock, o.status
      ORDER BY o.plan_id, pi.id, oi.size, o.production_lock`, a);

  const bucket = (planItem: number, size: string) => {
    const key = `${planItem}:${size}`;
    if (!m.has(key)) m.set(key, {
      plan_item_id: planItem, size, item_name: '', garment_type: '', plan_id: 0, plan_name: '',
      formal_qty: 0, placeholder_qty: 0, prelocked_qty: 0, review_qty: 0, deferred_qty: 0,
      paid_unlocked_qty: 0,
    });
    return m.get(key)!;
  };
  const m = new Map<string, any>();
  for (const r of rows as any[]) {
    const b = bucket(r.plan_item_id, r.size);
    b.item_name = r.item_name; b.garment_type = r.garment_type; b.plan_id = r.plan_id; b.plan_name = r.plan_name;
    const qty = Number(r.qty);
    if (r.status === 'review') b.review_qty += qty;
    if (r.production_lock === 'placeholder') b.placeholder_qty += qty;
    else if (r.production_lock === 'deferred') b.deferred_qty += qty;
    else if (r.production_lock === 'prelocked' && r.status === 'paid') { b.prelocked_qty += qty; b.formal_qty += qty; }
    else if (r.production_lock === 'locked' && r.status === 'paid') b.formal_qty += qty;
    else if (r.production_lock === 'none' && r.status === 'paid') { b.paid_unlocked_qty += qty; b.formal_qty += qty; }
  }

  // 风险占位学生明细（供应商明确知道这些不能投产）
  const risk = await query(
    `SELECT o.id order_id, o.order_no, o.status, o.production_lock, s.name student_name, s.student_no,
            c.name class_name, p.name plan_name, COUNT(oi.id) kinds, SUM(oi.qty) qty,
            CASE
              WHEN o.status='review' THEN '两次确认不一致·待复核，不能锁定生产'
              WHEN o.production_lock='placeholder' THEN '补测前参考尺码·风险占位，不计入正式数量'
              WHEN o.production_lock='deferred' THEN '总务批准延后，不进入本批生产'
              ELSE '其他'
            END risk_reason
       FROM orders o
       JOIN students s ON s.id=o.student_id
       JOIN classes c ON c.id=o.class_id
       JOIN plans p ON p.id=o.plan_id
       JOIN order_items oi ON oi.order_id=o.id
      WHERE ${WHERE} AND (o.production_lock IN ('placeholder','deferred') OR o.status='review')
      GROUP BY o.id ORDER BY p.id, c.id, s.student_no`, a);

  const totals = [...m.values()].reduce((acc: any, b: any) => ({
    formal: acc.formal + b.formal_qty, placeholder: acc.placeholder + b.placeholder_qty,
    prelocked: acc.prelocked + b.prelocked_qty, review: acc.review + b.review_qty, deferred: acc.deferred + b.deferred_qty,
  }), { formal: 0, placeholder: 0, prelocked: 0, review: 0, deferred: 0 });

  return ok({ lines: [...m.values()], risk, totals });
}, ['supplier', 'factory', 'admin', 'general_affairs']);
