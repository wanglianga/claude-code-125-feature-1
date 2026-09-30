import { NextRequest } from 'next/server';
import { one, query, tx } from '@/lib/db';
import { api, ok, fail, logActivity } from '@/lib/api';
import { teacherTimeClash, sampleShortage } from '@/lib/makeup';

// 补测场次详情：学生明细 + 样衣占用
export const GET = api(async (_req: NextRequest, _b: any, user, ctx) => {
  const id = ctx.params.id;
  const ms = await one<any>(
    `SELECT ms.*, c.name class_name, cp.name campus_name, u.real_name teacher_name, p.name plan_name,
            p.production_deadline, s.name supplier_name
       FROM makeup_sessions ms
       JOIN classes c ON c.id=ms.class_id
       JOIN campuses cp ON cp.id=ms.campus_id
       JOIN users u ON u.id=ms.teacher_user_id
       JOIN plans p ON p.id=ms.plan_id
       JOIN suppliers s ON s.id=ms.supplier_id
      WHERE ms.id=?`, [id]);
  if (!ms) return fail('补测场次不存在', 404);
  const [students, reservations] = await Promise.all([
    query(
      `SELECT mk.*, s.name student_name, s.student_no, s.height_cm, s.weight_kg, s.usual_size, o.order_no
         FROM makeup_students mk JOIN students s ON s.id=mk.student_id
         LEFT JOIN orders o ON o.id=mk.order_id
        WHERE mk.makeup_session_id=? ORDER BY s.student_no`, [id]),
    query('SELECT * FROM sample_reservations WHERE makeup_session_id=? ORDER BY size', [id]),
  ]);
  return ok({ session: ms, students, reservations });
});

// 人工调整候选/已排场次（时间、地点、老师必须填写调整原因，留痕）
export const PATCH = api(async (_req: NextRequest, body: any, user) => {
  const ms = await one<any>('SELECT * FROM makeup_sessions WHERE id=?', [body.id]);
  if (!ms) return fail('补测场次不存在', 404);
  if (!['head_teacher', 'general_affairs', 'admin'].includes(user.role)) return fail('无权限', 403);
  if (!body.adjust_reason) return fail('人工调整必须填写调整原因');
  if (user.role === 'head_teacher' && ms.teacher_user_id !== user.id) return fail('只能调整本班补测', 403);

  const start = body.start_time || ms.start_time;
  const end = body.end_time || ms.end_time;
  if (new Date(end) <= new Date(start)) return fail('结束时间必须晚于开始时间');
  if (body.teacher_user_id && Number(body.teacher_user_id) !== ms.teacher_user_id) {
    const clash = await teacherTimeClash(Number(body.teacher_user_id), start, end, ms.id);
    if (clash) return fail('该班主任此时段已有其他补测安排');
  } else {
    const clash = await teacherTimeClash(ms.teacher_user_id, start, end, ms.id);
    if (clash) return fail('班主任此时段已有其他补测安排');
  }
  const needSizes = (await query<any>('SELECT DISTINCT size FROM sample_reservations WHERE makeup_session_id=?', [ms.id]))
    .map((r) => r.size);
  const short = await sampleShortage(ms.campus_id, ms.supplier_id, start, end, needSizes, ms.id);
  if (short.length) return fail(`调整后样衣不足，缺尺码：${short.join('/')}`);

  await query(
    `UPDATE makeup_sessions SET start_time=?, end_time=?, location=?, teacher_user_id=?,
        adjusted_by=?, adjust_reason=CONCAT_WS(' | ', adjust_reason, ?) WHERE id=?`,
    [start, end, body.location || ms.location, body.teacher_user_id || ms.teacher_user_id,
     user.id, `${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${user.real_name}：${body.adjust_reason}`, ms.id]);
  await logActivity({ actor: user, action: '人工调整补测场次',
    detail: `${ms.id}：${body.adjust_reason}（${start} ${body.location || ms.location}）` });
  return ok();
});

