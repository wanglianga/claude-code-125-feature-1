import { one, query } from './db';

// 部位 → 补测表尺码列名
export const GARMENT_SIZE_COL: Record<string, string> = {
  top: 'size_top',
  pants: 'size_pants',
  skirt: 'size_skirt',
  coat: 'size_coat',
  shoes: 'size_shoes',
};
export const GARMENTS = ['top', 'pants', 'skirt', 'coat', 'shoes'] as const;

// 取一行（ref_/meas_ 前缀）的五类尺码
export function pickSizes(row: any, prefix: 'ref' | 'meas') {
  return {
    top: row[`${prefix}_size_top`] || null,
    pants: row[`${prefix}_size_pants`] || null,
    skirt: row[`${prefix}_size_skirt`] || null,
    coat: row[`${prefix}_size_coat`] || null,
    shoes: row[`${prefix}_size_shoes`] || null,
  };
}

// 两个尺码集合是否完全一致（仅比较双方都涉及的部位；任一处不同即不一致）
export function sizesEqual(a: Record<string, string | null>, b: Record<string, string | null>) {
  for (const g of GARMENTS) {
    const x = a[g] || null;
    const y = b[g] || null;
    if (!x && !y) continue;
    if (x !== y) return false;
  }
  return true;
}

// 找出计划内“漏测”的在校学生：有订单但该计划下无任何试穿（含补测）记录
export async function findMissingStudents(planId: number, classId?: number) {
  return query<any>(
    `SELECT s.id student_id, s.name student_name, s.student_no, s.class_id, c.name class_name,
            s.campus_id, cp.name campus_name, c.teacher_user_id,
            o.id order_id, o.order_no, o.status order_status, o.size_lock, o.risk_placeholder,
            (SELECT COUNT(*) FROM aftersales_cases ac WHERE ac.student_id=s.id) prior_case_cnt
       FROM students s
       JOIN classes c ON c.id=s.class_id
       JOIN campuses cp ON cp.id=s.campus_id
       JOIN orders o ON o.student_id=s.id AND o.plan_id=? AND o.status<>'cancelled'
      WHERE s.status='active'
        AND NOT EXISTS (
          SELECT 1 FROM fitting_records fr
          JOIN fitting_sessions fs ON fs.id=fr.session_id
          WHERE fr.student_id=s.id AND fs.plan_id=?)
        ${classId ? 'AND s.class_id=?' : ''}
      ORDER BY s.class_id, s.student_no`,
    classId ? [planId, planId, classId] : [planId, planId]);
}

// 学生订单按部位需要的尺码集合（用于样衣覆盖判断）
export async function neededSizes(studentIds: number[], planId: number) {
  if (!studentIds.length) return new Map<number, string[]>();
  const rows = await query<any>(
    `SELECT o.student_id, oi.garment_type, oi.size
       FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.plan_id=? AND o.student_id IN (?)`,
    [planId, studentIds]);
  const m = new Map<number, Set<string>>();
  for (const r of rows) {
    if (!m.has(r.student_id)) m.set(r.student_id, new Set());
    m.get(r.student_id)!.add(r.size);
  }
  return new Map([...m].map(([k, v]) => [k, [...v]]));
}

// 班级竞争优先级：生产截止日越近、首次订购人数越多、已确认人数越多 → 优先级越高
export async function classPriority(planId: number, classId: number, missingStudentIds: number[]) {
  const plan = await one<any>('SELECT production_deadline FROM plans WHERE id=?', [planId]);
  let urgency = 0;
  if (plan?.production_deadline) {
    const days = (new Date(plan.production_deadline).getTime() - Date.now()) / 86400000;
    urgency = Math.max(0, Math.round((30 - Math.max(0, days)) * 10)); // 0~300
  }
  const first = missingStudentIds.length
    ? (await one<any>(
        `SELECT COUNT(*) c FROM makeup_students WHERE plan_id=? AND class_id=? AND is_first_order=1
           AND student_id IN (?)`,
        [planId, classId, missingStudentIds]))?.c || 0
    : 0;
  const confirmed = (await one<any>(
    `SELECT COUNT(*) c FROM orders WHERE plan_id=? AND class_id=? AND status IN ('confirmed','paid')`,
    [planId, classId]))?.c || 0;
  return urgency + Number(first) * 20 + Number(confirmed) * 5;
}

// 班主任在给定时间窗内是否维护过空闲时间
export async function teacherFreeAt(teacherUserId: number, start: string, end: string) {
  return one(
    `SELECT id FROM teacher_availabilities
      WHERE teacher_user_id=? AND start_time<=? AND end_time>=? LIMIT 1`,
    [teacherUserId, start, end]);
}

// 同一老师时间冲突的已排补测（样衣/老师竞争）
export async function teacherTimeClash(teacherUserId: number, start: string, end: string, excludeId?: number) {
  return one(
    `SELECT id FROM makeup_sessions
      WHERE teacher_user_id=? AND status IN ('candidate','scheduled')
        AND start_time < ? AND end_time > ? ${excludeId ? 'AND id<>?' : ''}
      LIMIT 1`,
    excludeId ? [teacherUserId, end, start, excludeId] : [teacherUserId, end, start]);
}

