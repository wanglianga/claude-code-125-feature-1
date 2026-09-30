'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/fetch';
import { Badge, Modal, useToast } from '@/components/ui';

const SIZES = ['', '110', '120', '130', '140', '150', '160', '170', '175', '180'];
const SHOES = ['', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40'];
const SIZE_FIELDS = [['top', '上衣', false], ['pants', '裤', false], ['skirt', '裙', false], ['coat', '外套', false], ['shoes', '鞋码', true]] as const;

function SizeRow({ value, onChange, readonly }: { value: any; onChange?: (v: any) => void; readonly?: boolean }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {SIZE_FIELDS.map(([k, l, isShoe]) => (
        <label key={k} className="muted" style={{ fontSize: 12 }}>
          {l}
          {readonly ? <b style={{ marginLeft: 3 }}>{value?.[k] || '—'}</b> : (
            <select style={{ width: 64, marginLeft: 3 }} value={value?.[k] || ''}
              onChange={(e) => onChange({ ...value, [k]: e.target.value })}>
              {(isShoe ? SHOES : SIZES).map((z) => <option key={z} value={z}>{z || '—'}</option>)}
            </select>
          )}
        </label>
      ))}
    </div>
  );
}

export default function MakeupPage() {
  const [me, setMe] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [planId, setPlanId] = useState<string>('');
  const [classId, setClassId] = useState<string>('');
  const [tab, setTab] = useState<'sessions' | 'students' | 'exceptions' | 'recompute' | 'resources'>('sessions');
  const [d, setD] = useState<any>({ sessions: [], students: [], missing: [], exceptions: [], recomputes: [], summary: {} });
  const [res, setRes] = useState<any>({ availabilities: [], stock: [] });
  const { show, node } = useToast();

  const load = () =>
    api(`/api/makeup${planId ? `?plan_id=${planId}${classId ? `&class_id=${classId}` : ''}` : ''}`).then(setD);

  useEffect(() => {
    api('/api/auth/me').then((x) => setMe(x.user));
    api('/api/plans').then((x) => { setPlans(x.plans); if (!planId && x.plans[0]) setPlanId(String(x.plans[0].id)); });
    api('/api/classes').then((x) => setClasses(x.classes)).catch(() => {});
    api('/api/makeup/resources').then(setRes).catch(() => {});
  }, []);
  useEffect(() => { if (planId) load(); }, [planId, classId]);

  const isStaff = ['head_teacher', 'general_affairs', 'admin'].includes(me?.role);
  const isGA = ['general_affairs', 'admin'].includes(me?.role);
  const isSupplier = ['supplier', 'factory'].includes(me?.role);

  const planClasses = useMemo(() => classes, [classes]);

  async function gen() {
    try {
      const r = await api('/api/makeup', { method: 'POST', body: JSON.stringify({ action: 'generate', plan_id: Number(planId), class_id: classId || undefined }) });
      show(`生成候选 ${r.created.length} 个${r.blocked.length ? `，${r.blocked.length} 个班因样衣/空闲不足受阻（已入异常台账）` : ''}`);
      load();
    } catch (e: any) { show(e.message, true); }
  }
  async function sweep() {
    try {
      const r = await api('/api/makeup', { method: 'POST', body: JSON.stringify({ action: 'sweep', plan_id: planId ? Number(planId) : undefined }) });
      show(`巡检：补测逾期 ${r.overdue_sessions} 场，家长超时 ${r.parent_timeouts} 人`);
      load();
    } catch (e: any) { show(e.message, true); }
  }

  const tabs = [
    ['sessions', '补测候选/场次'], ['students', '补测学生'], ['exceptions', '异常台账'],
    ['recompute', '班级数量重算'], ...(isStaff || isSupplier ? [['resources', '样衣与空闲']] : []),
  ] as const;

  return (
    <div>
      {node}
      <div className="spread">
        <h2>集中试穿漏测 · 补测与生产锁定</h2>
        <div className="row">
          {(isStaff || isSupplier) && <button className="btn gray sm" onClick={sweep}>逾期巡检</button>}
          {isStaff && <button className="btn sm" onClick={gen}>生成补测候选时段</button>}
        </div>
      </div>
      <p className="muted">
        多名学生请假漏测时，系统按<b>班级 / 校区 / 供应商可用尺码样衣 / 班主任空闲</b>生成候选时段；多班竞争按
        <b>生产截止日、是否首次订购、已确认人数</b>排优先级。补测前家长只能提交<b>参考尺码</b>（风险占位，不计正式数量）；
        班主任、家长<b>两次确认一致</b>才锁定生产，不一致进入待复核。
      </p>

      <div className="grid grid-4">
        <div className="stat"><div className="num">{d.summary?.risk ?? 0}</div><div className="lbl">风险占位（不计正式数量）</div></div>
        <div className="stat"><div className="num">{d.summary?.review ?? 0}</div><div className="lbl">两次确认不一致·待复核</div></div>
        <div className="stat"><div className="num">{d.summary?.prelocked ?? 0}</div><div className="lbl">总务按参考预锁</div></div>
        <div className="stat"><div className="num" style={{ color: 'var(--red)' }}>{d.summary?.openExceptions ?? 0}</div><div className="lbl">未闭环异常</div></div>
      </div>

      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">全部班级</option>
          {planClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="row" style={{ gap: 4, marginLeft: 8 }}>
          {tabs.map(([k, l]) => (
            <button key={k} className="tag-chip" style={{
              border: 'none', cursor: 'pointer', padding: '4px 12px',
              background: tab === k ? 'var(--brand)' : 'var(--gray-bg)',
              color: tab === k ? '#fff' : 'var(--ink)',
            }} onClick={() => setTab(k as any)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'sessions' && <SessionsTab rows={d.sessions} blocked={d.missing} me={me} reload={load} show={show} />}
      {tab === 'students' && <StudentsTab rows={d.students} me={me} reload={load} show={show} />}
      {tab === 'exceptions' && <ExceptionsTab rows={d.exceptions} me={me} reload={load} show={show} />}
      {tab === 'recompute' && <RecomputeTab rows={d.recomputes} classes={classes} />}
      {tab === 'resources' && <ResourcesTab me={me} classes={classes} data={res} reload={() => api('/api/makeup/resources').then(setRes)} show={show} plans={plans} planId={planId} />}
    </div>
  );
}

function SessionsTab({ rows, blocked, me, reload, show }: any) {
  const [adj, setAdj] = useState<any>(null);
  const isStaff = ['head_teacher', 'general_affairs', 'admin'].includes(me?.role);
  return (
    <div className="card">
      <table>
        <thead><tr><th>优先级</th><th>班级</th><th>校区</th><th>候选/排期时间</th><th>地点</th><th>班主任</th><th>样衣占用</th><th>进度</th><th>状态</th><th>人工调整</th><th></th></tr></thead>
        <tbody>
          {rows.map((s: any) => (
            <tr key={s.id}>
              <td><b>{s.priority_score}</b></td><td>{s.class_name}</td><td>{s.campus_name}</td>
              <td className="mono" style={{ fontSize: 11 }}>{s.start_time}<br />~ {s.end_time}</td>
              <td>{s.location}</td><td>{s.teacher_name}</td>
              <td className="mono" style={{ fontSize: 11 }}>{s.sample_holds || '—'}</td>
              <td>{s.closed_cnt}/{s.student_cnt}</td>
              <td><Badge status={s.status} /></td>
              <td className="muted" style={{ fontSize: 11, maxWidth: 180 }}>{s.adjust_reason || '—'}</td>
              <td className="row" style={{ gap: 4 }}>
                <Link className="btn secondary sm" href={`/makeup/${s.id}`}>进入 ›</Link>
                {isStaff && s.status === 'candidate' && (
                  <button className="btn sm" onClick={async () => {
                    try {
                      await api(`/api/makeup/${s.id}`, { method: 'POST', body: JSON.stringify({ action: 'schedule' }) });
                      show('已确认排期'); reload();
                    } catch (e: any) { show(e.message, true); }
                  }}>确认排期</button>
                )}
                {isStaff && ['candidate', 'scheduled'].includes(s.status) &&
                  <button className="btn gray sm" onClick={() => setAdj(s)}>人工调整</button>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={11} className="empty">暂无候选场次，点击右上角“生成补测候选时段”</td></tr>}
        </tbody>
      </table>
      {blocked?.length > 0 && (
        <p className="muted" style={{ marginTop: 8 }}>尚有 {blocked.length} 名漏测学生未纳入候选（生成时自动建档并置风险占位）。</p>
      )}
      {adj && <AdjustModal s={adj} onClose={() => setAdj(null)} onDone={() => { setAdj(null); reload(); }} show={show} />}
    </div>
  );
}

function AdjustModal({ s, onClose, onDone, show }: any) {
  const [f, setF] = useState({ start_time: s.start_time, end_time: s.end_time, location: s.location, adjust_reason: '' });
  return (
    <Modal title={`人工调整 · ${s.class_name} 补测`} onClose={onClose}>
      <div className="grid grid-2">
        <div className="field"><label>开始时间</label><input value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></div>
        <div className="field"><label>结束时间</label><input value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></div>
      </div>
      <div className="field"><label>地点</label><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
      <div className="field"><label>调整原因（必填留痕）</label><textarea rows={2} value={f.adjust_reason} onChange={(e) => setF({ ...f, adjust_reason: e.target.value })} /></div>
      <div style={{ textAlign: 'right' }}>
        <button className="btn" onClick={async () => {
          try { await api(`/api/makeup/${s.id}`, { method: 'PATCH', body: JSON.stringify({ ...f, id: s.id }) }); show('已调整'); onDone(); }
          catch (e: any) { show(e.message, true); }
        }}>保存调整</button>
      </div>
    </Modal>
  );
}

function StudentsTab({ rows, me, reload, show }: any) {
  const [refFor, setRefFor] = useState<any>(null);
  const [confFor, setConfFor] = useState<any>(null);
  const [gaFor, setGaFor] = useState<any>(null);
  const [reviewFor, setReviewFor] = useState<any>(null);
  const isGA = ['general_affairs', 'admin'].includes(me?.role);
  return (
    <div className="card">
      <table>
        <thead><tr>
          <th>学生</th><th>班级</th><th>订单</th><th>生产锁</th><th>参考尺码(家长)</th><th>实测尺码(补测)</th>
          <th>班主任确认</th><th>家长确认</th><th>状态</th><th>总务决定</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((m: any) => (
            <tr key={m.id}>
              <td>{m.student_name}<div className="muted" style={{ fontSize: 11 }}>{m.student_no}{m.is_first_order ? ' · 首次订购' : ''}</div></td>
              <td>{m.class_name}</td><td className="mono" style={{ fontSize: 11 }}>{m.order_no}</td>
              <td><Badge status={m.size_lock} /></td>
              <td style={{ fontSize: 11 }}>
                <SizeRow readonly value={{ top: m.ref_size_top, pants: m.ref_size_pants, skirt: m.ref_size_skirt, coat: m.ref_size_coat, shoes: m.ref_size_shoes }} />
              </td>
              <td style={{ fontSize: 11 }}>
                <SizeRow readonly value={{ top: m.meas_size_top, pants: m.meas_size_pants, skirt: m.meas_size_skirt, coat: m.meas_size_coat, shoes: m.meas_size_shoes }} />
              </td>
              <td>{m.teacher_confirmed ? `✅ ${m.teacher_confirmed_at?.slice(0, 16)}` : '—'}</td>
              <td>{m.parent_confirmed ? `✅ ${m.parent_confirmed_at?.slice(0, 16)}` : (m.deadline ? `截止 ${m.deadline.slice(0, 16)}` : '—')}</td>
              <td><Badge status={m.status} /></td>
              <td className="muted" style={{ fontSize: 11, maxWidth: 170 }}>{m.ga_decision_reason || '—'}</td>
              <td className="row" style={{ gap: 4 }}>
                {me?.role === 'parent' && ['pending_ref', 'waiting', 'overdue', 'sample_shortage'].includes(m.status) &&
                  <button className="btn sm" onClick={() => setRefFor(m)}>提交参考尺码</button>}
                {me?.role === 'parent' && m.status === 'teacher_done' &&
                  <button className="btn sm" onClick={() => setConfFor(m)}>确认最终尺码</button>}
                {isGA && m.status === 'review' &&
                  <button className="btn secondary sm" onClick={() => setReviewFor(m)}>复核裁定</button>}
                {isGA && ['overdue', 'parent_timeout', 'sample_shortage', 'waiting', 'teacher_done', 'review', 'measured', 'pending_ref'].includes(m.status) &&
                  <button className="btn gray sm" onClick={() => setGaFor(m)}>预锁/延后</button>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={11} className="empty">暂无补测学生</td></tr>}
        </tbody>
      </table>
      {refFor && <RefModal m={refFor} onClose={() => setRefFor(null)} onDone={() => { setRefFor(null); reload(); }} show={show} />}
      {confFor && <ParentConfirmModal m={confFor} onClose={() => setConfFor(null)} onDone={() => { setConfFor(null); reload(); }} show={show} />}
      {gaFor && <GaModal m={gaFor} onClose={() => setGaFor(null)} onDone={() => { setGaFor(null); reload(); }} show={show} />}
      {reviewFor && <ReviewModal m={reviewFor} onClose={() => setReviewFor(null)} onDone={() => { setReviewFor(null); reload(); }} show={show} />}
    </div>
  );
}

function RefModal({ m, onClose, onDone, show }: any) {
  const [z, setZ] = useState({ top: m.ref_size_top || '', pants: m.ref_size_pants || '', skirt: m.ref_size_skirt || '', coat: m.ref_size_coat || '', shoes: m.ref_size_shoes || '' });
  return (
    <Modal title={`家长提交参考尺码 · ${m.student_name}`} onClose={onClose}>
      <p className="muted">补测前只能提交<b>参考尺码</b>，供应商生产计划将该生标为<b>风险占位</b>，不计入正式数量。</p>
      <SizeRow value={z} onChange={setZ} />
      <div style={{ textAlign: 'right', marginTop: 10 }}>
        <button className="btn" onClick={async () => {
          try { await api(`/api/makeup/students/${m.id}`, { method: 'POST', body: JSON.stringify({ action: 'submit_ref', sizes: z }) }); show('参考尺码已提交（风险占位）'); onDone(); }
          catch (e: any) { show(e.message, true); }
        }}>提交参考尺码</button>
      </div>
    </Modal>
  );
}

function ParentConfirmModal({ m, onClose, onDone, show }: any) {
  const meas = { top: m.meas_size_top || '', pants: m.meas_size_pants || '', skirt: m.meas_size_skirt || '', coat: m.meas_size_coat || '', shoes: m.meas_size_shoes || '' };
  const [z, setZ] = useState(meas);
  const same = JSON.stringify(z) === JSON.stringify(meas);
  return (
    <Modal title={`家长确认最终尺码 · ${m.student_name}`} onClose={onClose}>
      <p className="muted">班主任已确认实测记录。如与实测一致则正式锁定生产；<b style={{ color: 'var(--red)' }}>不一致订单将进入待复核，供应商不能锁定生产</b>。</p>
      <div style={{ marginBottom: 8 }}>班主任实测：<SizeRow readonly value={meas} /></div>
      <div>家长最终确认：<SizeRow value={z} onChange={setZ} /></div>
      <div style={{ textAlign: 'right', marginTop: 10 }}>
        <button className="btn" onClick={async () => {
          try { const r = await api(`/api/makeup/students/${m.id}`, { method: 'POST', body: JSON.stringify({ action: 'parent_confirm', sizes: z }) }); show(r.status === 'closed' ? '两次确认一致，已正式锁定' : '与班主任实测不一致，订单进入待复核'); onDone(); }
          catch (e: any) { show(e.message, true); }
        }}>{same ? '确认一致并锁定' : '确认（不一致，提交复核）'}</button>
      </div>
    </Modal>
  );
}

function GaModal({ m, onClose, onDone, show }: any) {
  const [decision, setDecision] = useState<'prelock' | 'postpone'>('prelock');
  const [reason, setReason] = useState('');
  return (
    <Modal title={`生产截止日决定 · ${m.student_name}`} onClose={onClose}>
      <div className="field"><label>决定</label>
        <select value={decision} onChange={(e) => setDecision(e.target.value as any)}>
          <option value="prelock">按家长参考尺码预锁（计入正式数量，标记预锁风险）</option>
          <option value="postpone">延后该学生（不计入本批生产）</option>
        </select>
      </div>
      <div className="field"><label>原因（留入学生订单与班级进度）</label><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div style={{ textAlign: 'right' }}>
        <button className="btn" onClick={async () => {
          try { await api(`/api/makeup/students/${m.id}`, { method: 'POST', body: JSON.stringify({ action: 'ga_decision', decision, reason }) });
            show(decision === 'prelock' ? '已按参考尺码预锁，系统重算班级数量/批次/到校承诺' : '已延后，系统重算班级数量'); onDone(); }
          catch (e: any) { show(e.message, true); }
        }}>提交决定并重算</button>
      </div>
    </Modal>
  );
}

function ReviewModal({ m, onClose, onDone, show }: any) {
  const [z, setZ] = useState({ top: m.meas_size_top || '', pants: m.meas_size_pants || '', skirt: m.meas_size_skirt || '', coat: m.meas_size_coat || '', shoes: m.meas_size_shoes || '' });
  const [reason, setReason] = useState('');
  return (
    <Modal title={`待复核裁定 · ${m.student_name}`} onClose={onClose}>
      <div className="field"><label>最终尺码（默认取班主任实测，可与家长重新对齐后调整）</label><SizeRow value={z} onChange={setZ} /></div>
      <div className="field"><label>裁定说明</label><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div style={{ textAlign: 'right' }}>
        <button className="btn" onClick={async () => {
          try { await api(`/api/makeup/students/${m.id}`, { method: 'POST', body: JSON.stringify({ action: 'review_resolve', sizes: z, reason }) }); show('已裁定并正式锁定'); onDone(); }
          catch (e: any) { show(e.message, true); }
        }}>裁定闭环</button>
      </div>
    </Modal>
  );
}

function ExceptionsTab({ rows, me, reload, show }: any) {
  const isStaff = ['general_affairs', 'admin', 'head_teacher', 'supplier'].includes(me?.role);
  const [forId, setForId] = useState<any>(null);
  const [note, setNote] = useState('');
  return (
    <div className="card">
      <table>
        <thead><tr><th>类型</th><th>计划</th><th>班级</th><th>学生</th><th>说明</th><th>状态</th><th>处理</th><th>时间</th></tr></thead>
        <tbody>
          {rows.map((e: any) => (
            <tr key={e.id}>
              <td><Badge status={e.type} /></td><td>{e.plan_name}</td><td>{e.class_name}</td><td>{e.student_name}</td>
              <td className="muted" style={{ fontSize: 12, maxWidth: 320 }}>{e.detail}</td>
              <td><Badge status={e.status === 'open' ? 'open_exc' : 'resolved_exc'} /></td>
              <td style={{ fontSize: 12 }}>{e.status === 'resolved' ? `${e.resolver_name || ''}：${e.resolution || ''}` : '—'}</td>
              <td className="mono" style={{ fontSize: 11 }}>{e.created_at}</td>
              <td>{e.status === 'open' && isStaff && <button className="btn sm" onClick={() => setForId(e.id)}>处理闭环</button>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={9} className="empty">暂无异常</td></tr>}
        </tbody>
      </table>
      {forId && (
        <Modal title="异常处理闭环" onClose={() => setForId(null)}>
          <div className="field"><label>处理说明</label><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn" onClick={async () => {
              try { await api('/api/makeup', { method: 'POST', body: JSON.stringify({ action: 'resolve_exception', id: forId, resolution: note || '已人工处理' }) }); show('异常已闭环'); setForId(null); reload(); }
              catch (e: any) { show(e.message, true); }
            }}>确认闭环</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RecomputeTab({ rows, classes }: any) {
  const cn = (id: number) => classes.find((c: any) => String(c.id) === String(id))?.name || `班级#${id}`;
  return (
    <div>
      {rows.map((r: any) => (
        <div className="card" key={r.class_id}>
          <h2>{cn(r.class_id)} · 数量/批次/到校承诺重算</h2>
          <div className="grid grid-4">
            <div className="stat"><div className="num">{r.formal_total}</div><div className="lbl">正式数量（已缴费+尺码锁定，不含风险占位/待复核）</div></div>
            <div className="stat"><div className="num">{r.formal_lines.reduce((a: number, l: any) => a + l.unallocated_qty, 0)}</div><div className="lbl">尚未分配批次数量</div></div>
            <div className="stat"><div className="num">{r.affected_batches.length}</div><div className="lbl">关联生产批次</div></div>
            <div className="stat"><div className="num" style={{ fontSize: 16 }}>{r.promised_arrival || '待定'}</div><div className="lbl">最晚到校承诺</div></div>
          </div>
          <table>
            <thead><tr><th>品类</th><th>部位</th><th>尺码</th><th>正式数量</th><th>已分配</th><th>未分配</th></tr></thead>
            <tbody>
              {r.formal_lines.map((l: any, i: number) => (
                <tr key={i}><td>{l.item_name}</td><td>{l.garment_type}</td><td><b>{l.size}</b></td>
                  <td>{l.formal_qty}</td><td>{l.allocated_qty}</td>
                  <td style={{ color: l.unallocated_qty ? 'var(--red)' : undefined }}>{l.unallocated_qty}</td></tr>
              ))}
            </tbody>
          </table>
          {r.risk_placeholders.length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              风险占位 {r.risk_placeholders.length} 人（不计正式数量）：
              {r.risk_placeholders.map((x: any) => `${x.student_name}[${x.size_lock}]`).join('、')}
            </p>
          )}
        </div>
      ))}
      {!rows.length && <div className="empty">暂无补测相关班级</div>}
    </div>
  );
}

function ResourcesTab({ me, data, reload, show, plans, planId }: any) {
  const isTeacher = me?.role === 'head_teacher';
  const isSupplier = me?.role === 'supplier';
  const [avail, setAvail] = useState({ start_time: '', end_time: '', note: '' });
  const [stock, setStock] = useState({ campus_id: '', size: '120', qty: 1 });
  const [campuses, setCampuses] = useState<any[]>([]);
  useEffect(() => { api('/api/campuses').then((x) => setCampuses(x.campuses)).catch(() => {}); }, []);
  return (
    <div className="grid grid-2">
      <div className="card">
        <h2>班主任空闲时间 {isTeacher ? '' : '（班主任维护）'}</h2>
        <table>
          <thead><tr><th>班主任</th><th>校区</th><th>起止</th><th>备注</th></tr></thead>
          <tbody>
            {data.availabilities.map((a: any) => (
              <tr key={a.id}><td>{a.teacher_name}</td><td>{a.campus_name}</td>
                <td className="mono" style={{ fontSize: 11 }}>{a.start_time} ~ {a.end_time}</td><td>{a.note}</td></tr>
            ))}
            {!data.availabilities.length && <tr><td colSpan={4} className="empty">暂无空闲时间</td></tr>}
          </tbody>
        </table>
        {(isTeacher || me?.role === 'general_affairs' || me?.role === 'admin') && (
          <div className="grid grid-2" style={{ marginTop: 8 }}>
            <div className="field"><label>开始</label><input placeholder="2026-10-12 15:00:00" value={avail.start_time} onChange={(e) => setAvail({ ...avail, start_time: e.target.value })} /></div>
            <div className="field"><label>结束</label><input placeholder="2026-10-12 17:00:00" value={avail.end_time} onChange={(e) => setAvail({ ...avail, end_time: e.target.value })} /></div>
          </div>
        )}
        {(isTeacher || me?.role === 'general_affairs' || me?.role === 'admin') && (
          <div className="field"><label>备注</label><input value={avail.note} onChange={(e) => setAvail({ ...avail, note: e.target.value })} /></div>
        )}
        {(isTeacher || me?.role === 'general_affairs' || me?.role === 'admin') && (
          <button className="btn sm" onClick={async () => {
            try { await api('/api/makeup/resources', { method: 'POST', body: JSON.stringify({ kind: 'availability', ...avail }) }); show('已登记空闲时间'); setAvail({ start_time: '', end_time: '', note: '' }); reload(); }
            catch (e: any) { show(e.message, true); }
          }}>登记空闲时间</button>
        )}
      </div>

      <div className="card">
        <h2>供应商可用尺码样衣库存（按校区）</h2>
        <table>
          <thead><tr><th>供应商</th><th>校区</th><th>尺码</th><th>可用件数</th></tr></thead>
          <tbody>
            {data.stock.map((s: any) => (
              <tr key={s.id}><td>{s.supplier_name}</td><td>{s.campus_name}</td><td><b>{s.size}</b></td><td>{s.qty}</td></tr>
            ))}
            {!data.stock.length && <tr><td colSpan={4} className="empty">暂无样衣库存</td></tr>}
          </tbody>
        </table>
        {(isSupplier || me?.role === 'general_affairs' || me?.role === 'admin') && (
          <div className="grid grid-3" style={{ marginTop: 8 }}>
            <div className="field"><label>校区</label>
              <select value={stock.campus_id} onChange={(e) => setStock({ ...stock, campus_id: e.target.value })}>
                <option value="">请选择</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>尺码</label><input value={stock.size} onChange={(e) => setStock({ ...stock, size: e.target.value })} /></div>
            <div className="field"><label>件数</label><input type="number" value={stock.qty} onChange={(e) => setStock({ ...stock, qty: Number(e.target.value) })} /></div>
          </div>
        )}
        {(isSupplier || me?.role === 'general_affairs' || me?.role === 'admin') && (
          <button className="btn sm" onClick={async () => {
            try { await api('/api/makeup/resources', { method: 'POST', body: JSON.stringify({ kind: 'stock', ...stock }) }); show('样衣库存已更新'); reload(); }
            catch (e: any) { show(e.message, true); }
          }}>更新样衣库存</button>
        )}
      </div>
    </div>
  );
}
