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

// 周悦已转学
await conn.query("UPDATE students SET status='transferred', transferred_at='2026-09-20 10:00:00' WHERE id=?", [s_zhou]);

// 贫困生减免（吴磊，已批准 50%）
await ins('subsidies', { student_id: s_wu, ratio: 0.5, reason: '低保家庭，申请贫困生减免', status: 'approved', approved_by: zw });

// ---------- 订购计划 ----------
// P1：两校区统一采购（覆盖一、二年级）
const p1 = await ins('plans', {
  name: '2026学年度春秋校服统一采购', kind: 'annual', academic_year: '2026-2027',
  season: '春秋', supplier_id: supplier, status: 'open',
  order_deadline: '2026-10-15 18:00:00', fitting_date: '2026-10-08',
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

// ========== 集中试穿漏测：补测与生产锁定 演示数据 ==========
// 新增家长 + 漏测学生：一(1)班 韩梅梅（首次订购）、罗小宇（非首次订购，有历史订单）
const han_ma = await U('han_ma', '韩梅梅妈妈', 'parent', { phone: '13900000009' });
const luo_ba = await U('luo_ba', '罗小宇爸爸', 'parent', { phone: '13900000010' });
const s_han = await mkStudent('MD10105', '韩梅梅', campus1, g1, c11, han_ma, { h: 126, w: 25, usual: '120' });
const s_luo = await mkStudent('MD10106', '罗小宇', campus1, g1, c11, luo_ba, { h: 135, w: 30, usual: '130' });
// 二(1)班 漏测学生 高天天（首次订购），与一(1)班竞争同一批样衣/同一时段
const gao_ma = await U('gao_ma', '高天天妈妈', 'parent', { phone: '13900000011' });
const s_gao = await mkStudent('MD20104', '高天天', campus1, g2, c21, gao_ma, { h: 138, w: 31, usual: '140' });
// 一(1)班 漏测学生 冯笑笑（首次订购，已缴费），用于截止日"按参考尺码预锁"演示
const feng_ma = await U('feng_ma', '冯笑笑妈妈', 'parent', { phone: '13900000012' });
const s_feng = await mkStudent('MD10107', '冯笑笑', campus1, g1, c11, feng_ma, { h: 122, w: 23, usual: '120' });

// 罗小宇有一笔历史学年有效订单 → 非首次订购
const pOld = await ins('plans', {
  name: '2025学年度校服采购（历史）', kind: 'annual', academic_year: '2025-2026',
  season: '春秋', supplier_id: supplier, status: 'closed',
  order_deadline: '2025-10-15 18:00:00', fitting_date: '2025-10-08', created_by: zw,
});
await ins('plan_campuses', { plan_id: pOld, campus_id: campus1 });
const oLuoOld = await ins('orders', {
  order_no: 'OD20250099', plan_id: pOld, student_id: s_luo, class_id: c11, status: 'paid',
  payable_amount: 200, subsidy_amount: 0, due_amount: 200, paid_amount: 200,
  confirmed_at: '2025-09-20 09:00:00', paid_at: '2025-09-21 09:00:00',
});

// 漏测学生本计划订单：韩梅梅(120/33，已缴费)、罗小宇(130/34，已缴费)、高天天(140/35，待缴费)
const oHan = await mkOrder('OD20260009', p1, s_han, c11, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '120', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '120', price: 80 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '33', price: 180 },
]);
const oLuo = await mkOrder('OD20260010', p1, s_luo, c11, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '130', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '130', price: 80 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '34', price: 180 },
]);
const oGao = await mkOrder('OD20260011', p1, s_gao, c21, 'confirmed', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '130', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '130', price: 80 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '34', price: 180 },
]);
const oFeng = await mkOrder('OD20260012', p1, s_feng, c11, 'paid', [
  { item: iTop, type: 'top', name: '春秋运动上衣', size: '120', price: 120 },
  { item: iPants, type: 'pants', name: '春秋运动长裤', size: '120', price: 80 },
  { item: iShoes, type: 'shoes', name: '校鞋', size: '33', price: 180 },
]);

// 班主任空闲时段：王老师(一1班) 与 赵老师(二1班) 在同一时间窗空闲 → 时段竞争
await ins('teacher_slots', { teacher_user_id: wangls, campus_id: campus1, start_time: '2026-10-12 15:00:00', end_time: '2026-10-12 17:00:00', note: '周一教研后空闲' });
await ins('teacher_slots', { teacher_user_id: wangls, campus_id: campus1, start_time: '2026-10-13 09:00:00', end_time: '2026-10-13 10:30:00', note: '备选时段（次日早晨，不与二(1)班冲突）' });
await ins('teacher_slots', { teacher_user_id: zhaols, campus_id: campus1, start_time: '2026-10-12 15:00:00', end_time: '2026-10-12 17:00:00', note: '与一(1)班同窗' });