// 某校区某时刻各尺码可用样衣是否足够（同时段其他班级已占用的不可重复借）
// 返回短缺尺码列表
export async function sampleShortage(
  campusId: number, supplierId: number, start: string, end: string, sizesNeeded: string[], sessionId?: number,
) {
  const uniq = [...new Set(sizesNeeded)];
  if (!uniq.length) return [];
  const stock = await query<any>(
    'SELECT size, qty FROM sample_stock WHERE campus_id=? AND supplier_id=? AND size IN (?)',
    [campusId, supplierId, uniq]);
  const sm = new Map(stock.map((r) => [r.size, Number(r.qty)]));
  const used = await query<any>(
    `SELECT sr.size, COUNT(*) sessions
       FROM sample_reservations sr
       JOIN makeup_sessions ms ON ms.id=sr.makeup_session_id
      WHERE ms.campus_id=? AND ms.status IN ('candidate','scheduled')
        AND ms.start_time < ? AND ms.end_time > ?
        AND sr.status='reserved'
        ${sessionId ? 'AND ms.id<>?' : ''}
      GROUP BY sr.size`,
    sessionId ? [campusId, end, start, sessionId] : [campusId, end, start]);
  const um = new Map(used.map((r) => [r.size, Number(r.sessions)]));
  const short: string[] = [];
  for (const z of uniq) {
    const have = sm.get(z) || 0;
    const busy = um.get(z) || 0;
    // 库存 0，或库存仅够当前已排场次（每场至少 1 件）
    if (have <= 0 || have - busy <= 0) short.push(z);
  }
  return short;
}

// 重算班级正式数量、未分配数量、关联生产批次与到校承诺
// 正式数量口径：已缴费 + 在校 + 尺寸锁允许投产（none/locked/prelocked）
export async function recomputeClass(planId: number, classId: number) {
  const lines = await query<any>(
    `SELECT oi.plan_item_id, pi.name item_name, oi.garment_type, oi.size,
            SUM(oi.qty) formal_qty,
            COALESCE((SELECT SUM(ba.qty) FROM batch_allocations ba
                       JOIN batch_items bi ON bi.id=ba.batch_item_id
                       JOIN production_batches pb ON pb.id=bi.batch_id
                       JOIN order_items oi2 ON oi2.id=ba.order_item_id
                       JOIN orders o2 ON o2.id=oi2.order_id
                      WHERE oi2.plan_item_id=oi.plan_item_id AND oi2.size=oi.size
                        AND o2.class_id=? AND pb.status<>'completed'),0) allocated_qty
       FROM order_items oi
       JOIN orders o ON o.id=oi.order_id
       JOIN students s ON s.id=o.student_id
       JOIN plan_items pi ON pi.id=oi.plan_item_id
      WHERE o.plan_id=? AND o.class_id=? AND o.status='paid' AND s.status='active'
        AND o.size_lock NOT IN ('risk_placeholder','review')
      GROUP BY oi.plan_item_id, oi.size
      ORDER BY oi.plan_item_id, oi.size`,
    [classId, planId, classId]);
  for (const l of lines) {
    l.formal_qty = Number(l.formal_qty);
    l.allocated_qty = Number(l.allocated_qty);
    l.unallocated_qty = Math.max(0, l.formal_qty - l.allocated_qty);
  }
  const risk = await query<any>(
    `SELECT s.name student_name, o.order_no, o.size_lock,
            GROUP_CONCAT(CONCAT(oi.garment_type,':',oi.size) SEPARATOR ';') sizes
       FROM orders o JOIN students s ON s.id=o.student_id
       JOIN order_items oi ON oi.order_id=o.id
      WHERE o.plan_id=? AND o.class_id=? AND o.status='paid'
        AND (o.size_lock IN ('risk_placeholder','review') OR o.risk_placeholder=1)
      GROUP BY o.id`,
    [planId, classId]);
  const batches = await query<any>(
    `SELECT DISTINCT pb.id, pb.batch_no, pb.status, pb.expected_arrival
       FROM production_batches pb
       JOIN batch_items bi ON bi.batch_id=pb.id
       JOIN batch_allocations ba ON ba.batch_item_id=bi.id
       JOIN order_items oi ON oi.id=ba.order_item_id
       JOIN orders o ON o.id=oi.order_id
      WHERE pb.plan_id=? AND o.class_id=?
      ORDER BY pb.id`,
    [planId, classId]);
  const arrivals = batches.map((b) => b.expected_arrival).filter(Boolean).sort();
  return {
    formal_lines: lines,
    formal_total: lines.reduce((a, l) => a + l.formal_qty, 0),
    risk_placeholders: risk,
    affected_batches: batches,
    promised_arrival: arrivals.length ? arrivals[arrivals.length - 1] : null,
  };
}
