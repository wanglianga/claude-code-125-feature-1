import { NextRequest } from 'next/server';
import { query, one } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';

// 班主任空闲时段（补测候选生成输入）。教师看自己；总务/管理员可按教师查
export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const where: string[] = [];
  const params: any[] = [];
  if (user.role === 'head_teacher') { where.push('ts.teacher_user_id=?'); params.push(user.id); }
  else if (sp.get('teacher_user_id')) { where.push('ts.teacher_user_id=?'); params.push(sp.get('teacher_user_id')); }
  if (sp.get('campus_id')) { where.push('ts.campus_id=?'); params.push(sp.get('campus_id')); }
  const rows = await query(
    `SELECT ts.*, u.real_name teacher_name, cp.name campus_name
       FROM teacher_slots ts
       JOIN users u ON u.id=ts.teacher_user_id
       JOIN campuses cp ON cp.id=ts.campus_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY ts.start_time`, params);
  return ok({ slots: rows });
});

export const POST = api(async (_req: NextRequest, body: any, user) => {
  const teacherId = user.role === 'head_teacher' ? user.id : (body.teacher_user_id || user.id);
  if (!body.start_time || !body.end_time || !body.campus_id) return fail('校区、起止时间必填');
  if (new Date(body.end_time) <= new Date(body.start_time)) return fail('结束时间需晚于开始时间');
  const r = await query(
    `INSERT INTO teacher_slots (teacher_user_id,campus_id,start_time,end_time,note)
     VALUES (?,?,?,?,?)`,
    [teacherId, body.campus_id, body.start_time, body.end_time, body.note || null]);
  await logActivity({ actor: user, action: '维护班主任空闲时段', detail: `${body.start_time} ~ ${body.end_time}` });
  return ok({ id: (r as any).insertId });
}, ['head_teacher', 'general_affairs', 'admin']);

export const DELETE = api(async (_req: NextRequest, _b: any, user) => {
  const id = Number(new URL(_req.url).searchParams.get('id') || 0);
  const slot = await one<any>('SELECT * FROM teacher_slots WHERE id=?', [id]);
  if (!slot) return fail('时段不存在', 404);
  if (user.role === 'head_teacher' && slot.teacher_user_id !== user.id) return fail('只能删除自己的空闲时段', 403);
  await query('DELETE FROM teacher_slots WHERE id=?', [id]);
  return ok();
}, ['head_teacher', 'general_affairs', 'admin']);
