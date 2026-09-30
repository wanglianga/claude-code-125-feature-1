// 种子数据：多校区统一采购、贫困生减免、毕业班补订、转学、迟缴费、试穿偏差、
// 工厂漏发、班级错领、成长换码、面料过敏、分批发放/补领、供应商考核等场景
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'uniform',
  multipleStatements: true,
});

const salt = 'uniform-seed-salt-0001';
const hash = (pwd) => crypto.scryptSync(pwd, salt, 64).toString('hex');
const PWD = 'uniform123';

async function clear() {
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  const [tables] = await conn.query(
    `SELECT table_name t FROM information_schema.tables WHERE table_schema=DATABASE()`);
  for (const { t } of tables) await conn.query(`TRUNCATE TABLE \`${t}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS=1');
}

async function ins(table, data) {
  const keys = Object.keys(data);
  const ph = keys.map(() => '?').join(',');
  const [r] = await conn.query(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${ph})`,
    keys.map((k) => data[k]));
  return r.insertId;
}

const log = (actor, action, detail, student_id = null, order_id = null) =>
  ins('activity_log', { student_id, order_id, actor_role: actor.role || actor, actor_name: actor.name || actor, action, detail });

await clear();

// ---------- 基础组织 ----------
const campus1 = await ins('campuses', { name: '明德校区' });
const campus2 = await ins('campuses', { name: '知行校区' });
const supplier = await ins('suppliers', { name: '锦绣校服有限公司', contact: '李经理 138-0000-1001' });

const g1 = await ins('grades', { campus_id: campus1, name: '一年级', graduation_year: 2032 });
const g2 = await ins('grades', { campus_id: campus1, name: '二年级', graduation_year: 2031 });
const g6 = await ins('grades', { campus_id: campus2, name: '六年级', graduation_year: 2027 });

// 用户（密码统一 uniform123）
const U = async (username, real_name, role, extra = {}) =>
  ins('users', { username, password_hash: hash(PWD), salt, real_name, role, ...extra });

const admin = await U('admin', '系统管理员', 'admin');
const zw = await U('zw', '总务赵主任', 'general_affairs');                 // 跨校区统一采购
const wangls = await U('wangls', '班主任王老师', 'head_teacher', { campus_id: campus1 });
const zhaols = await U('zhaols', '班主任赵老师', 'head_teacher', { campus_id: campus1 });
const qianls = await U('qianls', '班主任钱老师', 'head_teacher', { campus_id: campus2 });
const chen_ma = await U('chen_ma', '陈晓妈妈', 'parent', { phone: '13900000001' });
const lin_ba = await U('lin_ba', '林小雨爸爸', 'parent', { phone: '13900000002' });
const wu_ma = await U('wu_ma', '吴磊妈妈', 'parent', { phone: '13900000003' });
const zhou_ma = await U('zhou_ma', '周悦妈妈', 'parent', { phone: '13900000004' });
const zheng_ba = await U('zheng_ba', '郑好爸爸', 'parent', { phone: '13900000005' });
const sun_ma = await U('sun_ma', '孙朵朵妈妈', 'parent', { phone: '13900000006' });
const he_ma = await U('he_ma', '何苗妈妈', 'parent', { phone: '13900000007' });
const ma_ba = await U('ma_ba', '马奔爸爸', 'parent', { campus_id: campus2, phone: '13900000008' });
const gys = await U('gys', '供应商李经理', 'supplier', { supplier_id: supplier });
const gc = await U('gc', '工厂张调度', 'factory', { supplier_id: supplier });
const kf = await U('kf', '售后客服周舟', 'after_sales');

const c11 = await ins('classes', { grade_id: g1, name: '一(1)班', teacher_user_id: wangls });
const c21 = await ins('classes', { grade_id: g2, name: '二(1)班', teacher_user_id: zhaols });
const c61 = await ins('classes', { grade_id: g6, name: '六(1)班', teacher_user_id: qianls });

