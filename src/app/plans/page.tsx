'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/fetch';
import { Badge, Modal, useToast, SUIT_LABELS } from '@/components/ui';

const GARMENT_TYPES = [['top', '上衣'], ['pants', '裤子'], ['skirt', '裙装'], ['coat', '外套'], ['shoes', '鞋']];
const SUIT_KINDS = [['season_set', '季节套装'], ['sportswear', '运动服'], ['formal', '礼服'], ['extra', '增购件']];

export default function PlansPage() {
  const [me, setMe] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [campuses, setCampuses] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [orderPlan, setOrderPlan] = useState<any>(null);
  const { show, node } = useToast();
  const [f, setF] = useState<any>({
    name: '', kind: 'annual', academic_year: '2026-2027', season: '春秋',
    supplier_id: '', order_deadline: '2026-11-15 18:00:00', production_deadline: '', fitting_date: '', note: '',
    campus_ids: [], grade_ids: [],
    items: [{ name: '', suit_kind: 'sportswear', garment_type: 'top', price: 100, required: 1 }],
  });

  const load = () => {
    api('/api/plans').then((d) => setPlans(d.plans));
    api('/api/auth/me').then((d) => setMe(d.user));
  };
  useEffect(() => {
    load();
    api('/api/suppliers').then((d) => setSuppliers(d.suppliers));
    api('/api/campuses').then((d) => setCampuses(d.campuses));
    api('/api/grades').then((d) => setGrades(d.grades));
    api('/api/students').then((d) => setStudents(d.students)).catch(() => {});
  }, []);

  const isGA = me && ['general_affairs', 'admin'].includes(me.role);
  const isParent = me?.role === 'parent';

  async function createPlan() {
    try {
      await api('/api/plans', { method: 'POST', body: JSON.stringify(f) });
      show('计划已创建'); setShowCreate(false); load();
    } catch (e: any) { show(e.message, true); }
  }

  async function setStatus(p: any, status: string) {
    await api('/api/plans', { method: 'PATCH', body: JSON.stringify({ id: p.id, status }) });
    show(`计划已${status === 'open' ? '开放订购' : status === 'closed' ? '关闭' : '转为草稿'}`); load();
  }

  return (
    <div>
      {node}
      <div className="spread">
        <h2>订购计划</h2>
        {isGA && <button className="btn" onClick={() => setShowCreate(true)}>＋ 新建订购计划</button>}
      </div>

      <div className="grid">
        {plans.map((p) => (
          <div className="card" key={p.id}>
            <div className="spread">
              <div>
                <Link href={`/plans/${p.id}`}><b style={{ fontSize: 15 }}>{p.name}</b></Link>{' '}
                <Badge status={p.kind === 'makeup' ? 'makeup' : 'annual'} /> <Badge status={p.status} />
              </div>
              <div className="row">
                <span className="muted">{p.academic_year} · {p.season} · {p.supplier_name}</span>
                <span className="tag-chip">覆盖：{p.campus_names}</span>
                <span className="tag-chip">{p.order_count} 个订单</span>
                {isGA && p.status === 'draft' && <button className="btn sm" onClick={() => setStatus(p, 'open')}>开放订购</button>}
                {isGA && p.status === 'open' && <button className="btn gray sm" onClick={() => setStatus(p, 'closed')}>关闭订购</button>}
                {isParent && p.status === 'open' && <button className="btn sm" onClick={() => setOrderPlan(p)}>家长下单</button>}
              </div>
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              订购截止：{p.order_deadline}　生产锁定截止：{p.production_deadline || '未设'}　试穿日：{p.fitting_date || '待定'}　{p.note}
            </div>
          </div>
        ))}
        {!plans.length && <div className="card empty">暂无订购计划</div>}
      </div>

      {showCreate && (
        <Modal title="新建订购计划（年度统一采购 / 毕业班补订）" onClose={() => setShowCreate(false)} wide>
          <div className="grid grid-2">
            <div className="field"><label>计划名称</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label>类型</label>
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="annual">年度统一采购</option><option value="makeup">毕业班补订</option>
              </select>
            </div>
            <div className="field"><label>学年</label><input value={f.academic_year} onChange={(e) => setF({ ...f, academic_year: e.target.value })} /></div>
            <div className="field"><label>季节</label><input value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} /></div>
            <div className="field"><label>供应商</label>
              <select value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: Number(e.target.value) })}>
                <option value="">请选择</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field"><label>订购截止时间</label><input value={f.order_deadline} onChange={(e) => setF({ ...f, order_deadline: e.target.value })} /></div>
            <div className="field"><label>班级生产锁定截止日</label><input placeholder="如 2026-11-10 18:00:00" value={f.production_deadline} onChange={(e) => setF({ ...f, production_deadline: e.target.value })} /></div>
            <div className="field"><label>试穿日期</label><input type="date" value={f.fitting_date || ''} onChange={(e) => setF({ ...f, fitting_date: e.target.value })} /></div>
            <div className="field"><label>说明</label><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          </div>
          <div className="field"><label>统一采购覆盖校区（多选）</label>
            <div className="pill-row">
              {campuses.map((c) => (
                <label key={c.id} style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'var(--ink)' }}>
                  <input type="checkbox" checked={f.campus_ids.includes(c.id)}
                    onChange={(e) => setF({ ...f, campus_ids: e.target.checked ? [...f.campus_ids, c.id] : f.campus_ids.filter((x: number) => x !== c.id) })} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <div className="field"><label>覆盖年级（多选）</label>
            <div className="pill-row">
              {grades.map((g) => (
                <label key={g.id} style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'var(--ink)' }}>
                  <input type="checkbox" checked={f.grade_ids.includes(g.id)}
                    onChange={(e) => setF({ ...f, grade_ids: e.target.checked ? [...f.grade_ids, g.id] : f.grade_ids.filter((x: number) => x !== g.id) })} />
                  {g.campus_name}-{g.name}
                </label>
              ))}
            </div>
          </div>
          <h3>计划品类（季节套装 / 运动服 / 礼服 / 增购件）</h3>
          {f.items.map((it: any, i: number) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <input style={{ width: 180 }} placeholder="品类名称" value={it.name}
                onChange={(e) => setF({ ...f, items: f.items.map((x: any, j: number) => j === i ? { ...x, name: e.target.value } : x) })} />
              <select value={it.suit_kind} onChange={(e) => setF({ ...f, items: f.items.map((x: any, j: number) => j === i ? { ...x, suit_kind: e.target.value } : x) })}>
                {SUIT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={it.garment_type} onChange={(e) => setF({ ...f, items: f.items.map((x: any, j: number) => j === i ? { ...x, garment_type: e.target.value } : x) })}>
                {GARMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input style={{ width: 90 }} type="number" placeholder="价格" value={it.price}
                onChange={(e) => setF({ ...f, items: f.items.map((x: any, j: number) => j === i ? { ...x, price: Number(e.target.value) } : x) })} />
              <label style={{ display: 'flex', gap: 3, alignItems: 'center', color: 'var(--ink)' }}>
                <input type="checkbox" checked={!!it.required}
                  onChange={(e) => setF({ ...f, items: f.items.map((x: any, j: number) => j === i ? { ...x, required: e.target.checked ? 1 : 0 } : x) })} />必购
              </label>
              <button className="btn gray sm" onClick={() => setF({ ...f, items: f.items.filter((_: any, j: number) => j !== i) })}>删</button>
            </div>
          ))}
          <button className="btn secondary sm" onClick={() => setF({ ...f, items: [...f.items, { name: '', suit_kind: 'extra', garment_type: 'top', price: 0, required: 0 }] })}>＋ 增加品类</button>
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <button className="btn" onClick={createPlan}>创建计划</button>
          </div>
        </Modal>
      )}

      {orderPlan && <OrderModal plan={orderPlan} students={students} onClose={() => setOrderPlan(null)} onDone={() => { setOrderPlan(null); show('订单已创建（草稿），请到“订单缴费”确认'); }} />}
    </div>
  );
}

