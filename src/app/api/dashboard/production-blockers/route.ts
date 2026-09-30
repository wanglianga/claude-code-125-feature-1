import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { api, ok } from '@/lib/api';

// 供应商视角：哪些订单还不能进入生产（未缴费/挂起/转学/草稿/未确认/待复核/补测风险占位/延后），需明确原因
export const GET = api(async (_req: NextRequest, _b: any, user) => {
  const rows = await query(
    `SELECT o.id, o.order_no, o.status, o.hold_reason, o.production_lock, s.name student_name, s.student_no,
            s.status student_status, c.name class_name, p.name plan_name,
            COUNT(oi.id) item_kinds, COALESCE(SUM(oi.qty),0) total_qty,
            CASE
              WHEN s.status='transferred' THEN '学生已转学'
              WHEN o.status='review' THEN '班主任与家长两次确认不一致·待复核，不能锁定生产'
              WHEN o.production_lock='placeholder' THEN '集中试穿漏测补测中：仅提交参考尺码·风险占位，不计入正式数量'
              WHEN o.production_lock='deferred' THEN '总务批准延后该学生，不进入本批生产'
              WHEN o.status='draft' THEN '家长尚未确认订单'
              WHEN o.status='confirmed' THEN '家长未缴费'
              WHEN o.status='hold' THEN CONCAT('订单挂起：', COALESCE(o.hold_reason,''))
              WHEN o.status='cancelled' THEN '订单已取消'
              ELSE '其他'
            END block_reason
     FROM orders o
     JOIN students s ON s.id=o.student_id
     JOIN classes c ON c.id=o.class_id
     JOIN plans p ON p.id=o.plan_id
     JOIN order_items oi ON oi.order_id=o.id
     WHERE p.supplier_id=?
       AND (o.status <> 'paid' OR o.production_lock IN ('placeholder','deferred'))
     GROUP BY o.id
     ORDER BY p.id, o.id`, [user.supplier_id || -1]);
  const summary = await query(
    `SELECT o.status, o.production_lock, COUNT(DISTINCT o.id) cnt, COALESCE(SUM(oi.qty),0) qty
     FROM orders o JOIN plans p ON p.id=o.plan_id
     JOIN order_items oi ON oi.order_id=o.id
     WHERE p.supplier_id=? GROUP BY o.status, o.production_lock`, [user.supplier_id || -1]);
  return ok({ blocked: rows, summary });
}, ['supplier', 'factory', 'admin', 'general_affairs']);