// 样衣库存：120 充足；130 上衣仅 1 件（一(1)班罗小宇与二(1)班高天天同窗竞争会不足）
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iTop, size: '120', total_qty: 4 });
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iPants, size: '120', total_qty: 4 });
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iShoes, size: '33', total_qty: 4 });
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iTop, size: '130', total_qty: 1 });
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iPants, size: '130', total_qty: 4 });
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iShoes, size: '34', total_qty: 4 });
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iTop, size: '140', total_qty: 4 });
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iPants, size: '140', total_qty: 4 });
await ins('sample_stocks', { plan_id: p1, campus_id: campus1, supplier_id: supplier, plan_item_id: iShoes, size: '35', total_qty: 4 });

// 班级生产截止日与到校承诺（一(1)班截止日已到，用于演示 deadline_open 与总务预锁/延后）
await ins('class_production_settings', { plan_id: p1, class_id: c11, production_deadline: '2026-09-29 18:00:00', promised_arrival: '2026-11-05', updated_by: zw });
await ins('class_production_settings', { plan_id: p1, class_id: c21, production_deadline: '2026-10-16 18:00:00', promised_arrival: '2026-11-06', updated_by: zw });

// 漏测学生标记为补测中、已交参考尺码（风险占位）；参考尺码取自其订单明细
const mkRef = async (student, cls, order, first) => {
  const its = Object.fromEntries(
    (await conn.query('SELECT garment_type, size FROM order_items WHERE order_id=?', [order]))[0]
      .map((r) => [r.garment_type, r.size]));
  return ins('makeup_students', {
    plan_id: p1, student_id: student, class_id: cls, order_id: order, is_first_order: first ? 1 : 0,
    status: 'referenced',
    ref_size_top: its.top || null, ref_size_pants: its.pants || null,
    ref_size_skirt: its.skirt || null, ref_size_coat: its.coat || null, ref_size_shoes: its.shoes || null,
    ref_submitted_at: '2026-10-09 09:00:00',
  });
};
await mkRef(s_han, c11, oHan, 1);
await mkRef(s_luo, c11, oLuo, 0);
await mkRef(s_gao, c21, oGao, 1);
await mkRef(s_feng, c11, oFeng, 1);
// 漏测订单一律风险占位（不计正式数量，即使已缴费）
await conn.query("UPDATE orders SET production_lock='placeholder' WHERE id IN (?,?,?,?)", [oHan, oLuo, oGao, oFeng]);

// p2（毕业班补订）补一个常规试穿场，避免马奔被识别为漏测（演示聚焦 p1）
await ins('fitting_sessions', {
  plan_id: p2, class_id: c61, start_time: '2026-10-06 09:00:00', end_time: '2026-10-06 10:00:00',
  location: '知行校区体育馆', organizer_user_id: qianls,
});
// 马奔试穿记录（与订单一致 170）
await ins('fitting_records', {
  session_id: (await conn.query('SELECT id FROM fitting_sessions WHERE plan_id=? ORDER BY id DESC LIMIT 1', [p2]))[0][0].id,
  student_id: s_ma, staff_name: '试穿员小周', size_top: '170', size_pants: '170',
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
await log({ role: 'parent', name: '韩梅梅妈妈' }, '家长提交参考尺码（风险占位）', '漏测补测前仅交参考尺码，不计入正式生产数量', s_han, oHan);
await log({ role: 'parent', name: '罗小宇爸爸' }, '家长提交参考尺码（风险占位）', '非首次订购，等待集中补测', s_luo, oLuo);
await log({ role: 'parent', name: '高天天妈妈' }, '家长提交参考尺码（风险占位）', '二(1)班漏测，与一(1)班竞争130码样衣', s_gao, oGao);
await log({ role: 'parent', name: '冯笑笑妈妈' }, '家长提交参考尺码（风险占位）', '一(1)班漏测，等待截止日前补测或预锁', s_feng, oFeng);

console.log('[seed] done. 测试账号密码统一为: uniform123');
console.log('[seed] 家长: chen_ma/lin_ba/wu_ma/zhou_ma/zheng_ba/sun_ma/he_ma/ma_ba/han_ma/luo_ba/gao_ma/feng_ma');
console.log('[seed] 老师: wangls/zhaols/qianls  总务: zw  供应商: gys  工厂: gc  售后: kf  管理员: admin');
await conn.end();