// ---------- 学生 ----------
const mkStudent = async (no, name, campus, grade, cls, parent, body) =>
  ins('students', {
    student_no: no, name, campus_id: campus, grade_id: grade, class_id: cls,
    parent_user_id: parent, height_cm: body.h, weight_kg: body.w,
    usual_size: body.usual, special_fit: body.special ? 1 : 0,
    special_fit_note: body.special || null, status: 'active',
  });

const s_chen = await mkStudent('MD10101', '陈晓', campus1, g1, c11, chen_ma, { h: 132, w: 29, usual: '130' });
const s_lin = await mkStudent('MD10102', '林小雨', campus1, g1, c11, lin_ba, { h: 124, w: 24, usual: '120' });
const s_wu = await mkStudent('MD10103', '吴磊', campus1, g1, c11, wu_ma, { h: 141, w: 42, usual: '140', special: '体型偏胖，需加宽版型' });
const s_zhou = await mkStudent('MD10104', '周悦', campus1, g1, c11, zhou_ma, { h: 128, w: 26, usual: '130' });
const s_zheng = await mkStudent('MD20101', '郑好', campus1, g2, c21, zheng_ba, { h: 152, w: 40, usual: '150' });
const s_sun = await mkStudent('MD20102', '孙朵朵', campus1, g2, c21, sun_ma, { h: 134, w: 28, usual: '130' });
const s_he = await mkStudent('MD20103', '何苗', campus1, g2, c21, he_ma, { h: 143, w: 35, usual: '140' });
const s_ma = await mkStudent('ZX60101', '马奔', campus2, g6, c61, ma_ba, { h: 168, w: 55, usual: '170' });

// —— 集中试穿当天请假、未参加试穿的漏测学生（二(1)班，班主任赵老师）——
const tang_ma = await U('tang_ma', '唐糖妈妈', 'parent', { phone: '13900000009' });
const feng_ba = await U('feng_ba', '冯远爸爸', 'parent', { phone: '13900000010' });
const shen_ma = await U('shen_ma', '沈星妈妈', 'parent', { phone: '13900000011' });
const s_tang = await mkStudent('MD20104', '唐糖', campus1, g2, c21, tang_ma, { h: 136, w: 30, usual: '130' });
const s_feng = await mkStudent('MD20105', '冯远', campus1, g2, c21, feng_ba, { h: 149, w: 38, usual: '150' });
const s_shen = await mkStudent('MD20106', '沈星', campus1, g2, c21, shen_ma, { h: 130, w: 27, usual: '130' });

// 一(1)班漏测生（与二(1)班竞争同一批评测样衣/时段；演示多班优先级与“延后该学生”）
const han_ma = await U('han_ma', '韩雪妈妈', 'parent', { phone: '13900000012' });
const s_han = await mkStudent('MD10105', '韩雪', campus1, g1, c11, han_ma, { h: 122, w: 23, usual: '120' });

// 周悦已转学
await conn.query("UPDATE students SET status='transferred', transferred_at='2026-09-20 10:00:00' WHERE id=?", [s_zhou]);

// 贫困生减免（吴磊，已批准 50%）
await ins('subsidies', { student_id: s_wu, ratio: 0.5, reason: '低保家庭，申请贫困生减免', status: 'approved', approved_by: zw });

// ---------- 订购计划 ----------
// P1：两校区统一采购（覆盖一、二年级）
const p1 = await ins('plans', {
  name: '2026学年度春秋校服统一采购', kind: 'annual', academic_year: '2026-2027',
  season: '春秋', supplier_id: supplier, status: 'open',
  order_deadline: '2026-10-15 18:00:00', production_deadline: '2026-10-18 18:00:00', fitting_date: '2026-10-08',
  note: '明德、知行两校区统一招采，含季节套装/运动服/礼服/增购件', created_by: zw,
});
await ins('plan_campuses', { plan_id: p1, campus_id: campus1 });
await ins('plan_campuses', { plan_id: p1, campus_id: campus2 });
await ins('plan_grades', { plan_id: p1, grade_id: g1 });
await ins('plan_grades', { plan_id: p1, grade_id: g2 });