// 场次动作：schedule 确认排期 / record 登记实测 / teacher_confirm 班主任确认 / complete 完成 / cancel 取消
export const POST = api(async (_req: NextRequest, body: any, user, ctx) => {
  const id = Number(ctx.params.id);
  const ms = await one<any>('SELECT * FROM makeup_sessions WHERE id=?', [id]);
  if (!ms) return fail('补测场次不存在', 404);

  if (body.action === 'schedule') {
    if (!['head_teacher', 'general_affairs', 'admin'].includes(user.role)) return fail('无权限', 403);
    if (user.role === 'head_teacher' && ms.teacher_user_id !== user.id) return fail('只能确认本班补测', 403);
    if (ms.status !== 'candidate') return fail('仅候选场次可确认排期');
    if (body.adjust_reason && (body.start_time || body.location)) {
      // 确认时一并调整：校验冲突
      const start = body.start_time || ms.start_time;
      const clash = await teacherTimeClash(ms.teacher_user_id, start, body.end_time || ms.end_time, ms.id);
      if (clash) return fail('班主任此时段已有其他补测安排');
    }
    await tx(async (conn) => {
      await conn.query(
        `UPDATE makeup_sessions SET status='scheduled', start_time=COALESCE(?,start_time),
           end_time=COALESCE(?,end_time), location=COALESCE(?,location),
           adjusted_by=IF(? IS NULL, adjusted_by, ?),
           adjust_reason=CONCAT_WS(' | ', adjust_reason, ?) WHERE id=?`,
        [body.start_time || null, body.end_time || null, body.location || null,
         body.adjust_reason ? user.id : null, body.adjust_reason ? user.id : null,
         body.adjust_reason ? `${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${user.real_name}：${body.adjust_reason}` : null, id]);
      // 生成对应的补穿试穿时段（试穿日页面可见，kind=makeup）
      const [dup]: any = await conn.query('SELECT id FROM fitting_sessions WHERE makeup_session_id=?', [id]);
      if (!dup.length) {
        await conn.query(
          `INSERT INTO fitting_sessions (plan_id,class_id,kind,makeup_session_id,start_time,end_time,location,organizer_user_id)
           SELECT plan_id,class_id,'makeup',id,start_time,end_time,location,teacher_user_id FROM makeup_sessions WHERE id=?`,
          [id]);
      }
    });
    await logActivity({ actor: user, action: '确认补测排期', detail: `场次#${id} ${ms.class_id} ${body.adjust_reason ? '（含人工调整：' + body.adjust_reason + '）' : ''}` });
    return ok();
  }

  if (body.action === 'cancel') {
    if (!['head_teacher', 'general_affairs', 'admin'].includes(user.role)) return fail('无权限', 403);
    if (!body.reason) return fail('取消补测必须填写原因');
    await tx(async (conn) => {
      await conn.query("UPDATE makeup_sessions SET status='cancelled', adjusted_by=?, adjust_reason=CONCAT_WS(' | ', adjust_reason, ?) WHERE id=?",
        [user.id, `取消：${body.reason}`, id]);
      await conn.query("UPDATE sample_reservations SET status='returned' WHERE makeup_session_id=?", [id]);
      await conn.query(
        `UPDATE makeup_students SET makeup_session_id=NULL,
            status=CASE WHEN status IN ('waiting','measured','teacher_done') THEN 'waiting' ELSE status END
          WHERE makeup_session_id=?`, [id]);
    });
    await logActivity({ actor: user, action: '取消补测场次', detail: `场次#${id}：${body.reason}` });
    return ok();
  }

  if (body.action === 'record') {
    if (!['head_teacher', 'general_affairs', 'admin'].includes(user.role)) return fail('无权限', 403);
    const mk = await one<any>('SELECT * FROM makeup_students WHERE id=? AND makeup_session_id=?', [body.student_id, id]);
    if (!mk) return fail('补测学生不存在', 404);
    if (!['waiting', 'overdue', 'sample_shortage', 'measured', 'teacher_done', 'review'].includes(mk.status))
      return fail(`当前状态（${mk.status}）不能登记实测，需家长先提交参考尺码`);
    const z = body.sizes || {};
    await tx(async (conn) => {
      // 候选未排期也允许补录实测：缺补穿时段时自动补建（kind=makeup）
      const [fsDup]: any = await conn.query('SELECT id FROM fitting_sessions WHERE makeup_session_id=?', [id]);
      if (!fsDup.length) {
        await conn.query(
          `INSERT INTO fitting_sessions (plan_id,class_id,kind,makeup_session_id,start_time,end_time,location,organizer_user_id)
           SELECT plan_id,class_id,'makeup',id,start_time,end_time,location,teacher_user_id FROM makeup_sessions WHERE id=?`,
          [id]);
      }
      await conn.query(
        `UPDATE makeup_students SET meas_size_top=?,meas_size_pants=?,meas_size_skirt=?,meas_size_coat=?,meas_size_shoes=?,
            measured_by=?, measured_at=NOW(), status='measured' WHERE id=?`,
        [z.top || null, z.pants || null, z.skirt || null, z.coat || null, z.shoes || null, user.id, mk.id]);
      await conn.query(
        `INSERT INTO fitting_records (session_id,student_id,staff_name,size_top,size_pants,size_skirt,size_coat,size_shoes,special_note)
         SELECT fs.id, ?, ?, ?,?,?,?,?,? FROM fitting_sessions fs WHERE fs.makeup_session_id=?
         ON DUPLICATE KEY UPDATE staff_name=VALUES(staff_name), size_top=VALUES(size_top),
           size_pants=VALUES(size_pants), size_skirt=VALUES(size_skirt), size_coat=VALUES(size_coat),
           size_shoes=VALUES(size_shoes), special_note=VALUES(special_note)`,
        [mk.student_id, user.real_name, z.top || null, z.pants || null, z.skirt || null,
         z.coat || null, z.shoes || null, '集中试穿漏测补测记录', id]);
    });
    await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user, action: '补测登记实测尺码',
      detail: `上衣${z.top || '-'} 裤${z.pants || '-'} 裙${z.skirt || '-'} 外套${z.coat || '-'} 鞋${z.shoes || '-'}` });
    return ok();
  }

  if (body.action === 'teacher_confirm') {
    if (!['head_teacher', 'general_affairs', 'admin'].includes(user.role)) return fail('无权限', 403);
    const ids: number[] = body.student_ids || (body.student_id ? [body.student_id] : []);
    if (!ids.length) return fail('请选择要确认的学生');
    const plan = await one<any>('SELECT production_deadline FROM plans WHERE id=?', [ms.plan_id]);
    const deadline = body.deadline || plan?.production_deadline
      || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    let n = 0;
    for (const sid of ids) {
      const mk = await one<any>('SELECT * FROM makeup_students WHERE id=? AND makeup_session_id=?', [sid, id]);
      if (!mk || mk.status !== 'measured') continue;
      if (!mk.meas_size_top && !mk.meas_size_pants && !mk.meas_size_skirt && !mk.meas_size_coat && !mk.meas_size_shoes)
        return fail('存在未登记实测尺码的学生，不能确认');
      await query(
        `UPDATE makeup_students SET teacher_confirmed=1, teacher_confirmed_at=NOW(),
            status='teacher_done', deadline=? WHERE id=?`,
        [deadline, sid]);
      await logActivity({ student_id: mk.student_id, order_id: mk.order_id, actor: user,
        action: '班主任确认测量记录', detail: `等待家长在 ${deadline} 前确认最终尺码` });
      n++;
    }
    return ok({ confirmed: n, deadline });
  }

  if (body.action === 'complete') {
    if (!['head_teacher', 'general_affairs', 'admin'].includes(user.role)) return fail('无权限', 403);
    await tx(async (conn) => {
      await conn.query("UPDATE makeup_sessions SET status='completed' WHERE id=?", [id]);
      await conn.query("UPDATE sample_reservations SET status='returned' WHERE makeup_session_id=?", [id]);
    });
    await logActivity({ actor: user, action: '补测场次完成', detail: `场次#${id}，样衣归还` });
    return ok();
  }

  return fail('未知操作');
});
