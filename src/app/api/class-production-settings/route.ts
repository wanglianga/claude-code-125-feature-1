import { NextRequest } from 'next/server';
import { query, one } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';

// 班级生产设置（生产截止日 / 到校承诺），总务维护
export const GET = api(async (req: NextRequest, _b: any) => {
  const sp = req.nextUrl.searchParams;
  const where: string[] = [];
  const params: any[] = [];
  if (sp.get('plan_id')) { where.push('cps.plan_id=?'); params.push(sp.get('plan_id')); }
  if (sp.get('class_id')) { where.push('cps.class_id=?'); params.push(sp.get('class_id')); }
  const rows = await query(
    `SELECT cps.*, c.name class_name, p.name plan_name
       FROM class_production_settings cps
       JOIN classes c ON c.id=cps.class_id
       JOIN plans p ON p.id=cps.plan_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY cps.production_deadline`, params);
  return ok({ settings: rows });
});

export const POST = api(async (_req: NextRequest, body: any, user) => {
  if (!body.plan_id || !body.class_id || !body.production_deadline) return fail('计划、班级、生产截止日必填');
  await query(
    `INSERT INTO class_production_settings (plan_id,class_id,production_deadline,promised_arrival,updated_by)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE production_deadline=VALUES(production_deadline),
       promised_arrival=VALUES(promised_arrival), updated_by=VALUES(updated_by)`,
    [body.plan_id, body.class_id, body.production_deadline, body.promised_arrival || null, user.id]);
  await logActivity({ actor: user, action: '维护班级生产截止日', detail: `班级#${body.class_id} 截止 ${body.production_deadline} 到校 ${body.promised_arrival || '待定'}` });
  return ok();
}, ['general_affairs', 'admin']);
