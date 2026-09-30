import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { api, ok } from '@/lib/api';

// 供应商视角：哪些订单还不能进入生产
// 1) 未缴费/挂起/转学/草稿/未确认  2) 已缴费但漏测风险占位/两次确认不一致待复核（不能锁定生产）
export const GET = api(async (_req: NextRequest, _b: any, user) => {
  const rows = await query(
    `SELECT o.id, o.order_no, o.status, o.hold_reason, o.size_lock, s.name student_name, s.student_no,
            s.status student_status, c.name class_name, p.name plan_name,
            COUNT(oi.id) item_kinds, COALESCE(SUM(oi.qty),0) total_qty,
            CASE
              WHEN s.status='transferred' THEN '学生已转学'
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
     WHERE p.supplier_id=? AND o.status <> 'paid'
     GROUP BY o.id
     ORDER BY p.id, o.id`, [user.supplier_id || -1]);

  // 已缴费但尺码未闭环：风险占位（漏测未补测/仅参考尺码）/ 待复核（班主任家长两次确认不一致）
  const sizeBlocked = await query(
    `SELECT o.id, o.order_no, o.size_lock, s.name student_name, s.student_no,
            c.name class_name, p.name plan_name,
            COUNT(oi.id) item_kinds, COALESCE(SUM(oi.qty),0) total_qty,
            CASE
              WHEN o.size_lock='risk_placeholder' THEN '漏测风险占位：仅家长参考尺码，补测未闭环，不能计入正式生产数量'
              WHEN o.size_lock='review' THEN '班主任实测与家长确认不一致，订单待复核，不能锁定生产'
            END block_reason,
            (SELECT COUNT(*) FROM makeup_students mk WHERE mk.order_id=o.id) makeup_cnt
       FROM orders o
       JOIN students s ON s.id=o.student_id
       JOIN classes c ON c.id=o.class_id
       JOIN plans p ON p.id=o.plan_id
       JOIN order_items oi ON oi.order_id=o.id
      WHERE p.supplier_id=? AND o.status='paid' AND o.size_lock IN ('risk_placeholder','review')
      GROUP BY o.id
      ORDER BY o.size_lock, o.id`, [user.supplier_id || -1]);

  // 总务预锁（按参考尺码）允许投产但需供应商知悉风险
  const prelocked = await query(
    `SELECT o.id, o.order_no, s.name student_name, s.student_no, c.name class_name, p.name plan_name,
            COALESCE(SUM(oi.qty),0) total_qty
       FROM orders o
       JOIN students s ON s.id=o.student_id
       JOIN classes c ON c.id=o.class_id
       JOIN plans p ON p.id=o.plan_id
       JOIN order_items oi ON oi.order_id=o.id
      WHERE p.supplier_id=? AND o.status='paid' AND o.size_lock='prelocked'
      GROUP BY o.id ORDER BY o.id`, [user.supplier_id || -1]);

  const summary = await query(
    `SELECT o.status, o.size_lock, COUNT(DISTINCT o.id) cnt, COALESCE(SUM(oi.qty),0) qty
     FROM orders o JOIN plans p ON p.id=o.plan_id
     JOIN order_items oi ON oi.order_id=o.id
     WHERE p.supplier_id=? GROUP BY o.status, o.size_lock`, [user.supplier_id || -1]);
  return ok({ blocked: rows, size_blocked: sizeBlocked, prelocked, summary });
}, ['supplier', 'factory', 'admin', 'general_affairs']);
