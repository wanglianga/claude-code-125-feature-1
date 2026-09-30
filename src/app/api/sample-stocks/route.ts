import { NextRequest } from 'next/server';
import { query, one } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';

// 供应商样衣库存（按计划+校区+品类+尺码）
export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const where: string[] = [];
  const params: any[] = [];
  if (user.role === 'supplier' || user.role === 'factory') { where.push('ss.supplier_id=?'); params.push(user.supplier_id); }
  for (const k of ['plan_id', 'campus_id']) {
    const v = sp.get(k);
    if (v) { where.push(`ss.${k}=?`); params.push(v); }
  }
  const rows = await query(
    `SELECT ss.*, p.name plan_name, cp.name campus_name, s.name supplier_name,
            pi.name item_name, pi.garment_type,
            (SELECT COALESCE(SUM(sr.qty),0) FROM sample_reservations sr
               JOIN makeup_sessions ms ON ms.id=sr.makeup_session_id
              WHERE sr.sample_stock_id=ss.id AND sr.status='held'
                AND ms.status IN ('confirmed','adjusted')
                AND ms.start_time <= NOW() AND ms.end_time >= NOW()) held_now
       FROM sample_stocks ss
       JOIN plans p ON p.id=ss.plan_id
       JOIN campuses cp ON cp.id=ss.campus_id
       JOIN suppliers s ON s.id=ss.supplier_id
       JOIN plan_items pi ON pi.id=ss.plan_item_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY ss.plan_id, cp.id, pi.id, ss.size`, params);
  return ok({ stocks: rows });
});

// 新增或调整样衣数量（按唯一键 upsert）
export const POST = api(async (_req: NextRequest, body: any, user) => {
  const plan = await one<any>('SELECT * FROM plans WHERE id=?', [body.plan_id]);
  if (!plan) return fail('计划不存在', 404);
  if (user.supplier_id && plan.supplier_id !== user.supplier_id) return fail('只能维护本供应商计划的样衣', 403);
  const qty = Math.max(0, Number(body.total_qty) || 0);
  await query(
    `INSERT INTO sample_stocks (plan_id,campus_id,supplier_id,plan_item_id,size,total_qty)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE total_qty=VALUES(total_qty)`,
    [body.plan_id, body.campus_id, plan.supplier_id, body.plan_item_id, body.size, qty]);
  await logActivity({ actor: user, action: '维护样衣库存', detail: `计划#${body.plan_id} 品类#${body.plan_item_id} 尺码${body.size} 存量${qty}` });
  return ok();
}, ['supplier', 'factory', 'admin', 'general_affairs']);
