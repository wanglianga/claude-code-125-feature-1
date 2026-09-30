import { NextRequest } from 'next/server';
import { query, one, tx } from '@/lib/db';
import { api, ok, fail, logActivity, genNo } from '@/lib/api';

export const GET = api(async (req: NextRequest, _b: any, user) => {
  const sp = req.nextUrl.searchParams;
  const where: string[] = [];
  const params: any[] = [];
  if (user.role === 'supplier' || user.role === 'factory') {
    where.push('pb.supplier_id=?'); params.push(user.supplier_id);
  }
  if (sp.get('plan_id')) { where.push('pb.plan_id=?'); params.push(sp.get('plan_id')); }
  const rows = await query(
    `SELECT pb.*, p.name plan_name, s.name supplier_name,
            (SELECT COUNT(*) FROM batch_items bi WHERE bi.batch_id=pb.id) line_kinds,
            (SELECT COALESCE(SUM(bi.qty),0) FROM batch_items bi WHERE bi.batch_id=pb.id) plan_qty,
            (SELECT COALESCE(SUM(bi.produced_qty),0) FROM batch_items bi WHERE bi.batch_id=pb.id) produced_qty,
            (SELECT COUNT(*) FROM shipments sh WHERE sh.batch_id=pb.id) shipment_count
     FROM production_batches pb
     JOIN plans p ON p.id=pb.plan_id JOIN suppliers s ON s.id=pb.supplier_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY pb.id DESC`, params);
  return ok({ batches: rows });
});

// 供应商/工厂创建生产批次：按 品类+尺码 数量，系统 FIFO 分配到已缴费学生的订单明细
export const POST = api(async (_req: NextRequest, body: any, user) => {
  const plan = await one<any>('SELECT * FROM plans WHERE id=?', [body.plan_id]);
  if (!plan) return fail('计划不存在', 404);
  if (user.supplier_id && plan.supplier_id !== user.supplier_id) return fail('只能为本供应商的计划建批次', 403);
  const lines: any[] = body.lines || [];
  if (!lines.length) return fail('请填写批次明细');

  const batchId = await tx(async (conn) => {
    const [r]: any = await conn.query(
      `INSERT INTO production_batches (batch_no,plan_id,supplier_id,name,status,expected_arrival,created_by)
       VALUES (?,?,?,?, 'planned', ?, ?)`,
      [genNo('PB'), plan.id, plan.supplier_id, body.name || `${plan.name}-生产批次`,
       body.expected_arrival || null, user.id]);
    const batchId = r.insertId;

    for (const ln of lines) {
      const qty = Number(ln.qty);
      if (!ln.plan_item_id || !ln.size || qty <= 0) continue;
      // 取该品类+尺码下 已缴费、在校、尺码已正式锁定（漏测风险占位/待复核不计正式数量）的明细，按下单时间 FIFO
      const [cands]: any = await conn.query(
        `SELECT oi.id, oi.qty,
                oi.qty - COALESCE((SELECT SUM(ba.qty) FROM batch_allocations ba
                                    JOIN batch_items bi2 ON bi2.id=ba.batch_item_id
                                    JOIN production_batches pb2 ON pb2.id=bi2.batch_id
                                   WHERE ba.order_item_id=oi.id AND pb2.status<>'completed'),0) remain
           FROM order_items oi
           JOIN orders o ON o.id=oi.order_id
           JOIN students st ON st.id=o.student_id
          WHERE oi.plan_item_id=? AND oi.size=? AND o.status='paid' AND st.status='active'
            AND o.size_lock NOT IN ('risk_placeholder','review')
         HAVING remain > 0
          ORDER BY o.paid_at, o.id`,
        [ln.plan_item_id, ln.size]);
      let need = qty;
      const [bi]: any = await conn.query(
        'INSERT INTO batch_items (batch_id,plan_item_id,size,qty) VALUES (?,?,?,?)',
        [batchId, ln.plan_item_id, ln.size, qty]);
      const biId = bi.insertId;
      for (const c of cands) {
        if (need <= 0) break;
        const take = Math.min(need, c.remain);
        await conn.query('INSERT INTO batch_allocations (batch_item_id,order_item_id,qty) VALUES (?,?,?)',
          [biId, c.id, take]);
        need -= take;
      }
      if (need > 0) {
        throw Object.assign(new Error(`品类#${ln.plan_item_id} 尺码 ${ln.size} 可投产数量不足，还差 ${need} 件（未缴费/挂起订单不计入）`), { status: 400 });
      }
    }
    return batchId;
  });
  await logActivity({ actor: user, action: '创建生产批次', detail: body.name, order_id: null });
  return ok({ id: batchId });
}, ['supplier', 'factory', 'admin']);