const mkItem = (name, suit_kind, garment_type, price, required = 1) =>
  ins('plan_items', { plan_id: p1, name, suit_kind, garment_type, price, required });
const iTop = await mkItem('春秋运动上衣', 'sportswear', 'top', 120);
const iPants = await mkItem('春秋运动长裤', 'sportswear', 'pants', 80);
const iCoat = await mkItem('礼服外套', 'formal', 'coat', 150);
const iSkirt = await mkItem('礼服裙装', 'formal', 'skirt', 90);
const iShoes = await mkItem('校鞋', 'season_set', 'shoes', 180);
const iExtraT = await mkItem('增购件-运动T恤', 'extra', 'top', 60, 0);

// P2：毕业班补订（知行校区六年级）
const p2 = await ins('plans', {
  name: '2026届六年级毕业班补订', kind: 'makeup', academic_year: '2026-2027',
  season: '春秋', supplier_id: supplier, status: 'open',
  order_deadline: '2026-10-10 18:00:00', fitting_date: '2026-10-06',
  note: '毕业班礼服补订，单独小批量生产', created_by: zw,
});
await ins('plan_campuses', { plan_id: p2, campus_id: campus2 });
await ins('plan_grades', { plan_id: p2, grade_id: g6 });
const iFormalTop = await ins('plan_items', { plan_id: p2, name: '毕业礼服上衣', suit_kind: 'formal', garment_type: 'top', price: 130, required: 1 });
const iFormalPants = await ins('plan_items', { plan_id: p2, name: '毕业礼服长裤', suit_kind: 'formal', garment_type: 'pants', price: 90, required: 1 });

// ---------- 试穿时段 + 试穿记录 ----------
const fs1 = await ins('fitting_sessions', {
  plan_id: p1, class_id: c11, start_time: '2026-10-08 09:00:00', end_time: '2026-10-08 10:00:00',
  location: '明德校区体育馆A区', organizer_user_id: wangls,
});
const fs2 = await ins('fitting_sessions', {
  plan_id: p1, class_id: c21, start_time: '2026-10-08 10:30:00', end_time: '2026-10-08 11:30:00',
  location: '明德校区体育馆B区', organizer_user_id: zhaols,
});

const fit = (session, student, staff, sizes, note = null) =>
  ins('fitting_records', {
    session_id: session, student_id: student, staff_name: staff,
    size_top: sizes[0], size_pants: sizes[1], size_skirt: sizes[2] ?? null,
    size_coat: sizes[3] ?? null, size_shoes: sizes[4] ?? null, special_note: note,
  });
await fit(fs1, s_chen, '试穿员小刘', ['130', '130', null, '140', '34']);
await fit(fs1, s_lin, '试穿员小刘', ['120', '120', null, null, '33']);
await fit(fs1, s_wu, '试穿员小刘', ['140', '140', null, null, '35'], '加宽版型，外套建议试大一号');
await fit(fs2, s_zheng, '试穿员小陈', ['150', '150', null, '150', null], '学生反馈150偏紧，成衣若版型偏小需换码');
await fit(fs2, s_sun, '试穿员小陈', ['130', '130', '130', null, '34']);
await fit(fs2, s_he, '试穿员小陈', ['140', '140', null, '140', '35'], '处于生长期，提醒家长预留余量');

// ---------- 订单 ----------
async function mkOrder(no, plan, student, cls, status, lines, opts = {}) {
  const payable = lines.reduce((a, l) => a + l.price * (l.qty || 1), 0);
  const subsidy = opts.subsidyRatio ? Math.round(payable * opts.subsidyRatio * 100) / 100 : 0;
  const due = Math.round((payable - subsidy) * 100) / 100;
  const paid = status === 'paid' || status === 'hold' ? (opts.paidAmount ?? due) : 0;
  const id = await ins('orders', {
    order_no: no, plan_id: plan, student_id: student, class_id: cls,
    status, hold_reason: opts.holdReason || null,
    payable_amount: payable, subsidy_amount: subsidy, due_amount: due, paid_amount: paid,
    confirmed_at: '2026-09-25 09:00:00',
    paid_at: paid > 0 ? (opts.paidAt || '2026-09-26 09:00:00') : null,
    parent_note: opts.note || null,
  });
  for (const l of lines) {
    await ins('order_items', {
      order_id: id, plan_item_id: l.item, garment_type: l.type, name: l.name,
      size: l.size, price: l.price, qty: l.qty || 1, is_extra: l.extra ? 1 : 0,
    });
  }
  return id;
}

