// 端到端工作流验证：覆盖全部角色与异常场景
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
let cookie = '';
let pass = 0, fail = 0;

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  if (!res.ok || (json && json.ok === false)) {
    throw new Error(`${method} ${path} -> ${res.status}: ${json?.error || text.slice(0, 200)}`);
  }
  return json;
}
async function login(u) { cookie = ''; return req('POST', '/api/auth/login', { username: u, password: 'uniform123' }); }
const find = (arr, pred) => { const r = arr.find(pred); if (!r) throw new Error('not found: ' + pred.toString().slice(0, 80)); return r; };

(async () => {
  // 1. 登录与权限
  console.log('① 登录/权限');
  await login('gys');
  let r = await req('GET', '/api/plans');
  check('供应商只看到自己的计划', r.plans.length >= 2 && r.plans.every((p) => p.supplier_name.includes('锦绣')));
  r = await req('GET', '/api/dashboard/production-blockers');
  const linBlockBefore = r.blocked.filter((b) => b.student_name === '林小雨');
  check('供应商看到林小雨订单不可投产（未缴费）', linBlockBefore.length === 1, JSON.stringify(linBlockBefore));
  let blocked = false;
  try { await req('POST', '/api/plans', { name: 'x' }); } catch { blocked = true; }
  check('供应商不能创建订购计划', blocked);

  await login('chen_ma');
  r = await req('GET', '/api/students');
  check('家长只能看到自己孩子', r.students.length === 1 && r.students[0].name === '陈晓');
  const chenId = r.students[0].id;
  r = await req('GET', '/api/orders');
  check('家长看到自己订单', r.orders.length >= 1);
  const chenOrder = find(r.orders, (o) => o.student_name === '陈晓');

  // 2. 计划详情带试穿建议
  console.log('② 试穿建议带入下单');
  r = await req('GET', `/api/plans/${chenOrder.plan_id}?student_id=${chenId}`);
  check('陈晓试穿建议：上衣130/鞋34', r.fittingSuggestions?.top === '130' && r.fittingSuggestions?.shoes === '34',
    JSON.stringify(r.fittingSuggestions));

  // 3. 林小雨迟缴费：先挂起再缴费（超期路径），再解除/支付
  console.log('③ 林小雨缴费（投产前置条件）');
  await login('lin_ba');
  r = await req('GET', '/api/orders');
  const linOrder = find(r.orders, (o) => o.status === 'confirmed');
  await login('zw');
  await req('POST', `/api/orders/${linOrder.id}`, { id: linOrder.id, action: 'hold', reason: '迟缴费待核实' });
  r = await req('GET', `/api/orders/${linOrder.id}`);
  check('总务挂起迟缴费订单', r.order.status === 'hold');
  await req('POST', `/api/orders/${linOrder.id}`, { id: linOrder.id, action: 'release' });
  await login('lin_ba');
  await req('POST', `/api/orders/${linOrder.id}`, { id: linOrder.id, action: 'pay' });
  r = await req('GET', `/api/orders/${linOrder.id}`);
  check('家长缴费成功', r.order.status === 'paid' && Number(r.order.paid_amount) === Number(r.order.due_amount));
  await login('gys');
  r = await req('GET', '/api/dashboard/production-blockers');
  check('缴费后林小雨不再阻塞', !r.blocked.some((b) => b.student_name === '林小雨'));

  // 4. 供应商为林小雨明细建新批次（未分配的 120/120/33）
  console.log('④ 新批次：自动分配 FIFO');
  const p1 = find((await req('GET', '/api/plans')).plans, (p) => p.kind === 'annual');
  const pd = await req('GET', `/api/plans/${p1.id}`);
  const itemTop = find(pd.items, (i) => i.name === '春秋运动上衣');
  const itemPants = find(pd.items, (i) => i.name === '春秋运动长裤');
  const itemShoes = find(pd.items, (i) => i.name === '校鞋');
  const itemSkirt = find(pd.items, (i) => i.name === '礼服裙装');
  r = await req('POST', '/api/batches', {
    plan_id: p1.id, name: '验证批次-林小雨补缴费', expected_arrival: '2026-11-01',
    lines: [
      { plan_item_id: itemTop.id, size: '120', qty: 1 },
      { plan_item_id: itemPants.id, size: '120', qty: 1 },
      { plan_item_id: itemShoes.id, size: '33', qty: 1 },
    ],
  });
  const newBatchId = r.id;
  r = await req('GET', `/api/batches/${newBatchId}`);
  check('批次自动分配到林小雨', r.lines.every((l) => l.alloc_detail.includes('林小雨')));
  // 可投产数量不足应报错
  let err = '';
  try {
    await req('POST', '/api/batches', { plan_id: p1.id, name: '超量批次', lines: [{ plan_item_id: itemTop.id, size: '999', qty: 5 }] });
  } catch (e) { err = e.message; }
  check('超量投产被拦截并提示差额', err.includes('可投产数量不足'), err);

  // 5. 开工→报产→分两批发货
  console.log('⑤ 开工/报产/分批发货');
  await req('POST', `/api/batches/${newBatchId}`, { id: newBatchId, action: 'start' });
  r = await req('GET', `/api/batches/${newBatchId}`);
  const produceLines = r.lines.map((l) => ({ batch_item_id: l.id, produced_qty: l.qty }));
  await req('POST', `/api/batches/${newBatchId}`, { id: newBatchId, action: 'produce', lines: produceLines });
  const cands = (await req('GET', `/api/batches/${newBatchId}/candidates`)).candidates;
  const candTop = find(cands, (c) => c.item_name === '春秋运动上衣');
  const candPants = find(cands, (c) => c.item_name === '春秋运动长裤');
  const candShoes = find(cands, (c) => c.item_name === '校鞋');
  // 第一批：上衣+裤子
  r = await req('POST', '/api/shipments', {
    batch_id: newBatchId, carrier: '顺达物流', tracking_no: 'SF111',
    shipped_at: '2026-10-28 09:00:00', expected_arrival: '2026-11-01',
    lines: [{ order_item_id: candTop.order_item_id, qty: 1 }, { order_item_id: candPants.order_item_id, qty: 1 }],
  });
  const ship1 = r.id;
  // 第二批：鞋
  r = await req('POST', '/api/shipments', {
    batch_id: newBatchId, carrier: '顺达物流', tracking_no: 'SF222',
    shipped_at: '2026-10-30 09:00:00', expected_arrival: '2026-11-03',
    lines: [{ order_item_id: candShoes.order_item_id, qty: 1 }],
  });
  const ship2 = r.id;
  check('一个批次支持分两批发货', ship1 && ship2 && ship1 !== ship2);

  // 6. 总务到校确认：第一批齐套，第二批工厂漏发（到校0）
  console.log('⑥ 到校确认与工厂漏发登记');
  await login('zw');
  let sl = (await req('GET', `/api/shipments/${ship1}`)).lines;
  await req('POST', `/api/shipments/${ship1}`, {
    id: ship1, lines: sl.map((l) => ({ id: l.id, arrived_qty: 1 })),
  });
  sl = (await req('GET', `/api/shipments/${ship2}`)).lines;
  await req('POST', `/api/shipments/${ship2}`, {
    id: ship2, lines: sl.map((l) => ({ id: l.id, arrived_qty: 0 })),
  });
  r = await req('GET', '/api/shipments');
  const s2row = find(r.shipments, (x) => x.id === ship2);
  check('漏发数量=1', Number(s2row.missing_qty) === 1, JSON.stringify(s2row));
  r = await req('GET', `/api/orders/${linOrder.id}`);
  const missLog = r.logs.some((l) => l.action === '确认到货-工厂漏发');
  check('漏发进入学生时间线', missLog);

  // 7. 分批发放：正常发放上衣，裤子登记班级错领
  console.log('⑦ 分批发放/错领/缺件');
  // 找一(1)班 id
  const cls = (await req('GET', '/api/classes')).classes;
  const c11 = find(cls, (c) => c.name === '一(1)班');
  r = await req('POST', '/api/distributions', {
    plan_id: p1.id, class_id: c11.id, name: '一(1)班验证发放场', kind: 'regular',
    scheduled_at: '2026-11-04 15:00:00', location: '一(1)班教室',
  });
  const dist1 = r.id;
  r = await req('GET', `/api/distributions/${dist1}`);
  const candIssueTop = find(r.candidates, (c) => c.item_name === '春秋运动上衣' && c.student_name === '林小雨');
  const candIssuePants = find(r.candidates, (c) => c.item_name === '春秋运动长裤' && c.student_name === '林小雨');
  await req('POST', `/api/distributions/${dist1}`, { distribution_id: dist1, action: 'set_status', status: 'in_progress' });
  await req('POST', `/api/distributions/${dist1}`, { distribution_id: dist1, action: 'issue', order_item_id: candIssueTop.order_item_id, status: 'issued' });
  await req('POST', `/api/distributions/${dist1}`, {
    distribution_id: dist1, action: 'issue', order_item_id: candIssuePants.order_item_id,
    status: 'wrong_claim', claimant_student_id: chenId, reason: '被陈晓错领',
  });
  r = await req('GET', `/api/distributions/${dist1}`);
  check('发放记录含正常+错领', r.receipts.some((x) => x.status === 'issued') && r.receipts.some((x) => x.status === 'wrong_claim'));
  const wrongReceipt = find(r.receipts, (x) => x.status === 'wrong_claim');
  check('错领记录未闭环', wrongReceipt.handled === 0);
  // 补领场安排
  r = await req('POST', '/api/distributions', {
    plan_id: p1.id, class_id: c11.id, name: '一(1)班补领场', kind: 'supplementary',
    scheduled_at: '2026-11-06 15:00:00', location: '一(1)班教室',
  });
  check('可安排补领场', r.id > 0);

  // 8. 售后全流程
  console.log('⑧ 售后：漏发补发 / 错领闭环 / 成长换码 / 过敏投诉 / 转学退款');
  // 8.1 林小雨漏发鞋 → 补发
  await login('lin_ba');
  const linStudent = (await req('GET', '/api/students')).students[0];
  r = await req('POST', '/api/cases', {
    student_id: linStudent.id, order_id: linOrder.id, order_item_id: candShoes.order_item_id,
    type: 'resend', reason: 'factory_missing', priority: 'high',
    description: '第二批到校确认校鞋漏发1双，申请补发',
  });
  const caseShoes = r.id;
  await login('kf');
  await req('POST', `/api/cases/${caseShoes}`, { id: caseShoes, action: 'resend', phase: 'request', order_item_id: candShoes.order_item_id, size: '33', qty: 1 });
  await req('POST', `/api/cases/${caseShoes}`, { id: caseShoes, action: 'resend', phase: 'shipped', tracking: 'RS001' });
  await req('POST', `/api/cases/${caseShoes}`, { id: caseShoes, action: 'resend', phase: 'arrived' });
  await req('POST', `/api/cases/${caseShoes}`, { id: caseShoes, action: 'resend', phase: 'done', resolution: '补发校鞋已补领' });
  r = await req('GET', `/api/cases/${caseShoes}`);
  check('漏发补发全流程闭环', r.case.status === 'resolved' && r.resends[0].status === 'done');

  // 8.2 错领工单（错领裤子找不回 → 补发）并闭环签收异常
  r = await req('POST', '/api/cases', {
    student_id: linStudent.id, order_id: linOrder.id, order_item_id: candPants.order_item_id,
    type: 'wrong_claim', reason: 'wrong_class_claim',
    description: '长裤被陈晓错领且无法找回，需补发',
  });
  const caseWrong = r.id;
  await req('POST', `/api/cases/${caseWrong}`, { id: caseWrong, action: 'resend', phase: 'request', order_item_id: candPants.order_item_id, size: '120', qty: 1 });
  await req('POST', `/api/cases/${caseWrong}`, { id: caseWrong, action: 'resend', phase: 'shipped' });
  await req('POST', `/api/cases/${caseWrong}`, { id: caseWrong, action: 'resend', phase: 'arrived' });
  await req('POST', `/api/cases/${caseWrong}`, { id: caseWrong, action: 'resend', phase: 'done' });
  r = await req('GET', `/api/distributions/${dist1}`);
  check('补发完成后错领签收记录自动闭环', find(r.receipts, (x) => x.id === wrongReceipt.id).handled === 1);

  // 8.3 陈晓换码（试穿偏差：上衣 130→140）
  await login('chen_ma');
  const chenDetail = await req('GET', `/api/orders/${chenOrder.id}`);
  const chenTopItem = find(chenDetail.items, (i) => i.garment_type === 'top');
  r = await req('POST', '/api/cases', {
    student_id: chenId, order_id: chenOrder.id, order_item_id: chenTopItem.id,
    type: 'exchange', reason: 'fitting_deviation',
    description: '成衣版型偏小，130紧绷，换140',
  });
  const caseEx = r.id;
  await login('gys');
  await req('POST', `/api/cases/${caseEx}`, { id: caseEx, action: 'exchange', phase: 'request', old_size: '130', new_size: '140' });
  await req('POST', `/api/cases/${caseEx}`, { id: caseEx, action: 'exchange', phase: 'returned', tracking: 'RET01' });
  await req('POST', `/api/cases/${caseEx}`, { id: caseEx, action: 'exchange', phase: 'reshipped', tracking: 'NEW01' });
  await req('POST', `/api/cases/${caseEx}`, { id: caseEx, action: 'exchange', phase: 'done', new_size: '140' });
  r = await req('GET', `/api/orders/${chenOrder.id}`);
  check('换码完成后订单明细尺码更新为140', find(r.items, (i) => i.id === chenTopItem.id).size === '140');

  // 8.4 何苗过敏投诉处理
  await login('kf');
  r = await req('GET', '/api/cases?status=open');
  const allergy = find(r.cases, (c) => c.reason === 'allergy');
  await req('POST', `/api/cases/${allergy.id}`, { id: allergy.id, action: 'resolve', resolution: '检测合格，提供纯棉换购' });
  r = await req('GET', `/api/cases/${allergy.id}`);
  check('面料过敏投诉可处理归档', r.case.status === 'resolved');

  // 8.5 转学 + 退款：孙朵朵
  await login('zw');
  let sunStudent;
  {
    const all = (await req('GET', '/api/students')).students;
    sunStudent = find(all, (s) => s.name === '孙朵朵');
  }
  r = await req('POST', '/api/students/transfer', { student_id: sunStudent.id });
  check('转学自动生成退款工单', Array.isArray(r.case_ids) && r.case_ids.length === 1, JSON.stringify(r));
  const transferCase = r.case_ids[0];
  r = await req('GET', `/api/cases/${transferCase}`);
  check('转学后订单挂起', (await req('GET', `/api/orders/${r.case.order_id}`)).order.status === 'hold');
  await req('POST', `/api/cases/${transferCase}`, { id: transferCase, action: 'refund', phase: 'approve' });
  await req('POST', `/api/cases/${transferCase}`, { id: transferCase, action: 'refund', phase: 'refunded' });
  r = await req('GET', `/api/cases/${transferCase}`);
  check('转学退款完成', r.refunds[0].status === 'refunded' && r.case.status === 'resolved');

  // 9. 贫困生减免金额
  console.log('⑨ 贫困生减免');
  const wuOrder = find((await req('GET', '/api/orders')).orders, (o) => o.student_name === '吴磊');
  check('吴磊减免50%', Number(wuOrder.subsidy_amount) === Number(wuOrder.payable_amount) * 0.5
    && Number(wuOrder.due_amount) === Number(wuOrder.payable_amount) * 0.5,
    `${wuOrder.subsidy_amount}/${wuOrder.payable_amount}`);

  // 10. 供应商考核自动统计
  console.log('⑩ 供应商考核');
  await req('POST', '/api/assessments', {
    supplier_id: wuOrder ? 1 : 1, plan_id: p1.id, period: '2026-2027验证', score: 88,
  });
  r = await req('GET', '/api/assessments');
  const a0 = r.assessments[0];
  check('考核自动统计漏发≥1', Number(a0.missing_count) >= 1, JSON.stringify({ m: a0.missing_count, al: a0.allergy_count, ex: a0.exchange_count }));

  // 11. 看板
  console.log('⑪ 进度看板按学生/班级汇总');
  r = await req('GET', `/api/dashboard/progress?plan_id=${p1.id}`);
  const chenRow = find(r.students, (x) => x.name === '陈晓');
  check('看板含缴费/试穿/签收列', chenRow.paid_cnt >= 1 && Number(chenRow.fitted) >= 1, JSON.stringify(chenRow));
  const classRow = find(r.classes, (x) => x.class_name === '一(1)班');
  check('班级汇总存在', classRow.students >= 4);

  // 12. 集中试穿漏测：补测与生产锁定
  console.log('⑫ 漏测补测/风险占位/双确认/截止日预锁延后');
  await login('zw');
  // 12.1 漏测名单：唐糖/冯远/韩雪未参加任何试穿；沈星已有补测记录不在名单
  r = await req('GET', `/api/makeup?plan_id=${p1.id}`);
  const missNames = r.missing.map((x) => x.student_name).sort();
  check('漏测名单=唐糖/冯远/韩雪（沈星已补测过）',
    JSON.stringify(missNames) === JSON.stringify(['冯远', '唐糖', '韩雪']), JSON.stringify(missNames));
  check('风险占位汇总≥3（唐/冯/韩/沈）', r.summary.risk >= 3, JSON.stringify(r.summary));
  // 供应商视角：风险占位订单不能投产
  await login('gys');
  r = await req('GET', '/api/dashboard/production-blockers');
  check('投产限制列出漏测风险占位订单', r.size_blocked.some((b) => b.student_name === '唐糖' && b.size_lock === 'risk_placeholder'),
    JSON.stringify(r.size_blocked.map((b) => b.student_name)));

  // 12.2 首次生成候选：二(1)班覆盖唐糖（冯远缺150样衣→样衣不足异常），一(1)班覆盖韩雪
  await login('zw');
  r = await req('POST', '/api/makeup', { action: 'generate', plan_id: p1.id });
  check('生成2个班级候选（含多班竞争）', r.created.length === 2, JSON.stringify(r.created));
  check('样衣不足被拦截并提示', r.blocked.some((b) => b.reason.includes('样衣不足')), JSON.stringify(r.blocked));
  const c21row = (await req('GET', '/api/classes')).classes.find((c) => c.name === '二(1)班');
  const c11row = (await req('GET', '/api/classes')).classes.find((c) => c.name === '一(1)班');
  r = await req('GET', `/api/makeup?plan_id=${p1.id}`);
  const c21Session = find(r.sessions, (s) => s.class_name === '二(1)班' && s.status === 'candidate');
  const c11Session = find(r.sessions, (s) => s.class_name === '一(1)班' && s.status === 'candidate');
  check('多班竞争按优先级排序（二(1)班优先级不低于一(1)班）', c21Session.priority_score >= c11Session.priority_score,
    `${c21Session.priority_score} vs ${c11Session.priority_score}`);
  check('冯远生成样衣不足异常(open)', r.exceptions.some((e) => e.student_name === '冯远' && e.type === 'sample_shortage' && e.status === 'open'));
  const tangMk = find(r.students, (x) => x.student_name === '唐糖');
  check('唐糖已挂入二(1)候选场次', tangMk.makeup_session_id === c21Session.id);
  const fengMk0 = find(r.students, (x) => x.student_name === '冯远');
  check('冯远样衣不足状态', fengMk0.status === 'sample_shortage');

  // 12.3 人工调整必须填写原因
  let adjErr = '';
  try {
    await req('PATCH', `/api/makeup/${c21Session.id}`, { id: c21Session.id, location: '另一间教室' });
  } catch (e) { adjErr = e.message; }
  check('人工调整不留原因被拒绝', adjErr.includes('调整原因'), adjErr);

  // 12.4 供应商补 150 样衣后再次生成，冯远挂入同场候选
  const campusMingde = (await req('GET', '/api/campuses')).campuses.find((c) => c.name.includes('明德'));
  await login('gys');
  await req('POST', '/api/makeup/resources', { kind: 'stock', campus_id: campusMingde.id, size: '150', qty: 2 });
  await login('zw');
  r = await req('POST', '/api/makeup', { action: 'generate', plan_id: p1.id });
  check('补样衣后冯远可挂入候选', r.created.some((x) => (x.shortage || []).length === 0 && (x.covered || []).includes('冯远'))
    || r.created.length === 0, JSON.stringify(r.created));
  r = await req('GET', `/api/makeup?plan_id=${p1.id}&class_id=${c21row.id}`);
  const fengMk = find(r.students, (x) => x.student_name === '冯远');
  check('冯远已挂入二(1)候选场次', fengMk.makeup_session_id === c21Session.id, JSON.stringify(fengMk));

  // 12.5 家长提交参考尺码（冯远）→ 仍风险占位
  await login('feng_ba');
  await req('POST', `/api/makeup/students/${fengMk.id}`, { action: 'submit_ref', sizes: { top: '150', pants: '150', coat: '150' } });
  r = await req('GET', `/api/orders`);
  const fengOrder = find(r.orders, (o) => o.student_name === '冯远');
  check('冯远提交参考尺码后仍风险占位', fengOrder.size_lock === 'risk_placeholder', JSON.stringify(fengOrder));

  // 12.6 班主任确认排期 → 生成 kind=makeup 试穿时段
  await login('zhaols');
  await req('POST', `/api/makeup/${c21Session.id}`, { action: 'schedule', adjust_reason: '与教研时间错开，维持原时段' });
  r = await req('GET', '/api/fitting-sessions');
  check('排期后试穿日出现补测时段(kind=makeup)', r.sessions.some((s) => s.plan_id === p1.id && s.class_name === '二(1)班'));

  // 12.7 登记实测：唐糖与参考一致；冯远实测150
  await req('POST', `/api/makeup/${c21Session.id}`, {
    action: 'record', student_id: tangMk.id, sizes: { top: '130', pants: '130', shoes: '34' },
  });
  await req('POST', `/api/makeup/${c21Session.id}`, {
    action: 'record', student_id: fengMk.id, sizes: { top: '150', pants: '150', coat: '150' },
  });
  // 班主任先确认测量记录（必须先于家长）
  await req('POST', `/api/makeup/${c21Session.id}`, {
    action: 'teacher_confirm', student_ids: [tangMk.id, fengMk.id], deadline: '2026-12-31 18:00:00',
  });
  r = await req('GET', `/api/makeup/${c21Session.id}`);
  check('班主任确认后两生等待家长确认',
    find(r.students, (s) => s.id === tangMk.id).status === 'teacher_done' &&
    find(r.students, (s) => s.id === fengMk.id).status === 'teacher_done');
  let orderErr = '';
  try {
    await login('tang_ma');
    await req('POST', `/api/makeup/students/${tangMk.id}`, { action: 'parent_confirm', sizes: { top: '130', pants: '130', shoes: '34' } });
  } catch (e) { orderErr = e.message; }
  check('唐糖双确认顺序正常（班主任先、家长后）', !orderErr, orderErr);

  // 家长不能跳过班主任确认：找一个未确认的场次学生（韩雪 waiting）直接 parent_confirm 应失败
  await login('zw');
  r = await req('GET', `/api/makeup?plan_id=${p1.id}`);
  const hanMk = find(r.students, (x) => x.student_name === '韩雪');
  let skipErr = '';
  try {
    await login('han_ma');
    await req('POST', `/api/makeup/students/${hanMk.id}`, { action: 'parent_confirm', sizes: { top: '120' } });
  } catch (e) { skipErr = e.message; }
  check('班主任未确认时家长不能确认最终尺码', skipErr.includes('班主任尚未确认'), skipErr);

  // 12.8 唐糖一致闭环→可投产
  await login('zw');
  r = await req('GET', `/api/orders`);
  const tangOrder = find(r.orders, (o) => o.student_name === '唐糖');
  check('唐糖正式锁定', tangOrder.size_lock === 'locked', JSON.stringify(tangOrder));
  await login('gys');
  r = await req('POST', '/api/batches', {
    plan_id: p1.id, name: '补测闭环批次-唐糖130上衣', expected_arrival: '2026-11-05',
    lines: [{ plan_item_id: itemTop.id, size: '130', qty: 1 }],
  });
  const tangBatch = r.id;
  r = await req('GET', `/api/batches/${tangBatch}`);
  check('双确认一致闭环后可投产并分配到唐糖', r.lines.every((l) => l.alloc_detail.includes('唐糖')), JSON.stringify(r.lines));

  // 12.9 冯远家长确认与实测不一致 → 待复核，供应商不能锁定生产
  await login('feng_ba');
  r = await req('POST', `/api/makeup/students/${fengMk.id}`, {
    action: 'parent_confirm', sizes: { top: '160', pants: '150', coat: '150' },
  });
  check('两次确认不一致进入待复核', r.status === 'review', JSON.stringify(r));
  await login('gys');
  let reviewErr = '';
  try {
    await req('POST', '/api/batches', { plan_id: p1.id, name: '冯远不应投产', lines: [{ plan_item_id: itemTop.id, size: '150', qty: 1 }] });
  } catch (e) { reviewErr = e.message; }
  check('待复核订单不能锁定生产（150可投产不足）', reviewErr.includes('可投产数量不足'), reviewErr);

  // 12.10 风险占位（沈星）不计正式数量：130裙装孙朵朵已分满，沈星占位不能投产
  let riskErr = '';
  try {
    await req('POST', '/api/batches', { plan_id: p1.id, name: '沈星不应投产', lines: [{ plan_item_id: itemSkirt.id, size: '130', qty: 1 }] });
  } catch (e) { riskErr = e.message; }
  check('家长超时风险占位不计正式数量', riskErr.includes('可投产数量不足'), riskErr);

  // 12.11 总务复核裁定冯远按实测150闭环 → 可投产
  await login('zw');
  await req('POST', `/api/makeup/students/${fengMk.id}`, {
    action: 'review_resolve', sizes: { top: '150', pants: '150', coat: '150' }, reason: '与家长电话复核，按实测150裁定',
  });
  await login('gys');
  r = await req('POST', '/api/batches', {
    plan_id: p1.id, name: '复核裁定批次-冯远150', expected_arrival: '2026-11-06',
    lines: [{ plan_item_id: itemTop.id, size: '150', qty: 1 }],
  });
  const fengBatch = r.id;
  r = await req('GET', `/api/batches/${fengBatch}`);
  check('复核裁定后冯远可投产', r.lines.every((l) => l.alloc_detail.includes('冯远')));

  // 12.12 截止日未闭环：韩雪延后（不计本批）；沈星按参考尺码预锁（可投产）
  await login('zw');
  await req('POST', `/api/makeup/students/${hanMk.id}`, { action: 'ga_decision', decision: 'postpone', reason: '学生病假复课时间未定，本批延后，不影响班级整批到校' });
  r = await req('GET', '/api/orders');
  const hanOrder = find(r.orders, (o) => o.student_name === '韩雪');
  check('韩雪延后且订单留痕', hanOrder.size_lock === 'risk_placeholder' && (hanOrder.hold_reason || '').includes('延后'), JSON.stringify(hanOrder));
  let postponeErr = '';
  await login('gys');
  try {
    await req('POST', '/api/batches', { plan_id: p1.id, name: '韩雪延后不应投产', lines: [{ plan_item_id: itemPants.id, size: '120', qty: 1 }] });
  } catch (e) { postponeErr = e.message; }
  check('延后学生不计正式数量（120长裤仅林小雨已分满）', postponeErr.includes('可投产数量不足'), postponeErr);

  r = await req('GET', `/api/makeup?plan_id=${p1.id}`);
  const shenMk = find(r.students, (x) => x.student_name === '沈星');
  await login('zw');
  await req('POST', `/api/makeup/students/${shenMk.id}`, { action: 'ga_decision', decision: 'prelock', reason: '生产截止日仍未闭环，按家长参考尺码预锁，到货后优先试穿复核' });
  await login('gys');
  r = await req('POST', '/api/batches', {
    plan_id: p1.id, name: '参考预锁批次-沈星130上衣', expected_arrival: '2026-11-07',
    lines: [{ plan_item_id: itemTop.id, size: '130', qty: 1 }],
  });
  const shenBatch = r.id;
  r = await req('GET', `/api/batches/${shenBatch}`);
  check('总务按参考尺码预锁后可投产并分配到沈星', r.lines.every((l) => l.alloc_detail.includes('沈星')));

  // 12.13 系统重算与留痕：订单时间线含重算记录；异常台账可追溯/闭环
  r = await req('GET', `/api/orders/${shenMk.order_id}`);
  check('预锁决定与重算影响写入学生订单时间线',
    r.logs.some((l) => l.action === '生产截止日-按参考尺码预锁') &&
    r.logs.some((l) => l.action === '系统重算班级数量与生产批次'));
  await login('zw');
  r = await req('GET', `/api/makeup?plan_id=${p1.id}`);
  check('班级数量重算返回正式数量/未分配/批次/到校承诺',
    r.recomputes.length >= 1 && r.recomputes.some((x) => Array.isArray(x.formal_lines) && x.affected_batches.length >= 0));
  check('异常台账含补测逾期/家长超时/样衣不足',
    r.exceptions.some((e) => e.type === 'makeup_overdue') &&
    r.exceptions.some((e) => e.type === 'parent_timeout') &&
    r.exceptions.some((e) => e.type === 'sample_shortage'));
  const openShortage = find(r.exceptions, (e) => e.type === 'sample_shortage' && e.status === 'open');
  await req('POST', '/api/makeup', { action: 'resolve_exception', id: openShortage.id, resolution: '150码样衣已调拨，冯远已完成补测' });
  // 逾期巡检幂等（已存在的逾期/超时不重复计数）
  r = await req('POST', '/api/makeup', { action: 'sweep', plan_id: p1.id });
  check('巡检幂等（无新增重复异常）', r.overdue_sessions === 0 && r.parent_timeouts === 0, JSON.stringify(r));

  console.log(`\n结果：${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch( (e) => { console.error('\n💥 E2E 异常中断:', e.message); process.exit(1); });
