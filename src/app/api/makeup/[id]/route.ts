import { NextRequest } from 'next/server';
import { one } from '@/lib/db';
import { api, ok, fail } from '@/lib/api';
import {
  submitReference, teacherRecord, teacherConfirm, parentConfirm,
  reviewDecision, deadlineDecision,
} from '@/lib/makeup';

// 单个补测学生链路详情
export const GET = api(async (_req: NextRequest, _b: any, user, ctx) => {
  const id = ctx.params.id;
  const mk = await one<any>(
    `SELECT mk.*, s.name student_name, s.student_no, s.parent_user_id,
            c.name class_name, c.teacher_user_id, p.name plan_name,
            o.order_no, o.status order_status, o.production_lock
       FROM makeup_students mk
       JOIN students s ON s.id=mk.student_id
       JOIN classes c ON c.id=mk.class_id
       JOIN plans p ON p.id=mk.plan_id
       LEFT JOIN orders o ON o.id=mk.order_id
      WHERE mk.id=?`, [id]);
  if (!mk) return fail('补测记录不存在', 404);
  if (user.role === 'parent' && mk.parent_user_id !== user.id) return fail('只能查看自己孩子', 403);
  if (user.role === 'head_teacher' && mk.teacher_user_id !== user.id) return fail('只能查看本班学生', 403);
  return ok({ makeup: mk });
});

// 补测学生动作：
// reference 家长交参考尺码 / record 班主任录入测量 / teacher_confirm / parent_confirm
// review 总务复核裁决 / prelock|defer 截止日处置
export const POST = api(async (_req: NextRequest, body: any, user) => {
  const id = Number(body.id);
  const mk = await one<any>('SELECT * FROM makeup_students WHERE id=?', [id]);
  if (!mk) return fail('补测记录不存在', 404);
  const guardParent = async () => {
    const s = await one<any>('SELECT parent_user_id FROM students WHERE id=?', [mk.student_id]);
    if (user.role === 'parent' && s?.parent_user_id !== user.id) throw Object.assign(new Error('只能操作自己孩子'), { status: 403 });
  };
  const guardTeacher = async () => {
    const c = await one<any>('SELECT teacher_user_id FROM classes WHERE id=?', [mk.class_id]);
    if (user.role === 'head_teacher' && c?.teacher_user_id !== user.id) throw Object.assign(new Error('只能操作本班学生'), { status: 403 });
  };

  switch (body.action) {
    case 'reference': {
      await guardParent();
      if (!['parent', 'admin', 'general_affairs'].includes(user.role)) return fail('仅家长可提交参考尺码', 403);
      return ok(await submitReference(id, body.sizes || {}, user));
    }
    case 'record': {
      await guardTeacher();
      if (!['head_teacher', 'admin', 'general_affairs'].includes(user.role)) return fail('无权限', 403);
      return ok(await teacherRecord(id, body, user));
    }
    case 'teacher_confirm': {
      await guardTeacher();
      if (!['head_teacher', 'admin', 'general_affairs'].includes(user.role)) return fail('无权限', 403);
      return ok(await teacherConfirm(id, user));
    }
    case 'parent_confirm': {
      await guardParent();
      if (!['parent', 'admin', 'general_affairs'].includes(user.role)) return fail('仅家长可最终确认', 403);
      return ok(await parentConfirm(id, body.sizes || {}, user));
    }
    case 'review': {
      if (!['general_affairs', 'admin'].includes(user.role)) return fail('仅总务可复核裁决', 403);
      if (!['use_teacher', 'use_parent', 'remeasure'].includes(body.decision)) return fail('裁决类型非法');
      return ok(await reviewDecision(id, body.decision, body.reason || '', user));
    }
    case 'prelock':
    case 'defer': {
      if (!['general_affairs', 'admin'].includes(user.role)) return fail('仅总务可做截止日处置', 403);
      return ok(await deadlineDecision(id, body.action, body.reason || '', user, body.promised_arrival));
    }
    default:
      return fail('未知操作');
  }
}, ['parent', 'head_teacher', 'general_affairs', 'admin']);
