import { NextRequest } from 'next/server';
import { one, query, tx } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';
import { pickSizes, sizesEqual, recomputeClass } from '@/lib/makeup';

// 单生补测明细（家长/老师/总务查看）
export const GET = api(async (_req: NextRequest, _b: any, user, ctx) => {
  const id = ctx.params.id;
  const mk = await one<any>(
    `SELECT mk.*, s.name student_name, s.student_no, s.parent_user_id,
            c.name class_name, cp.name campus_name, o.order_no, o.status order_status,
            o.size_lock, o.risk_placeholder, p.name plan_name, p.production_deadline
       FROM makeup_students mk
       JOIN students s ON s.id=mk.student_id
       JOIN classes c ON c.id=mk.class_id
       JOIN campuses cp ON cp.id=s.campus_id
       JOIN orders o ON o.id=mk.order_id
       JOIN plans p ON p.id=mk.plan_id
      WHERE mk.id=?`, [id]);
  if (!mk) return fail('补测记录不存在', 404);
  if (user.role === 'parent' && mk.parent_user_id !== user.id) return fail('只能查看自己孩子', 403);
  const items = await query(
    `SELECT oi.* FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.id=? ORDER BY oi.id`,
    [mk.order_id]);
  return ok({ makeup: mk, items });
});

// 动作：submit_ref 家长提交参考尺码 / parent_confirm 家长确认最终尺码 /
//       ga_decision 总务 prelock 预锁 | postpone 延后
export const POST = api(async (_req: NextRequest, body: any, user, ctx) => {
  const id = Number(ctx.params.id);
  const mk = await one<any>('SELECT * FROM makeup_students WHERE id=?', [id]);
  if (!mk) return fail('补测记录不存在', 404);
  const ownChild = async () => {
    const st = await one('SELECT parent_user_id FROM students WHERE id=?', [mk.student_id]);
    return st?.parent_user_id === user.id;
  };

  if (body.action === 'submit_ref') {
    if (user.role === 'parent' && !(await ownChild())) return fail('无权限', 403);
    if (!['pending_ref', 'waiting', 'overdue', 'sample_shortage'].includes(mk.status))
      return fail('当前状态不能提交参考尺码');
    const z = body.sizes || {};
    await query(
      `UPDATE makeup_students SET ref_size_top=?,ref_size_pants=?,ref_size_skirt=?,ref_size_coat=?,ref_size_shoes=?,
          ref_submitted_at=NOW(),
          status=CASE WHEN status='pending_ref' THEN 'waiting' ELSE status END
        WHERE id=?`,
      [z.top || null, z.pants || null, z.skirt || null, z.coat || null, z.shoes || null, id]);
    // 参考尺码同步到订单明细供供应商查看，但订单始终保持风险占位，不计正式数量
    await syncOrderItemSizes(mk, z);
    await query("UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1 WHERE id=?", [mk.order_id]);
    await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user,
      action: '家长提交参考尺码', detail: `上衣${z.top || '-'} 裤${z.pants || '-'} 裙${z.skirt || '-'} 外套${z.coat || '-'} 鞋${z.shoes || '-'}（风险占位，不计正式数量）` });
    return ok();
  }

  if (body.action === 'parent_confirm') {
    if (user.role === 'parent' && !(await ownChild())) return fail('无权限', 403);
    if (mk.status !== 'teacher_done')
      return fail('班主任尚未确认测量记录，或已超过家长确认时限，家长暂不能确认');
    if (!mk.teacher_confirmed) return fail('需班主任先确认测量记录');
    const z = body.sizes ? {
      top: body.sizes.top || null, pants: body.sizes.pants || null, skirt: body.sizes.skirt || null,
      coat: body.sizes.coat || null, shoes: body.sizes.shoes || null,
    } : pickSizes(mk, 'meas');

    await tx(async (conn) => {
      await conn.query(
        `UPDATE makeup_students SET parent_confirmed=1, parent_confirmed_at=NOW() WHERE id=?`, [id]);
      if (sizesEqual(z, pickSizes(mk, 'meas'))) {
        // 两次确认一致：闭环，正式锁定，订单明细更新为实测尺码
        const allocated = await one(
          `SELECT COUNT(*) c FROM batch_allocations ba JOIN order_items oi ON oi.id=ba.order_item_id
            WHERE oi.order_id=?`, [mk.order_id]);
        if (Number(allocated?.c || 0) > 0)
          throw Object.assign(new Error('该订单已存在生产分配，请先联系供应商调整批次后再锁定'), { status: 400 });
        await conn.query(
          `UPDATE makeup_students SET status='closed' WHERE id=?`, [id]);
        await applyFinalSizes(conn, mk, z);
        await conn.query(
          `UPDATE orders SET size_lock='locked', risk_placeholder=0 WHERE id=?`, [mk.order_id]);
      } else {
        // 两次确认不一致：待复核，供应商不能锁定生产
        await conn.query(`UPDATE makeup_students SET status='review' WHERE id=?`, [id]);
        await conn.query(`UPDATE orders SET size_lock='review', risk_placeholder=1 WHERE id=?`, [mk.order_id]);
      }
    });

    const after = await one<any>('SELECT status FROM makeup_students WHERE id=?', [id]);
    await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user,
      action: after.status === 'closed' ? '家长确认最终尺码-一致闭环' : '家长确认最终尺码-不一致待复核',
      detail: `家长确认 上衣${z.top || '-'} 鞋${z.shoes || '-'}；班主任实测 上衣${mk.meas_size_top || '-'} 鞋${mk.meas_size_shoes || '-'}` });
    if (after.status === 'closed') await logRecompute(mk, user, '补测闭环，按实测尺码正式锁定');
    return ok({ status: after.status });
  }

  if (body.action === 'review_resolve') {
    // 复核处理：总务/管理员按最终尺码裁定（家长与班主任重新对齐后）
    if (!['general_affairs', 'admin'].includes(user.role)) return fail('仅总务可复核裁定', 403);
    if (mk.status !== 'review') return fail('仅待复核记录可裁定');
    const z = body.sizes ? {
      top: body.sizes.top || null, pants: body.sizes.pants || null, skirt: body.sizes.skirt || null,
      coat: body.sizes.coat || null, shoes: body.sizes.shoes || null,
    } : pickSizes(mk, 'meas');
    await tx(async (conn) => {
      await conn.query(`UPDATE makeup_students SET status='closed', parent_confirmed=1, parent_confirmed_at=NOW() WHERE id=?`, [id]);
      await applyFinalSizes(conn, mk, z);
      await conn.query(`UPDATE orders SET size_lock='locked', risk_placeholder=0 WHERE id=?`, [mk.order_id]);
    });
    await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: '待复核裁定闭环',
      detail: `${body.reason || '总务裁定'}：上衣${z.top || '-'} 鞋${z.shoes || '-'}` });
    await logRecompute(mk, user, '复核裁定后正式锁定');
    return ok();
  }

  if (body.action === 'ga_decision') {
    if (!['general_affairs', 'admin'].includes(user.role)) return fail('仅总务可在生产截止日做预锁/延后决定', 403);
    if (!body.reason) return fail('必须填写决定原因（留入学生订单与班级进度）');
    if (!['prelock', 'postpone'].includes(body.decision)) return fail('决定类型非法');

    await tx(async (conn) => {
      if (body.decision === 'prelock') {
        // 按家长参考尺码预锁：计入正式数量但标记预锁风险
        await conn.query(
          `UPDATE makeup_students SET status='prelocked', ga_decision_by=?, ga_decision_at=NOW(),
              ga_decision_reason=CONCAT('按参考尺码预锁：', ?) WHERE id=?`,
          [user.id, body.reason, id]);
        await conn.query(`UPDATE orders SET size_lock='prelocked', risk_placeholder=0 WHERE id=?`, [mk.order_id]);
      } else {
        // 延后该学生：不计入本批生产
        await conn.query(
          `UPDATE makeup_students SET status='postponed', ga_decision_by=?, ga_decision_at=NOW(),
              ga_decision_reason=CONCAT('延后该学生：', ?) WHERE id=?`,
          [user.id, body.reason, id]);
        await conn.query(`UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1,
            hold_reason=CONCAT_WS('；', hold_reason, '补测未闭环，总务批准延后') WHERE id=?`, [mk.order_id]);
      }
      // 相关未闭环异常一并留痕关闭
      await conn.query(
        `UPDATE makeup_exceptions SET status='resolved', resolved_by=?, resolved_at=NOW(),
            resolution=CONCAT(?, '（总务决定：', ?, '）')
          WHERE student_id=? AND plan_id=? AND status='open'
            AND type IN ('makeup_overdue','parent_timeout','sample_shortage')`,
        [user.id, body.decision === 'prelock' ? '按参考尺码预锁' : '延后该学生', body.reason,
         mk.student_id, mk.plan_id]);
    });
    await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user,
      action: body.decision === 'prelock' ? '生产截止日-按参考尺码预锁' : '生产截止日-延后该学生',
      detail: body.reason });
    await logRecompute(mk, user, body.decision === 'prelock' ? '总务按参考尺码预锁' : '总务延后该学生');
    return ok({ decision: body.decision });
  }

  return fail('未知操作');
}, ['parent', 'head_teacher', 'general_affairs', 'admin']);

