'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/fetch';
import { Badge, Modal, useToast } from '@/components/ui';
import { EXCEPTION_LABELS } from '@/lib/types';

const SIZES = ['', '110', '120', '130', '140', '150', '160', '170', '175', '180'];
const SHOES = ['', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40'];
const COLS = [['top', '上衣'], ['pants', '裤子'], ['skirt', '裙装'], ['coat', '外套'], ['shoes', '鞋码']] as const;
type SizeMap = Record<string, string>;
const emptySizes = (): SizeMap => ({ top: '', pants: '', skirt: '', coat: '', shoes: '' });

function SizeRow({ value, onChange, readonly }: { value: SizeMap; onChange?: (v: SizeMap) => void; readonly?: boolean }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {COLS.map(([k, l]) => (
        <label key={k} className="muted" style={{ fontSize: 12 }}>
          {l}
          {readonly ? <b style={{ marginLeft: 4 }}>{(value as any)[k] || '—'}</b> : (
            <select style={{ marginLeft: 4, width: 70 }} value={(value as any)[k] || ''}
              onChange={(e) => onChange && onChange({ ...value, [k]: e.target.value })}>
              {(k === 'shoes' ? SHOES : SIZES).map((z) => <option key={z} value={z}>{z || '—'}</option>)}
            </select>
          )}
        </label>
      ))}
    </div>
  );
}

export default function MakeupPage() {
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState('students');
  const [plans, setPlans] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [campuses, setCampuses] = useState<any[]>([]);
  const [planId, setPlanId] = useState('');
  const [data, setData] = useState<any>({ students: [], sessions: [], exceptions: [], classSummary: [] });
  const [risk, setRisk] = useState<any>(null);
  const { show, node } = useToast();

  const load = () =>
    api(`/api/makeup${planId ? `?plan_id=${planId}` : ''}`).then(setData);
  useEffect(() => {
    api('/api/auth/me').then((d) => setMe(d.user));
    api('/api/plans').then((d) => { setPlans(d.plans); if (!planId && d.plans[0]) setPlanId(String(d.plans[0].id)); });
    api('/api/classes').then((d) => setClasses(d.classes)).catch(() => {});
    api('/api/campuses').then((d) => setCampuses(d.campuses || [])).catch(() => {});
  }, []);
  useEffect(() => { if (planId) load(); }, [planId]);
  useEffect(() => { if (tab === 'risk') api('/api/makeup-risk').then(setRisk).catch(() => {}); }, [tab]);

  if (!me) return <div className="empty">加载中…</div>;
  const role = me.role;
  const isGA = ['general_affairs', 'admin'].includes(role);
  const isTeacher = role === 'head_teacher';
  const isSupplier = ['supplier', 'factory'].includes(role);
  const isParent = role === 'parent';

  const tabs = [
    { k: 'students', l: '补测学生与生产锁定', roles: ['general_affairs', 'admin', 'head_teacher', 'parent', 'supplier', 'factory'] },
    { k: 'sessions', l: '候选与补测场', roles: ['general_affairs', 'admin', 'head_teacher'] },
    { k: 'exceptions', l: '异常台账', roles: ['general_affairs', 'admin', 'head_teacher', 'parent', 'supplier', 'factory'] },
    { k: 'risk', l: '风险占位看板', roles: ['supplier', 'factory', 'general_affairs', 'admin'] },
    { k: 'settings', l: '空闲/样衣/截止日', roles: ['general_affairs', 'admin', 'head_teacher', 'supplier', 'factory'] },
  ].filter((t) => t.roles.includes(role));

  const act = async (path: string, body: any) => {
    await api(path, { method: 'POST', body: JSON.stringify(body) });
    show('操作成功'); load();
  };

  return (
    <div>
      {node}
      <div className="spread">
        <h2>集中试穿漏测 · 补测与生产锁定</h2>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} style={{ maxWidth: 280 }}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="row" style={{ gap: 6, margin: '8px 0 16px', flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.k} className="btn sm" onClick={() => setTab(t.k)}
            style={{ background: tab === t.k ? 'var(--brand)' : 'var(--gray-bg)', color: tab === t.k ? '#fff' : 'var(--ink)' }}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === 'students' && (
        <StudentsTab me={me} isGA={isGA} isTeacher={isTeacher} isParent={isParent} isSupplier={isSupplier}
          data={data} planId={planId} classes={classes} reload={load} show={show} />
      )}
      {tab === 'sessions' && (
        <SessionsTab planId={planId} classes={classes} data={data} reload={load} show={show} />
      )}
      {tab === 'exceptions' && <ExceptionsTab rows={data.exceptions || []} reload={load} show={show} />}
      {tab === 'risk' && <RiskTab data={risk} planId={planId} />}
      {tab === 'settings' && <SettingsTab me={me} isGA={isGA} isTeacher={isTeacher} isSupplier={isSupplier}
        planId={planId} plans={plans} classes={classes} campuses={campuses} reload={load} show={show} />}
    </div>
  );
}