const oChen = await mkOrder('OD20260001', p1, s_chen, c11, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '130', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '130', price: 80 },
  { item: iCoat, type: 'coat', name: '礼服外套', size: '140', price: 150 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '34', price: 180 },
]);
// 林小雨：家长已确认但未缴费 —— 供应商不能投产（迟缴费风险）
const oLin = await mkOrder('OD20260002', p1, s_lin, c11, 'confirmed', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '120', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '120', price: 80 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '33', price: 180 },
]);
// 吴磊：贫困生减半
const oWu = await mkOrder('OD20260003', p1, s_wu, c11, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '140', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '140', price: 80 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '35', price: 180 },
], { subsidyRatio: 0.5 });
// 周悦：已缴费后转学，订单挂起 + 退款工单
const oZhou = await mkOrder('OD20260004', p1, s_zhou, c11, 'hold', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '130', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '130', price: 80 },
], { holdReason: '学生转学，订单暂缓', note: '全家搬往外省' });
// 郑好：试穿尺码与实际成衣偏差换码
const oZheng = await mkOrder('OD20260005', p1, s_zheng, c21, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '150', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '150', price: 80 },
  { item: iCoat, type: 'coat', name: '礼服外套', size: '150', price: 150 },
]);
// 孙朵朵：工厂漏发补发
const oSun = await mkOrder('OD20260006', p1, s_sun, c21, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '130', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '130', price: 80 },
  { item: iSkirt, type: 'skirt', name: '礼服裙装', size: '130', price: 90 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '34', price: 180 },
]);
// 何苗：成长过快换码 + 面料过敏投诉
const oHe = await mkOrder('OD20260007', p1, s_he, c21, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '140', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '140', price: 80 },
  { item: iCoat, type: 'coat', name: '礼服外套', size: '140', price: 150 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '35', price: 180 },
]);
// 马奔：毕业班补订
const oMa = await mkOrder('OD20260008', p2, s_ma, c61, 'paid', [
  { item: iFormalTop, type: 'top', name: '毕业礼服上衣', size: '170', price: 130 },
  { item: iFormalPants, type: 'pants', name: '毕业礼服长裤', size: '170', price: 90 },
]);

// ---------- 集中试穿漏测：补测与生产锁定场景 ----------
// 唐糖：已缴费、已提交参考尺码，等待补测（风险占位，不计正式数量）
const oTang = await mkOrder('OD20260009', p1, s_tang, c21, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '130', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '130', price: 80 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '34', price: 180 },
]);
await conn.query("UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1 WHERE id=?", [oTang]);
await ins('makeup_students', {
  makeup_session_id: null, plan_id: p1, student_id: s_tang, class_id: c21, order_id: oTang,
  is_first_order: 1, ref_size_top: '130', ref_size_pants: '130', ref_size_shoes: '34',
  ref_submitted_at: '2026-09-26 20:00:00', status: 'waiting',
});
await log({ role: 'parent', name: '唐糖妈妈' }, '家长提交参考尺码', '上衣130 裤130 鞋34（风险占位，不计正式数量）', s_tang, oTang);

// 冯远：已缴费、连参考尺码都未提交（待补测）；样衣 150 码库存不足将触发“样衣不足”异常
const oFeng = await mkOrder('OD20260010', p1, s_feng, c21, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '150', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '150', price: 80 },
  { item: iCoat, type: 'coat', name: '礼服外套', size: '150', price: 150 },
]);
await conn.query("UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1 WHERE id=?", [oFeng]);
await ins('makeup_students', {
  makeup_session_id: null, plan_id: p1, student_id: s_feng, class_id: c21, order_id: oFeng,
  is_first_order: 1, status: 'pending_ref',
});

