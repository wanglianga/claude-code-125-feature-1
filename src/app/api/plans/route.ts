import { NextRequest } from 'next/server';
import { query, one, tx } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';

export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const where: string[] = [];
  const params: any[] = [];
  if (user.role === 'supplier' || user.role === 'factory') {
    where.push('p.supplier_id=?');
    params.push(user.supplier_id);
  } else if (user.role === 'parent' || user.role === 'head_teacher') {
    if (user.campus_id) { where.push('EXISTS(SELECT 1 FROM plan_campuses pc WHERE pc.plan_id=p.id AND pc.campus_id=?)'); params.push(user.campus_id); }
  } else if (user.campus_id) {
    where.push('EXISTS(SELECT 1 FROM plan_campuses pc WHERE pc.plan_id=p.id AND pc.campus_id=?)');
    params.push(user.campus_id);
  }
  if (sp.get('status')) { where.push('p.status=?'); params.push(sp.get('status')); }
  const rows = await query(
    `SELECT p.*, s.name supplier_name,
       (SELECT GROUP_CONCAT(cp.name SEPARATOR '、') FROM plan_campuses pc JOIN campuses cp ON cp.id=pc.campus_id WHERE pc.plan_id=p.id) campus_names,
       (SELECT COUNT(*) FROM orders o WHERE o.plan_id=p.id) order_count
     FROM plans p JOIN suppliers s ON s.id=p.supplier_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.id DESC`, params);
  return ok({ plans: rows });
});

// 总务维护订购计划（年度统一采购 / 毕业班补订）
export const POST = api(async (_req: NextRequest, body: any, user) => {
  if (!body.name || !body.supplier_id || !body.order_deadline) return fail('计划名称、供应商、截止时间必填');
  const id = await tx(async (conn) => {
    const [r]: any = await conn.query(
      `INSERT INTO plans (name,kind,academic_year,season,supplier_id,status,order_deadline,production_deadline,fitting_date,note,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [body.name, body.kind || 'annual', body.academic_year, body.season || '春秋',
       body.supplier_id, body.status || 'draft', body.order_deadline, body.production_deadline || null,
       body.fitting_date || null, body.note || null, user.id]);
    const pid = r.insertId;
    for (const cid of body.campus_ids || []) {
      await conn.query('INSERT IGNORE INTO plan_campuses (plan_id,campus_id) VALUES (?,?)', [pid, cid]);
    }
    for (const gid of body.grade_ids || []) {
      await conn.query('INSERT IGNORE INTO plan_grades (plan_id,grade_id) VALUES (?,?)', [pid, gid]);
    }
    for (const it of body.items || []) {
      await conn.query(
        `INSERT INTO plan_items (plan_id,name,suit_kind,garment_type,price,required) VALUES (?,?,?,?,?,?)`,
        [pid, it.name, it.suit_kind, it.garment_type, it.price || 0, it.required ? 1 : 0]);
    }
    return pid;
  });
  await logActivity({ actor: user, action: '创建订购计划', detail: body.name, order_id: null });
  return ok({ id });
}, ['admin', 'general_affairs']);

export const PATCH = api(async (_req: NextRequest, body: any, user) => {
  const p = await one('SELECT * FROM plans WHERE id=?', [body.id]);
  if (!p) return fail('计划不存在', 404);
  if (body.status && body.status !== p.status && !['draft', 'open', 'closed'].includes(body.status))
    return fail('状态非法');
  await query('UPDATE plans SET status=COALESCE(?,status), fitting_date=COALESCE(?,fitting_date), production_deadline=COALESCE(?,production_deadline) WHERE id=?',
    [body.status || null, body.fitting_date || null, body.production_deadline || null, body.id]);
  await logActivity({ actor: user, action: '更新计划', detail: body.status ? `状态→${body.status}` : p.name });
  return ok();
}, ['admin', 'general_affairs']);