function StudentsTab({ me, isGA, isTeacher, isParent, isSupplier, data, planId, classes, reload, show }: any) {
  const [editing, setEditing] = useState<any>(null);
  const rows: any[] = (data.students || []).filter((x: any) => !planId || String(x.plan_id) === planId);
  const register = async () => {
    try { await api('/api/makeup', { method: 'POST', body: JSON.stringify({ action: 'register', plan_id: Number(planId) }) }); show('已按未参加试穿学生登记漏测'); reload(); }
    catch (e: any) { show(e.message, true); }
  };
  return (
    <div>
      <div className="card">
        <div className="spread">
          <h2>班级数量重算（正式 vs 风险占位）</h2>
          {(isGA || isTeacher) && <button className="btn sm" onClick={register}>登记/刷新漏测学生</button>}
        </div>
        <table>
          <thead><tr><th>班级</th><th>正式可生产(单/件)</th><th>风险占位(不计入)</th><th>待复核</th><th>延后</th></tr></thead>
          <tbody>
            {(data.classSummary || []).map((c: any, i: number) => (
              <tr key={i}>
                <td>{c.class_name}</td>
                <td><b style={{ color: 'var(--green)' }}>{c.formal_orders} / {c.formal_qty}</b></td>
                <td>{c.placeholder_orders > 0 ? <span style={{ color: 'var(--red)' }}>{c.placeholder_orders} / {c.placeholder_qty}</span> : '0 / 0'}</td>
                <td>{c.review_orders > 0 ? <span style={{ color: 'var(--red)' }}>{c.review_orders}</span> : 0}</td>
                <td>{c.deferred_orders > 0 ? <span style={{ color: 'var(--amber)' }}>{c.deferred_orders}</span> : 0}</td>
              </tr>
            ))}
            {!(data.classSummary || []).length && <tr><td colSpan={5} className="empty">暂无漏测学生，点击右上角登记</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>漏测学生补测链路</h2>
        <p className="muted">补测前家长只能提交<b>参考尺码（风险占位，不计入正式数量）</b>；补测后班主任先确认测量、家长再确认最终尺码；不一致进入待复核，供应商不能锁定生产。</p>
        <table>
          <thead><tr>
            <th>学生</th><th>班级/计划</th><th>首购</th><th>补测状态</th><th>生产锁定</th><th>截止日</th>
            <th>参考尺码</th><th>班主任测量</th><th>家长最终</th><th>操作</th>
          </tr></thead>
          <tbody>
            {rows.map((x) => {
              const pastDeadline = x.production_deadline && new Date(x.production_deadline) < new Date();
              const open = ['need_makeup', 'referenced', 'scheduled', 'measured', 'review'].includes(x.status);
              return (
                <tr key={x.id}>
                  <td>{x.student_name}<div className="muted" style={{ fontSize: 11 }}>{x.student_no}</div></td>
                  <td style={{ fontSize: 12 }}>{x.class_name}<div className="muted">{x.plan_name}</div></td>
                  <td>{x.is_first_order ? '是' : '否'}</td>
                  <td><Badge status={x.status} /></td>
                  <td>{x.production_lock && x.production_lock !== 'none' ? <Badge status={x.production_lock} /> : <span className="muted">—</span>}</td>
                  <td style={{ fontSize: 11 }}>{x.production_deadline || '未设置'}{pastDeadline && open && <div style={{ color: 'var(--red)' }}>已到截止日</div>}</td>
                  <td style={{ fontSize: 11 }}>{sizesText(x, 'ref')}</td>
                  <td style={{ fontSize: 11 }}>{x.m_confirmed_at ? sizesText(x, 'm') : (x.m_recorded_at ? <span className="muted">待教师确认</span> : '—')}</td>
                  <td style={{ fontSize: 11 }}>{x.f_confirmed_at ? sizesText(x, 'f') : '—'}{x.mismatch ? <div style={{ color: 'var(--red)' }}>不一致</div> : null}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {isParent && ['need_makeup', 'referenced', 'scheduled'].includes(x.status) &&
                        <button className="btn sm" onClick={() => setEditing({ kind: 'reference', x })}>参考尺码</button>}
                      {isTeacher && ['scheduled', 'measured'].includes(x.status) &&
                        <button className="btn sm" onClick={() => setEditing({ kind: 'record', x })}>录入测量</button>}
                      {isTeacher && x.status === 'scheduled' && x.m_recorded_at &&
                        <button className="btn secondary sm" onClick={() => run(x.id, 'teacher_confirm', {}, reload, show)}>确认测量</button>}
                      {isTeacher && x.status === 'measured' &&
                        <button className="btn secondary sm" onClick={() => run(x.id, 'teacher_confirm', {}, reload, show)}>重新确认测量</button>}
                      {isParent && x.status === 'measured' &&
                        <button className="btn sm" onClick={() => setEditing({ kind: 'parent', x })}>最终确认</button>}
                      {isGA && x.status === 'review' &&
                        <button className="btn danger sm" onClick={() => setEditing({ kind: 'review', x })}>复核裁决</button>}
                      {isGA && open && pastDeadline &&
                        <button className="btn secondary sm" onClick={() => setEditing({ kind: 'deadline', x })}>预锁/延后</button>}
                      <a className="muted" style={{ fontSize: 11 }} href={`/orders/${x.order_id}`}>订单›</a>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={10} className="empty">暂无漏测学生</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <StudentModal editing={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} show={show} />}
    </div>
  );
}

async function run(id: number, action: string, extra: any, reload: () => void, show: (t: string, e?: boolean) => void) {
  try { await api(`/api/makeup/${id}`, { method: 'POST', body: JSON.stringify({ id, action, ...extra }) }); show('操作成功'); reload(); }
  catch (e: any) { show(e.message, true); }
}

function sizesText(x: any, p: string) {
  const v = (g: string) => x[`${p}_size_${g}`];
  return `上${v('top') || '-'} 裤${v('pants') || '-'} 裙${v('skirt') || '-'} 外${v('coat') || '-'} 鞋${v('shoes') || '-'}`;
}

function StudentModal({ editing, onClose, onDone, show }: any) {
  const { kind, x } = editing;
  const [sizes, setSizes] = useState<SizeMap>({
    top: x[kind === 'parent' ? 'm_size_top' : 'ref_size_top'] || '',
    pants: x[kind === 'parent' ? 'm_size_pants' : 'ref_size_pants'] || '',
    skirt: x[kind === 'parent' ? 'm_size_skirt' : 'ref_size_skirt'] || '',
    coat: x[kind === 'parent' ? 'm_size_coat' : 'ref_size_coat'] || '',
    shoes: x[kind === 'parent' ? 'm_size_shoes' : 'ref_size_shoes'] || '',
  });
  const [staff, setStaff] = useState(x.m_staff_name || '');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState('use_teacher');
  const [reason, setReason] = useState('');
  const [arrival, setArrival] = useState('');
  const [mismatchDemo, setMismatchDemo] = useState(false);

  const titles: any = {
    reference: '家长提交参考尺码（风险占位，不计入正式数量）',
    record: '班主任录入补测测量',
    parent: '家长最终确认尺码（与班主任一致才锁定）',
    review: '总务复核裁决（两次确认不一致）',
    deadline: '生产截止日处置',
  };

  async function submit() {
    try {
      if (kind === 'reference') {
        await api(`/api/makeup/${x.id}`, { method: 'POST', body: JSON.stringify({ id: x.id, action: 'reference', sizes }) });
      } else if (kind === 'record') {
        await api(`/api/makeup/${x.id}`, { method: 'POST', body: JSON.stringify({ id: x.id, action: 'record', ...sizesPrefix(sizes), staff_name: staff, special_note: note }) });
      } else if (kind === 'parent') {
        const finalSizes = mismatchDemo ? { ...sizes, top: bump(sizes.top) } : sizes;
        const r = await api(`/api/makeup/${x.id}`, { method: 'POST', body: JSON.stringify({ id: x.id, action: 'parent_confirm', sizes: finalSizes }) });
        if (r.mismatch) show('与班主任测量不一致：订单已进入待复核，供应商不能锁定生产', true);
      } else if (kind === 'review') {
        if (!reason) return show('请填写裁决原因', true);
        await api(`/api/makeup/${x.id}`, { method: 'POST', body: JSON.stringify({ id: x.id, action: 'review', decision, reason }) });
      } else if (kind === 'deadline') {
        if (!decision || !['prelock', 'defer'].includes(decision)) return show('请选择预锁或延后', true);
        if (!reason) return show('请填写处置原因（留痕）', true);
        await api(`/api/makeup/${x.id}`, { method: 'POST', body: JSON.stringify({ id: x.id, action: decision, reason, promised_arrival: arrival || undefined }) });
      }
      onDone();
    } catch (e: any) { show(e.message, true); }
  }

  return (
    <Modal title={titles[kind]} onClose={onClose} wide>
      <div className="muted" style={{ marginBottom: 8 }}>{x.student_name} · {x.class_name} · {x.plan_name}</div>
      {(kind === 'reference' || kind === 'record' || kind === 'parent') && (
        <>
          <SizeRow value={sizes} onChange={setSizes} />
          {kind === 'record' && (
            <div className="grid grid-2" style={{ marginTop: 10 }}>
              <div className="field"><label>测量工作人员</label><input value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="工作人员姓名" /></div>
              <div className="field"><label>特殊记录</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
          )}
          {kind === 'parent' && (
            <label className="row" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={mismatchDemo} onChange={(e) => setMismatchDemo(e.target.checked)} />
              <span className="muted">模拟与班主任测量不一致（上衣改一档，进入待复核）</span>
            </label>
          )}
        </>
      )}
      {kind === 'review' && (
        <>
          <div className="field"><label>裁决结果</label>
            <select value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="use_teacher">采用班主任测量尺码并锁定</option>
              <option value="use_parent">采用家长确认尺码并锁定</option>
              <option value="remeasure">退回重新补测</option>
            </select>
          </div>
          <div className="field"><label>裁决原因（留痕）</label><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </>
      )}
      {kind === 'deadline' && (
        <>
          <div className="field"><label>处置选择（同步重算班级数量、生产批次、到校承诺）</label>
            <select value={decision === 'use_teacher' ? '' : decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="">请选择</option>
              <option value="prelock">按家长参考尺码预锁（可投产）</option>
              <option value="defer">延后该学生（退出本批生产）</option>
            </select>
          </div>
          <div className="field"><label>处置原因（留痕）</label><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="field"><label>更新后的到校承诺（可选，YYYY-MM-DD）</label><input value={arrival} onChange={(e) => setArrival(e.target.value)} placeholder="2026-11-10" /></div>
        </>
      )}
      <div style={{ textAlign: 'right', marginTop: 10 }}><button className="btn" onClick={submit}>提交</button></div>
    </Modal>
  );
}

function sizesPrefix(s: SizeMap) {
  return { size_top: s.top || null, size_pants: s.pants || null, size_skirt: s.skirt || null, size_coat: s.coat || null, size_shoes: s.shoes || null };
}
function bump(z: string) {
  const i = SIZES.indexOf(z || '');
  return i >= 0 && i < SIZES.length - 1 ? SIZES[i + 1] : (z || '130') + '+';
}

function SessionsTab({ planId, classes, data, reload, show }: any) {
  const [classId, setClassId] = useState('');
  const [cands, setCands] = useState<any[] | null>(null);
  const [adjustFor, setAdjustFor] = useState<any>(null);
  const gen = async () => {
    if (!classId) return show('请先选择班级', true);
    try {
      const r = await api('/api/makeup', { method: 'POST', body: JSON.stringify({ action: 'generate', plan_id: Number(planId), class_id: Number(classId) }) });
      setCands(r.candidates || []); reload();
      if (r.message) show(r.message);
    } catch (e: any) { show(e.message, true); }
  };
  const confirm = async (id: number) => {
    try { await api('/api/makeup', { method: 'POST', body: JSON.stringify({ action: 'confirm_candidate', session_id: id }) }); show('补测场已确认并占用样衣'); setCands(null); reload(); }
    catch (e: any) { show(e.message, true); }
  };
  const sessions = (data.sessions || []).filter((s: any) => !planId || String(s.plan_id) === planId);
  return (
    <div>
      <div className="card">
        <div className="spread">
          <h2>生成补测候选时段</h2>
          <div className="row">
            <select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">选择班级</option>{classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn" onClick={gen}>生成候选（按样衣/空闲/优先级）</button>
          </div>
        </div>
        <p className="muted">多班竞争同一批样衣或同一时段时，按 <b>生产截止日 → 是否首次订购 → 已确认人数</b> 排序；样衣不足的候选明确标出差额。</p>
        {cands && cands.map((c) => (
          <div key={c.id} className="card" style={{ background: c.feasible ? '#f6fff8' : '#fff6f6' }}>
            <div className="spread">
              <b>{c.start_time} ~ {c.end_time} · {c.location}</b>
              <div className="row">
                {c.feasible
                  ? <button className="btn sm" onClick={() => confirm(c.id)}>确认该时段</button>
                  : <span style={{ color: 'var(--red)' }}>⛔ 样衣不足，不能确认</span>}
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>优先级 {c.priority_score} 分：{c.priority_detail}</div>
            {c.shortages.length > 0 && (
              <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>
                {c.shortages.map((s: any, i: number) => <div key={i}>品类#{s.plan_item_id} 尺码{s.size}：{s.reason}（总{s.total ?? 0} 已占用{s.held ?? 0}）</div>)}
              </div>
            )}
            {c.competing.length > 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                同时段竞争班级：{c.competing.map((x: any) => `${x.class_name}(${x.priority_score}分${x.higher ? '·更高' : ''})`).join('、')}
              </div>
            )}
          </div>
        ))}
        {cands && !cands.length && <div className="empty">该班暂无漏测学生或班主任未维护空闲时段</div>}
      </div>

      <div className="card">
        <h2>补测场安排</h2>
        <table>
          <thead><tr><th>编号</th><th>班级</th><th>时间</th><th>地点</th><th>状态</th><th>占用样衣</th><th>人数</th><th>人工调整原因</th><th>操作</th></tr></thead>
          <tbody>
            {sessions.map((s: any) => (
              <tr key={s.id}>
                <td className="mono" style={{ fontSize: 11 }}>{s.makeup_no}</td>
                <td>{s.class_name}</td>
                <td style={{ fontSize: 12 }}>{s.start_time}~{String(s.end_time).slice(11)}</td>
                <td>{s.location}</td>
                <td><Badge status={s.status} /></td>
                <td style={{ fontSize: 11 }}>{s.reserved || '—'}</td>
                <td>{s.student_count}</td>
                <td style={{ fontSize: 11, color: 'var(--amber)' }}>{s.manual_adjust_reason || '—'}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {(s.status === 'confirmed' || s.status === 'adjusted') &&
                      <button className="btn secondary sm" onClick={() => setAdjustFor(s)}>调整(留原因)</button>}
                    {(s.status === 'confirmed' || s.status === 'adjusted') &&
                      <button className="btn sm" onClick={() => sessionAct(s.id, 'complete', {}, reload, show)}>完成补测</button>}
                    {s.status !== 'completed' && s.status !== 'cancelled' &&
                      <button className="btn danger sm" onClick={() => {
                        const reason = prompt('取消原因（必填）') || ''; if (reason) sessionAct(s.id, 'cancel', { reason }, reload, show);
                      }}>取消</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!sessions.length && <tr><td colSpan={9} className="empty">暂无补测场</td></tr>}
          </tbody>
        </table>
      </div>
      {adjustFor && <AdjustModal s={adjustFor} onClose={() => setAdjustFor(null)} onDone={() => { setAdjustFor(null); reload(); }} show={show} />}
    </div>
  );
}

async function sessionAct(id: number, action: string, extra: any, reload: () => void, show: (t: string, e?: boolean) => void) {
  try { await api('/api/makeup', { method: 'POST', body: JSON.stringify({ action, session_id: id, ...extra }) }); show('操作成功'); reload(); }
  catch (e: any) { show(e.message, true); }
}

function AdjustModal({ s, onClose, onDone, show }: any) {
  const [f, setF] = useState({ start_time: s.start_time, end_time: s.end_time, location: s.location, reason: '' });
  async function submit() {
    if (!f.reason) return show('人工调整必须填写原因', true);
    try { await api('/api/makeup', { method: 'POST', body: JSON.stringify({ action: 'adjust', session_id: s.id, ...f }) }); onDone(); }
    catch (e: any) { show(e.message, true); }
  }
  return (
    <Modal title={`人工调整补测场 · ${s.makeup_no}`} onClose={onClose}>
      <div className="grid grid-2">
        <div className="field"><label>开始</label><input value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></div>
        <div className="field"><label>结束</label><input value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></div>
      </div>
      <div className="field"><label>地点</label><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
      <div className="field"><label>调整原因（必填，留痕）</label><textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      <div style={{ textAlign: 'right' }}><button className="btn" onClick={submit}>保存调整</button></div>
    </Modal>
  );
}

function ExceptionsTab({ rows, reload, show }: any) {
  const resolve = async (id: number) => {
    const resolution = prompt('处理说明（解决时填写）') || '';
    if (!resolution) return;
    try { await api('/api/makeup-exceptions', { method: 'POST', body: JSON.stringify({ id, action: 'resolve', resolution }) }); show('已解决'); reload(); }
    catch (e: any) { show(e.message, true); }
  };
  const ack = async (id: number) => {
    try { await api('/api/makeup-exceptions', { method: 'POST', body: JSON.stringify({ id, action: 'acknowledge' }) }); show('已知晓'); reload(); }
    catch (e: any) { show(e.message, true); }
  };
  return (
    <div className="card">
      <h2>可追溯异常台账</h2>
      <p className="muted">补测逾期、样衣不足、班主任超时未确认、家长超时未确认、生产截止日未闭环、两次确认不一致，系统自动登记并全程留痕。</p>
      <table>
        <thead><tr><th>单号</th><th>类型</th><th>状态</th><th>计划/班级</th><th>学生</th><th>详情</th><th>处理</th><th>操作</th></tr></thead>
        <tbody>
          {rows.map((e: any) => (
            <tr key={e.id}>
              <td className="mono" style={{ fontSize: 11 }}>{e.exc_no}</td>
              <td><Badge status={e.type} /><div className="muted" style={{ fontSize: 11 }}>{EXCEPTION_LABELS[e.type]}</div></td>
              <td><Badge status={e.status} /></td>
              <td style={{ fontSize: 12 }}>{e.plan_name}<div className="muted">{e.class_name || ''}</div></td>
              <td>{e.student_name || '—'}</td>
              <td style={{ fontSize: 12 }}>{e.detail}{e.resolution && <div className="muted">处理：{e.resolution}</div>}</td>
              <td style={{ fontSize: 11 }}>{e.acknowledged_name && <div>知晓：{e.acknowledged_name}</div>}{e.resolved_name && <div>解决：{e.resolved_name}</div>}</td>
              <td>
                <div className="row" style={{ gap: 4 }}>
                  {e.status === 'open' && <button className="btn secondary sm" onClick={() => ack(e.id)}>知晓</button>}
                  {e.status !== 'resolved' && <button className="btn sm" onClick={() => resolve(e.id)}>解决</button>}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="empty">暂无异常</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RiskTab({ data, planId }: any) {
  if (!data) return <div className="empty">加载中…</div>;
  const lines = (data.lines || []).filter((l: any) => !planId || String(l.plan_id) === planId);
  const risk = (data.risk || []).filter((r: any) => !planId || String(r.plan_id) === planId);
  return (
    <div>
      <div className="grid grid-4">
        <div className="stat"><div className="num" style={{ color: 'var(--green)' }}>{data.totals.formal}</div><div className="lbl">正式可生产(件)</div></div>
        <div className="stat"><div className="num" style={{ color: 'var(--red)' }}>{data.totals.placeholder}</div><div className="lbl">风险占位(不计入)</div></div>
        <div className="stat"><div className="num" style={{ color: 'var(--amber)' }}>{data.totals.review}</div><div className="lbl">待复核(不能锁定)</div></div>
        <div className="stat"><div className="num">{data.totals.deferred}</div><div className="lbl">延后(件)</div></div>
      </div>
      <div className="card">
        <h2>按品类+尺码：正式数量与风险占位分列</h2>
        <table>
          <thead><tr><th>计划</th><th>品类</th><th>尺码</th><th>正式可生产</th><th>其中预锁</th><th>风险占位</th><th>待复核</th><th>延后</th></tr></thead>
          <tbody>
            {lines.map((l: any, i: number) => (
              <tr key={i}>
                <td style={{ fontSize: 12 }}>{l.plan_name}</td><td>{l.item_name}</td><td><b>{l.size}</b></td>
                <td style={{ color: 'var(--green)' }}>{l.formal_qty}</td>
                <td>{l.prelocked_qty || 0}</td>
                <td style={{ color: l.placeholder_qty ? 'var(--red)' : undefined }}>{l.placeholder_qty || 0}</td>
                <td style={{ color: l.review_qty ? 'var(--red)' : undefined }}>{l.review_qty || 0}</td>
                <td>{l.deferred_qty || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>风险占位 / 待复核学生（供应商不能投产）</h2>
        <table>
          <thead><tr><th>订单号</th><th>学生</th><th>班级</th><th>件数</th><th>原因</th></tr></thead>
          <tbody>
            {risk.map((r: any) => (
              <tr key={r.order_id}>
                <td className="mono" style={{ fontSize: 11 }}>{r.order_no}</td><td>{r.student_name}</td><td>{r.class_name}</td><td>{r.qty}</td>
                <td style={{ color: 'var(--red)' }}>⛔ {r.risk_reason}</td>
              </tr>
            ))}
            {!risk.length && <tr><td colSpan={5} className="empty">没有风险占位学生</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsTab({ me, isGA, isTeacher, isSupplier, planId, plans, classes, campuses, reload, show }: any) {
  return (
    <div className="grid" style={{ gap: 16 }}>
      {(isTeacher || isGA) && <TeacherSlots me={me} campuses={campuses} show={show} />}
      {isSupplier && <SampleStocks planId={planId} plans={plans} campuses={campuses} show={show} />}
      {isGA && <ClassSettings planId={planId} classes={classes} show={show} />}
    </div>
  );
}

function TeacherSlots({ me, campuses, show }: any) {
  const [slots, setSlots] = useState<any[]>([]);
  const [f, setF] = useState({ campus_id: '', start_time: '', end_time: '', note: '' });
  const load = () => api('/api/teacher-slots').then((d) => setSlots(d.slots));
  useEffect(() => { load(); }, []);
  const submit = async () => {
    try { await api('/api/teacher-slots', { method: 'POST', body: JSON.stringify(f) }); setF({ campus_id: '', start_time: '', end_time: '', note: '' }); show('已添加空闲时段'); load(); }
    catch (e: any) { show(e.message, true); }
  };
  return (
    <div className="card">
      <h2>班主任空闲时段</h2>
      <div className="grid grid-2">
        <div className="field"><label>校区</label>
          <select value={f.campus_id} onChange={(e) => setF({ ...f, campus_id: e.target.value })}>
            <option value="">请选择</option>{campuses.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field"><label>备注</label><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="field"><label>开始</label><input placeholder="2026-10-12 15:00:00" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></div>
        <div className="field"><label>结束</label><input placeholder="2026-10-12 17:00:00" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></div>
      </div>
      <div style={{ textAlign: 'right' }}><button className="btn" onClick={submit}>添加</button></div>
      <table>
        <thead><tr><th>校区</th><th>起止</th><th>备注</th><th></th></tr></thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id}>
              <td>{s.campus_name}</td><td style={{ fontSize: 12 }}>{s.start_time} ~ {s.end_time}</td><td>{s.note}</td>
              <td><button className="btn danger sm" onClick={async () => { await api(`/api/teacher-slots?id=${s.id}`, { method: 'DELETE' }); load(); }}>删除</button></td>
            </tr>
          ))}
          {!slots.length && <tr><td colSpan={4} className="empty">暂无空闲时段</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SampleStocks({ planId, plans, campuses, show }: any) {
  const [stocks, setStocks] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ plan_id: planId, campus_id: '', plan_item_id: '', size: '130', total_qty: 2 });
  const load = (pid: string) => pid && api(`/api/sample-stocks?plan_id=${pid}`).then((d) => setStocks(d.stocks));
  useEffect(() => { if (planId) { setF((x) => ({ ...x, plan_id: planId })); load(planId); api(`/api/plans/${planId}`).then((d) => setItems(d.items)); } }, [planId]);
  const submit = async () => {
    try { await api('/api/sample-stocks', { method: 'POST', body: JSON.stringify({ ...f, plan_id: f.plan_id || planId }) }); show('样衣库存已保存'); load(f.plan_id || planId); }
    catch (e: any) { show(e.message, true); }
  };
  const plan = plans.find((p: any) => String(p.id) === String(f.plan_id || planId));
  return (
    <div className="card">
      <h2>供应商样衣库存（按校区/品类/尺码，多班共享竞争）</h2>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="field"><label>校区</label>
          <select value={f.campus_id} onChange={(e) => setF({ ...f, campus_id: e.target.value })}>
            <option value="">请选择</option>{campuses.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field"><label>品类</label>
          <select value={f.plan_item_id} onChange={(e) => setF({ ...f, plan_item_id: e.target.value })}>
            <option value="">请选择</option>{items.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div className="field"><label>尺码</label><input value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} /></div>
        <div className="field"><label>可用数量</label><input type="number" value={f.total_qty} onChange={(e) => setF({ ...f, total_qty: Number(e.target.value) })} /></div>
      </div>
      <div style={{ textAlign: 'right' }}><button className="btn" onClick={submit}>保存（同键覆盖）</button></div>
      <table>
        <thead><tr><th>校区</th><th>品类</th><th>尺码</th><th>总量</th><th>当前占用</th></tr></thead>
        <tbody>
          {stocks.map((s) => (
            <tr key={s.id}><td>{s.campus_name}</td><td>{s.item_name}</td><td><b>{s.size}</b></td><td>{s.total_qty}</td><td>{s.held_now || 0}</td></tr>
          ))}
          {!stocks.length && <tr><td colSpan={5} className="empty">暂无样衣库存（{plan?.name}）</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ClassSettings({ planId, classes, show }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ class_id: '', production_deadline: '', promised_arrival: '' });
  const load = () => planId && api(`/api/class-production-settings?plan_id=${planId}`).then((d) => setRows(d.settings));
  useEffect(() => { load(); }, [planId]);
  const submit = async () => {
    if (!f.class_id || !f.production_deadline) return show('班级与生产截止日必填', true);
    try { await api('/api/class-production-settings', { method: 'POST', body: JSON.stringify({ plan_id: Number(planId), ...f }) }); setF({ class_id: '', production_deadline: '', promised_arrival: '' }); show('已保存班级生产截止日'); load(); }
    catch (e: any) { show(e.message, true); }
  };
  return (
    <div className="card">
      <h2>班级生产截止日与到校承诺</h2>
      <div className="grid grid-3">
        <div className="field"><label>班级</label>
          <select value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}>
            <option value="">请选择</option>{classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field"><label>生产截止日</label><input placeholder="2026-10-15 18:00:00" value={f.production_deadline} onChange={(e) => setF({ ...f, production_deadline: e.target.value })} /></div>
        <div className="field"><label>到校承诺</label><input placeholder="2026-11-05" value={f.promised_arrival} onChange={(e) => setF({ ...f, promised_arrival: e.target.value })} /></div>
      </div>
      <div style={{ textAlign: 'right' }}><button className="btn" onClick={submit}>保存</button></div>
      <table>
        <thead><tr><th>班级</th><th>生产截止日</th><th>到校承诺</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.id}><td>{r.class_name}</td><td>{r.production_deadline}</td><td>{r.promised_arrival || '待重算'}</td></tr>)}
          {!rows.length && <tr><td colSpan={3} className="empty">暂未设置</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
