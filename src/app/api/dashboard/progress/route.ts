import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { api, ok } from '@/lib/api';

// 全校/全角色看板：按学生和班级聚合缴费/试穿/生产/发放/换码/售后进度
export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const planId = sp.get('plan_id');
  const classId = sp.get('class_id');
  const campusId = sp.get('campus_id') || (user.campus_id ? String(user.campus_id) : null);

  // —— 按学生汇总 ——
  const where: string[] = [];
  const whereArgs: any[] = [];
  if (planId) { where.push('o.plan_id=?'); whereArgs.push(planId); }
  if (classId) { where.push('o.class_id=?'); whereArgs.push(classId); }
  if (campusId) { where.push('s.campus_id=?'); whereArgs.push(campusId); }
  if (user.role === 'head_teacher') { where.push('c.teacher_user_id=?'); whereArgs.push(user.id); }
  if (user.role === 'parent') { where.push('s.parent_user_id=?'); whereArgs.push(user.id); }
  if (user.role === 'supplier' || user.role === 'factory') { where.push('p.supplier_id=?'); whereArgs.push(user.supplier_id); }
  const WHERE = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const subArgs = planId ? [planId, planId, planId, planId, planId] : [];
  const studentRows = await query(
    `SELECT s.id, s.name, s.student_no, s.status student_status,
            c.name class_name, g.name grade_name, cp.name campus_name,
            COUNT(o.id) order_count,
            COALESCE(SUM(o.status='paid'),0) paid_cnt,
            COALESCE(SUM(o.status='confirmed'),0) unpaid_cnt,
            COALESCE(SUM(o.status='hold'),0) hold_cnt,
            COALESCE(SUM(o.status='draft'),0) draft_cnt,
            COALESCE(SUM(o.status='cancelled'),0) cancelled_cnt,
            COALESCE(SUM(o.due_amount),0) due_total,
            COALESCE(SUM(o.paid_amount),0) paid_total,
            (SELECT COUNT(*) FROM fitting_records fr JOIN fitting_sessions fs ON fs.id=fr.session_id
              WHERE fr.student_id=s.id ${planId ? 'AND fs.plan_id=?' : ''}) fitted,
            (SELECT COALESCE(SUM(ba.qty),0) FROM batch_allocations ba
               JOIN batch_items bi ON bi.id=ba.batch_item_id
               JOIN production_batches pb ON pb.id=bi.batch_id
               JOIN order_items oi ON oi.id=ba.order_item_id
               JOIN orders o2 ON o2.id=oi.order_id
              WHERE o2.student_id=s.id ${planId ? 'AND pb.plan_id=?' : ''}) producing_qty,
            (SELECT COALESCE(SUM(oi.signed_qty),0) FROM order_items oi JOIN orders o2 ON o2.id=oi.order_id
              WHERE o2.student_id=s.id ${planId ? 'AND o2.plan_id=?' : ''}) signed_qty,
            (SELECT COUNT(*) FROM aftersales_cases ac WHERE ac.student_id=s.id AND ac.status IN ('open','processing')) open_cases,
            (SELECT mk.status FROM makeup_students mk WHERE mk.student_id=s.id ${planId ? 'AND mk.plan_id=?' : ''} ORDER BY mk.id DESC LIMIT 1) makeup_status,
            (SELECT COALESCE(MAX(o3.production_lock),'none') FROM orders o3 WHERE o3.student_id=s.id ${planId ? 'AND o3.plan_id=?' : ''}) production_lock
       FROM students s
       JOIN classes c ON c.id=s.class_id
       JOIN grades g ON g.id=s.grade_id
       JOIN campuses cp ON cp.id=s.campus_id
       LEFT JOIN orders o ON o.student_id=s.id
       LEFT JOIN plans p ON p.id=o.plan_id
      ${WHERE}
      GROUP BY s.id
      ORDER BY cp.id, g.id, c.id, s.student_no`,
    [...subArgs, ...whereArgs]);

  // —— 按班级汇总 ——
  const cWhere: string[] = [];
  const cArgs: any[] = [];
  if (campusId) { cWhere.push('cp.id=?'); cArgs.push(campusId); }
  if (user.role === 'head_teacher') { cWhere.push('c.teacher_user_id=?'); cArgs.push(user.id); }
  const classRows = await query(
    `SELECT c.id, c.name class_name, g.name grade_name, cp.name campus_name,
            COUNT(DISTINCT s.id) students,
            COUNT(DISTINCT o.id) orders,
            COALESCE(SUM(o.status='paid'),0) paid_cnt,
            COALESCE(SUM(o.status IN ('confirmed','hold')),0) pending_cnt,
            (SELECT COUNT(DISTINCT s2.id) FROM students s2
               JOIN fitting_records fr ON fr.student_id=s2.id
               JOIN fitting_sessions fs ON fs.id=fr.session_id
              WHERE fs.class_id=c.id ${planId ? 'AND fs.plan_id=?' : ''}) fitted_students,
            (SELECT COUNT(*) FROM makeup_students mk
              WHERE mk.class_id=c.id ${planId ? 'AND mk.plan_id=?' : ''}
                AND mk.status IN ('need_makeup','referenced','scheduled','measured','review')) makeup_open,
            (SELECT COUNT(*) FROM makeup_students mk
              WHERE mk.class_id=c.id ${planId ? 'AND mk.plan_id=?' : ''}
                AND mk.status IN ('locked','prelocked')) makeup_closed,
            (SELECT COUNT(*) FROM makeup_exceptions e
              WHERE e.class_id=c.id AND e.status='open' ${planId ? 'AND e.plan_id=?' : ''}) makeup_exc
       FROM classes c
       JOIN grades g ON g.id=c.grade_id
       JOIN campuses cp ON cp.id=g.campus_id
       JOIN students s ON s.class_id=c.id
       LEFT JOIN orders o ON o.student_id=s.id ${planId ? 'AND o.plan_id=?' : ''}
       ${cWhere.length ? 'WHERE ' + cWhere.join(' AND ') : ''}
       GROUP BY c.id ORDER BY cp.id, g.id, c.id`,
    [...(planId ? [planId, planId, planId, planId, planId] : []), ...cArgs]);

  return ok({ students: studentRows, classes: classRows });
});