// 韩雪：一(1)班漏测生，已缴费并提交参考尺码（风险占位）；与二(1)班竞争 130/33 等样衣
const oHan = await mkOrder('OD20260012', p1, s_han, c11, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '120', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '120', price: 80 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '33', price: 180 },
]);
await conn.query("UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1 WHERE id=?", [oHan]);
await ins('makeup_students', {
  makeup_session_id: null, plan_id: p1, student_id: s_han, class_id: c11, order_id: oHan,
  is_first_order: 1, ref_size_top: '120', ref_size_pants: '120', ref_size_shoes: '33',
  ref_submitted_at: '2026-09-26 21:00:00', status: 'waiting',
});

// 沈星：上一轮补测班主任已确认、家长超过截止时间仍未确认 → 家长超时异常，订单保持风险占位
const oShen = await mkOrder('OD20260011', p1, s_shen, c21, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '130', price: 120 },
  { item: iSkirt, type: 'skirt', name: '礼服裙装', size: '130', price: 90 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '34', price: 180 },
]);
await conn.query("UPDATE orders SET size_lock='risk_placeholder', risk_placeholder=1 WHERE id=?", [oShen]);
const msOverdue = await ins('makeup_sessions', {
  plan_id: p1, class_id: c21, campus_id: campus1, supplier_id: supplier,
  start_time: '2026-09-23 16:00:00', end_time: '2026-09-23 17:00:00',
  location: '明德校区补测室', teacher_user_id: zhaols, priority_score: 220, status: 'overdue', created_by: zhaols,
});
const fsOverdue = await ins('fitting_sessions', {
  plan_id: p1, class_id: c21, kind: 'makeup', makeup_session_id: msOverdue,
  start_time: '2026-09-23 16:00:00', end_time: '2026-09-23 17:00:00',
  location: '明德校区补测室', organizer_user_id: zhaols,
});
await fit(fsOverdue, s_shen, '班主任赵老师', ['130', null, '130', null, '35'], '补测实测：鞋码家长参考34，实测35');
for (const z of ['130', '34']) {
  await ins('sample_reservations', { makeup_session_id: msOverdue, size: z, qty: 1, status: 'reserved' });
}
await ins('makeup_students', {
  makeup_session_id: msOverdue, plan_id: p1, student_id: s_shen, class_id: c21, order_id: oShen,
  is_first_order: 1, ref_size_top: '130', ref_size_skirt: '130', ref_size_shoes: '34', ref_submitted_at: '2026-09-22 19:00:00',
  meas_size_top: '130', meas_size_skirt: '130', meas_size_shoes: '35', measured_by: zhaols, measured_at: '2026-09-23 16:40:00',
  teacher_confirmed: 1, teacher_confirmed_at: '2026-09-23 17:00:00',
  status: 'parent_timeout', deadline: '2026-09-25 18:00:00',
});
await ins('makeup_exceptions', {
  plan_id: p1, class_id: c21, makeup_session_id: msOverdue, type: 'makeup_overdue',
  detail: '补测场次超过 2026-09-23 17:00:00 仍有学生未闭环，转总务处理',
});
await ins('makeup_exceptions', {
  plan_id: p1, class_id: c21, makeup_session_id: msOverdue, student_id: s_shen, type: 'parent_timeout',
  detail: '班主任已确认测量记录，家长超过 2026-09-25 18:00:00 仍未确认最终尺码，订单保持风险占位',
});

// 班主任空闲时间（赵老师/王老师，未来可排补测）
await ins('teacher_availabilities', { teacher_user_id: zhaols, campus_id: campus1, start_time: '2026-10-12 15:00:00', end_time: '2026-10-12 17:00:00', note: '教研后可组织补测' });
await ins('teacher_availabilities', { teacher_user_id: zhaols, campus_id: campus1, start_time: '2026-10-13 16:00:00', end_time: '2026-10-13 17:30:00' });
await ins('teacher_availabilities', { teacher_user_id: wangls, campus_id: campus1, start_time: '2026-10-12 15:00:00', end_time: '2026-10-12 16:30:00' });

