import { NextRequest } from 'next/server';
import { one, query } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';

// 资源总览：班主任空闲时间 + 各校区样衣库存
export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const aWhere: string[] = [];
  const aArgs: any[] = [];
  if (user.role === 'head_teacher') { aWhere.push('ta.teacher_user_id=?'); aArgs.push(user.id); }
  if (sp.get('campus_id')) { aWhere.push('ta.campus_id=?'); aArgs.push(sp.get('campus_id')); }
  const availabilities = await query(
    `SELECT ta.*, u.real_name teacher_name, c.name campus_name
       FROM teacher_availabilities ta
       JOIN users u ON u.id=ta.teacher_user_id
       JOIN campuses c ON c.id=ta.campus_id
       ${aWhere.length ? 'WHERE ' + aWhere.join(' AND ') : ''}
       ORDER BY ta.start_time`, aArgs);

  const sWhere: string[] = [];
  const sArgs: any[] = [];
  if (user.role === 'supplier' || user.role === 'factory') { sWhere.push('ss.supplier_id=?'); sArgs.push(user.supplier_id); }
  if (sp.get('campus_id')) { sWhere.push('ss.campus_id=?'); sArgs.push(sp.get('campus_id')); }
  const stock = await query(
    `SELECT ss.*, s.name supplier_name, c.name campus_name
       FROM sample_stock ss
       JOIN suppliers s ON s.id=ss.supplier_id
       JOIN campuses c ON c.id=ss.campus_id
       ${sWhere.length ? 'WHERE ' + sWhere.join(' AND ') : ''}
       ORDER BY ss.campus_id, ss.size`, sArgs);
  return ok({ availabilities, stock });
});

export const POST = api(async (_req: NextRequest, body: any, user) => {
  if (body.kind === 'availability') return saveAvailability(body, user);
  if (body.kind === 'stock') return saveStock(body, user);
  return fail('未知资源类型');
}, ['head_teacher', 'general_affairs', 'admin', 'supplier']);

// 班主任维护空闲时间（总务/管理员可代维护）
async function saveAvailability(body: any, user: any) {
  if (!body.start_time || !body.end_time) return fail('请填写空闲起止时间');
  if (new Date(body.end_time) <= new Date(body.start_time)) return fail('结束时间必须晚于开始时间');
  let teacherId = user.id;
  let campusId = body.campus_id || user.campus_id;
  if (['general_affairs', 'admin'].includes(user.role)) {
    if (!body.teacher_user_id || !body.campus_id) return fail('请选择班主任与校区');
    teacherId = body.teacher_user_id;
    campusId = body.campus_id;
  } else {
    const t = await one<any>('SELECT campus_id FROM users WHERE id=?', [teacherId]);
    campusId = t?.campus_id || campusId;
  }
  const r = await query(
    `INSERT INTO teacher_availabilities (teacher_user_id,campus_id,start_time,end_time,note)
     VALUES (?,?,?,?,?)`,
    [teacherId, campusId, body.start_time, body.end_time, body.note || null]);
  await logActivity({ actor: user, action: '维护班主任空闲时间', detail: `${body.start_time} ~ ${body.end_time}` });
  return ok({ id: (r as any).insertId });
}

// 供应商维护各校区可用尺码样衣库存（upsert）
async function saveStock(body: any, user: any) {
  if (!['supplier', 'admin', 'general_affairs'].includes(user.role)) return fail('无权限', 403);
  if (!body.campus_id || !body.size || body.qty === undefined) return fail('请填写校区、尺码、数量');
  const supplierId = user.supplier_id || body.supplier_id;
  if (!supplierId) return fail('缺少供应商');
  await query(
    `INSERT INTO sample_stock (supplier_id,campus_id,size,qty) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE qty=VALUES(qty)`,
    [supplierId, body.campus_id, String(body.size), Math.max(0, Number(body.qty) || 0)]);
  await logActivity({ actor: user, action: '维护样衣库存', detail: `校区#${body.campus_id} 尺码${body.size} × ${body.qty}` });
  return ok();
}

export const DELETE = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind');
  const id = sp.get('id');
  if (!id) return fail('缺少 id');
  if (kind === 'availability') {
    await query('DELETE FROM teacher_availabilities WHERE id=?', [id]);
    return ok();
  }
  if (kind === 'stock') {
    await query('DELETE FROM sample_stock WHERE id=?', [id]);
    return ok();
  }
  return fail('未知资源类型');
}, ['head_teacher', 'general_affairs', 'admin', 'supplier']);