function OrderModal({ plan, students, onClose, onDone }: { plan: any; students: any[]; onClose: () => void; onDone: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [studentId, setStudentId] = useState<number | ''>(students[0]?.id ?? '');
  const [lines, setLines] = useState<Record<number, any>>({});
  const [suggest, setSuggest] = useState<any>(null);
  const [note, setNote] = useState('');
  const { show, node } = useToast();

  useEffect(() => {
    api(`/api/plans/${plan.id}`).then((d) => {
      setDetail(d);
      const init: any = {};
      for (const it of d.items) init[it.id] = { chosen: !!it.required, size: '', qty: 1 };
      setLines(init);
    });
  }, [plan.id]);

  useEffect(() => {
    if (!studentId || !detail) return;
    api(`/api/plans/${plan.id}?student_id=${studentId}`).then((d) => {
      const sg = d.fittingSuggestions;
      setSuggest(sg);
      if (sg) {
        setLines((prev: any) => {
          const next = { ...prev };
          for (const it of d.items) {
            if (next[it.id] && sg[it.garment_type] && !next[it.id].size) {
              next[it.id] = { ...next[it.id], size: sg[it.garment_type] };
            }
          }
          return next;
        });
      }
    });
  }, [studentId, detail]);

  const student = students.find((s) => s.id === studentId);
  const total = detail?.items.reduce((a: number, it: any) => {
    const l = lines[it.id];
    return a + (l?.chosen ? it.price * (l.qty || 1) : 0);
  }, 0) ?? 0;

  async function submit() {
    const items = Object.entries(lines).filter(([, v]: any) => v.chosen).map(([pid, v]: any) => ({
      plan_item_id: Number(pid), size: v.size || 'M', qty: v.qty || 1,
    }));
    if (!items.length) return show('请至少选择一个品类', true);
    if (items.some((i) => !i.size)) return show('请为每个品类填写/确认尺码', true);
    try {
      await api('/api/orders', { method: 'POST', body: JSON.stringify({ plan_id: plan.id, student_id: studentId, items, note }) });
      onDone();
    } catch (e: any) { show(e.message, true); }
  }

  return (
    <Modal title={`家长下单 · ${plan.name}`} onClose={onClose} wide>
      {node}
      <div className="field"><label>选择学生</label>
        <select value={studentId} onChange={(e) => setStudentId(Number(e.target.value))}>
          {students.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.student_no} {s.name}（{s.class_name}）</option>)}
        </select>
      </div>
      {student && (
        <div className="muted" style={{ marginBottom: 8 }}>
          身高 {student.height_cm || '-'}cm　体重 {student.weight_kg || '-'}kg　常穿尺码 {student.usual_size || '-'}
          {student.special_fit ? `　特殊版型：${student.special_fit_note}` : ''}
          {suggest ? (
            <div style={{ marginTop: 4, color: 'var(--brand)' }}>
              ✅ 已自动带入试穿日工作人员建议：
              上衣{suggest.top || '-'} 裤子{suggest.pants || '-'} 裙{suggest.skirt || '-'} 外套{suggest.coat || '-'} 鞋{suggest.shoes || '-'}
              {suggest.note ? `（${suggest.note}）` : ''}
            </div>
          ) : <div style={{ marginTop: 4, color: 'var(--amber)' }}>⚠ 该生暂无本计划试穿记录，请家长谨慎填写</div>}
        </div>
      )}
      <table>
        <thead><tr><th>选</th><th>品类</th><th>类别</th><th>单价</th><th>尺码（参考试穿建议填写）</th><th>数量</th></tr></thead>
        <tbody>
          {detail?.items.map((it: any) => {
            const l = lines[it.id] || {};
            return (
              <tr key={it.id}>
                <td><input type="checkbox" checked={!!l.chosen}
                  onChange={(e) => setLines({ ...lines, [it.id]: { ...l, chosen: e.target.checked } })} /></td>
                <td>{it.name}</td>
                <td>{SUIT_LABELS[it.suit_kind]}</td>
                <td>¥{it.price}</td>
                <td><input style={{ width: 110 }} placeholder="如 140 / 34" value={l.size || ''}
                  onChange={(e) => setLines({ ...lines, [it.id]: { ...l, size: e.target.value } })} /></td>
                <td><input style={{ width: 70 }} type="number" min={1} value={l.qty || 1}
                  onChange={(e) => setLines({ ...lines, [it.id]: { ...l, qty: Number(e.target.value) } })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="spread" style={{ marginTop: 12 }}>
        <span className="muted">下单后为草稿，需“确认订单 → 缴费”后供应商才会投产（贫困生减免自动计算）</span>
        <b>合计 ¥{total.toFixed(2)}</b>
      </div>
      <div className="field" style={{ marginTop: 10 }}><label>家长备注</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div style={{ textAlign: 'right' }}><button className="btn" onClick={submit}>创建草稿订单</button></div>
    </Modal>
  );
}