// 供应商样衣库存（明德校区；故意缺 150 码 → 首次生成候选时二(1)班“样衣不足”，补齐后可排）
for (const [size, qty] of [['120', 2], ['130', 2], ['140', 2], ['33', 2], ['34', 2], ['35', 2], ['170', 1]]) {
  await ins('sample_stock', { supplier_id: supplier, campus_id: campus1, size, qty });
}
await ins('sample_stock', { supplier_id: supplier, campus_id: campus2, size: '170', qty: 1 });

// ---------- 生产批次（已报产完成，等待供应商分批发货）----------
async function mkBatch(no, plan, name, arrival, orderIdsAndItems) {
  const bid = await ins('production_batches', {
    batch_no: no, plan_id: plan, supplier_id: supplier, name,
    status: 'produced', expected_arrival: arrival, created_by: gys,
  });
  // orderIdsAndItems: [{ oid, planItem, size, qty }] 按品类+尺码聚合
  const groups = new Map();
  for (const x of orderIdsAndItems) {
    const key = `${x.planItem}:${x.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  for (const [, arr] of groups) {
    const total = arr.reduce((a, x) => a + x.qty, 0);
    const bi = await ins('batch_items', {
      batch_id: bid, plan_item_id: arr[0].planItem, size: arr[0].size, qty: total, produced_qty: total,
    });
    for (const x of arr) {
      const [oiRows] = await conn.query(
        'SELECT id FROM order_items WHERE order_id=? AND plan_item_id=? AND size=?',
        [x.oid, x.planItem, x.size]);
      await ins('batch_allocations', { batch_item_id: bi, order_item_id: oiRows[0].id, qty: x.qty });
    }
  }
  return bid;
}

// 取订单明细
const oiOf = async (oid, itemId) =>
  (await conn.query('SELECT id FROM order_items WHERE order_id=? AND plan_item_id=?', [oid, itemId]))[0][0].id;

const batch1Lines = [];
const pushBatch = (oid, item, size, qty = 1) => batch1Lines.push({ oid, planItem: item, size, qty });
for (const [oid, sizes] of [
  [oChen, { top: ['130'], pants: ['130'], coat: ['140'], shoes: ['34'] }],
  [oWu, { top: ['140'], pants: ['140'], shoes: ['35'] }],
  [oZheng, { top: ['150'], pants: ['150'], coat: ['150'] }],
  [oSun, { top: ['130'], pants: ['130'], skirt: ['130'], shoes: ['34'] }],
  [oHe, { top: ['140'], pants: ['140'], coat: ['140'], shoes: ['35'] }],
]) {
  if (sizes.top) pushBatch(oid, iTop, sizes.top[0]);
  if (sizes.pants) pushBatch(oid, iPants, sizes.pants[0]);
  if (sizes.coat) pushBatch(oid, iCoat, sizes.coat[0]);
  if (sizes.skirt) pushBatch(oid, iSkirt, sizes.skirt[0]);
  if (sizes.shoes) pushBatch(oid, iShoes, sizes.shoes[0]);
}
await mkBatch('PB20260001', p1, '春秋统一采购第一批（已缴费订单）', '2026-10-20', batch1Lines);

// 毕业班补订批次：仍在计划中（供应商明确不可投产的订单之外，这批刚建）
const bid2 = await ins('production_batches', {
  batch_no: 'PB20260002', plan_id: p2, supplier_id: supplier, name: '毕业班礼服补订批',
  status: 'planned', expected_arrival: '2026-10-25', created_by: gys,
});
for (const [item, size] of [[iFormalTop, '170'], [iFormalPants, '170']]) {
  const bi = await ins('batch_items', { batch_id: bid2, plan_item_id: item, size, qty: 1, produced_qty: 0 });
  const oi = await oiOf(oMa, item);
  await ins('batch_allocations', { batch_item_id: bi, order_item_id: oi, qty: 1 });
}

// ---------- 售后工单（初始进行中）----------
// 周悦转学退款
const caseZhou = await ins('aftersales_cases', {
  case_no: 'AS20260001', student_id: s_zhou, order_id: oZhou, type: 'transfer_cancel',
  reason: 'transfer', status: 'processing', priority: 'high',
  description: '学生9月20日转学外省，家长申请退还已缴校服费', created_by: zhou_ma, assigned_to: kf,
});
await ins('refund_records', { case_id: caseZhou, amount: 200, reason: '转学退费', status: 'requested' });

// 何苗成长过快换码（外套140→150）
const heCoatOi = await oiOf(oHe, iCoat);
const caseGrowth = await ins('aftersales_cases', {
  case_no: 'AS20260002', student_id: s_he, order_id: oHe, order_item_id: heCoatOi,
  type: 'exchange', reason: 'growth', status: 'open', priority: 'high',
  description: '开学一个月身高增长3cm，礼服外套140码已显小，申请换150码', created_by: he_ma,
});
await ins('exchange_requests', {
  case_id: caseGrowth, order_item_id: heCoatOi, old_size: '140', new_size: '150', status: 'requested',
});

// 何苗面料过敏投诉
const caseAllergy = await ins('aftersales_cases', {
  case_no: 'AS20260003', student_id: s_he, order_id: oHe, type: 'complaint',
  reason: 'allergy', status: 'open', priority: 'high',
  description: '家长反馈穿运动上衣后手臂出现红疹，校医初步判断面料过敏，要求检测并给出退换方案', created_by: he_ma,
});

// 郑好试穿偏差换码（上衣150→160）—— 成衣实际偏小
const zhengTopOi = await oiOf(oZheng, iTop);
await ins('aftersales_cases', {
  case_no: 'AS20260004', student_id: s_zheng, order_id: oZheng, order_item_id: zhengTopOi,
  type: 'exchange', reason: 'fitting_deviation', status: 'open', priority: 'normal',
  description: '试穿建议150码，实际成衣版型偏小穿着紧绷，申请更换160码', created_by: zheng_ba,
});

// ---------- 往期供应商考核 ----------
await ins('supplier_assessments', {
  supplier_id: supplier, period: '2025-2026学年度', score: 92.5,
  missing_count: 2, delay_count: 1, allergy_count: 0, exchange_count: 6,
  note: '整体履约良好，存在2件漏发与1次批次延期，已整改', assessed_by: zw,
});

// ---------- 时间线 ----------
await log({ role: 'general_affairs', name: '总务赵主任' }, '创建统一采购计划', '两校区2026学年度春秋校服统一采购');
await log({ role: 'parent', name: '陈晓妈妈' }, '家长创建订单', '订单 OD20260001', s_chen, oChen);
await log({ role: 'parent', name: '陈晓妈妈' }, '家长缴费', '¥530', s_chen, oChen);
await log({ role: 'head_teacher', name: '班主任王老师' }, '安排试穿时段', '10月8日 09:00 体育馆A区', s_chen);
await log({ role: 'general_affairs', name: '试穿员小刘' }, '登记试穿尺码建议', '上衣130 裤130 外套140 鞋34', s_chen);
await log({ role: 'factory', name: '工厂张调度' }, '批次报产', 'PB20260001 全部完成，预计10月20日到校');
await log({ role: 'general_affairs', name: '总务赵主任' }, '学生转学', '周悦转学，订单 OD20260004 挂起并发起退款', s_zhou, oZhou);

console.log('[seed] done. 测试账号密码统一为: uniform123');
console.log('[seed] 家长: chen_ma/lin_ba/wu_ma/zhou_ma/zheng_ba/sun_ma/he_ma/ma_ba');
console.log('[seed] 漏测补测家长: tang_ma(已交参考尺码)/feng_ba(未交参考)/shen_ma(家长超时未确认)');
console.log('[seed] 老师: wangls/zhaols/qianls  总务: zw  供应商: gys  工厂: gc  售后: kf  管理员: admin');
await conn.end();
