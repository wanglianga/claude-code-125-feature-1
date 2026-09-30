import { NextRequest } from 'next/server';
import { query, one } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';
import { scanExceptions } from '@/lib/makeup';

// 异常台账（补测逾期/样衣不足/班主任超时/家长超时/截止日未闭环/两次确认不一致）
export const GET = api(async (req: NextRequest, _b: any, user) => {
  await scanExceptions().catch(() => {});
  const sp = req.nextUrl.searchParams;
  const w: string[] = [];
  const a: any[] = [];
  if (sp.get('plan_id')) { w.push('e.plan_id=?'); a.push(sp.get('plan_id')); }
  if (sp.get('status')) { w.push('e.status=?'); a.push(sp.get('status')); }
  if (sp.get('type')) { w.push('e.type=?'); a.push(sp.get('type')); }
  if (user.role === 'head_teacher') { w.push('c.teacher_user_id=?'); a.push(user.id); }
  if (user.role === 'parent') { w.push('s.parent_user_id=?'); a.push(user.id); }
  if (user.role === 'supplier' || user.role === 'factory') { w.push('p.supplier_id=?'); a.push(user.supplier_id); }
  const rows = await query(
    `SELECT e.*, c.name class_name, s.name student_name, p.name plan_name,
            u.real_name acknowledged_name, u2.real_name resolved_name
       FROM makeup_exceptions e
       JOIN plans p ON p.id=e.plan_id
       LEFT JOIN classes c ON c.id=e.class_id
       LEFT JOIN students s ON s.id=e.student_id
       LEFT JOIN users u ON u.id=e.acknowledged_by
       LEFT JOIN users u2 ON u2.id=e.resolved_by
       ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
       ORDER BY (e.status='open') DESC, FIELD(e.type,'deadline_open','makeup_overdue','size_mismatch','sample_shortage','teacher_timeout','parent_timeout'), e.id DESC`,
    a);
  return ok({ exceptions: rows });
});

export const POST = api(async (_req: NextRequest, body: any, user) => {
  const e = await one<any>('SELECT * FROM makeup_exceptions WHERE id=?', [body.id]);
  if (!e) return fail('异常不存在', 404);
  if (body.action === 'acknowledge') {
    await query("UPDATE makeup_exceptions SET status='acknowledged', acknowledged_by=? WHERE id=? AND status='open'", [user.id, e.id]);
    await logActivity({ student_id: e.student_id, actor: user, action: '确认异常', detail: e.type });
    return ok();
  }
  if (body.action === 'resolve') {
    if (!body.resolution) return fail('解决需填写处理说明');
    await query("UPDATE makeup_exceptions SET status='resolved', resolved_by=?, resolved_at=NOW(), resolution=? WHERE id=?",
      [user.id, body.resolution, e.id]);
    await logActivity({ student_id: e.student_id, actor: user, action: '解决异常', detail: `${e.type}：${body.resolution}` });
    return ok();
  }
  return fail('未知操作');
}, ['head_teacher', 'general_affairs', 'admin', 'supplier', 'factory']);