// 把尺码集合按部位写回订单明细（参考尺码阶段也会调用，仅更新尺寸文本，不改变锁状态）
async function syncOrderItemSizes(mk: any, z: any) {
  const map: Record<string, string | null> = {
    top: z.top || null, pants: z.pants || null, skirt: z.skirt || null,
    coat: z.coat || null, shoes: z.shoes || null,
  };
  const items = await query<any>('SELECT id, garment_type FROM order_items WHERE order_id=?', [mk.order_id]);
  for (const it of items) {
    const v = map[it.garment_type];
    if (v) await query('UPDATE order_items SET size=? WHERE id=?', [v, it.id]);
  }
}

// 闭环/预锁裁定时按最终尺码更新订单明细
async function applyFinalSizes(conn: any, mk: any, z: any) {
  const map: Record<string, string | null> = {
    top: z.top || null, pants: z.pants || null, skirt: z.skirt || null,
    coat: z.coat || null, shoes: z.shoes || null,
  };
  const [items]: any = await conn.query('SELECT id, garment_type FROM order_items WHERE order_id=?', [mk.order_id]);
  for (const it of items) {
    const v = map[it.garment_type];
    if (v) await conn.query('UPDATE order_items SET size=? WHERE id=?', [v, it.id]);
  }
}

// 重算班级数量/批次/到校承诺并把影响写入时间线（学生订单 + 班级进度可追溯）
async function logRecompute(mk: any, user: any, reason: string) {
  const r = await recomputeClass(mk.plan_id, mk.class_id);
  await logActivity({
    student_id: mk.student_id, order_id: mk.order_id, actor: user,
    action: '系统重算班级数量与生产批次',
    detail: `${reason}；班级正式数量 ${r.formal_total} 件，未分配 ${r.formal_lines.reduce((a, l) => a + l.unallocated_qty, 0)} 件，` +
      `关联批次 ${r.affected_batches.length} 个（${r.affected_batches.map((b) => b.batch_no).join(',') || '无'}），` +
      `到校承诺 ${r.promised_arrival || '待定'}；风险占位 ${r.risk_placeholders.length} 人`,
  });
}
