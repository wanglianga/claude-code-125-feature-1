'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/fetch';
import { Badge, Modal, useToast, fmtMoney, GARMENT_LABELS } from '@/components/ui';

const CASE_TYPES = [['exchange', '换码'], ['resend', '补发'], ['refund', '退款'], ['complaint', '投诉']];
const CASE_REASONS: Record<string, [string, string][]> = {
  exchange: [['growth', '成长过快'], ['fitting_deviation', '试穿尺码与成衣偏差']],
  resend: [['factory_missing', '工厂漏发'], ['wrong_class_claim', '班级错领找不回']],
  refund: [['late_payment', '迟缴费取消'], ['allergy', '面料过敏退货'], ['other', '其他']],
  complaint: [['allergy', '面料过敏'], ['other', '其他']],
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const [d, setD] = useState<any>(null);
  const [caseFor, setCaseFor] = useState<any>(null);
  const { show, node } = useToast();
  const load = () => api(`/api/orders/${id}`).then(setD);
  useEffect(() => { load(); }, [id]);

  if (!d) return <div className="empty">加载中…</div>;
  const o = d.order;

  return (
    <div>
      {node}
      <div className="spread">
        <h2>订单 <span className="mono" style={{ fontSize: 14 }}>{o.order_no}</span></h2>
        <div className="row">
          <Badge status={o.status} />
          <Link className="btn gray sm" href="/orders">返回列表</Link>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="stat"><div className="num">{o.student_name}</div><div className="lbl">{o.student_no} · {o.class_name}</div></div>
        <div className="stat"><div className="num">{fmtMoney(o.due_amount)}</div><div className="lbl">应付（原价 {fmtMoney(o.payable_amount)}）{Number(o.subsidy_amount) > 0 && `，已减免 ${fmtMoney(o.subsidy_amount)}`}</div></div>
        <div className="stat"><div className="num">{fmtMoney(o.paid_amount)}</div><div className="lbl">已缴{o.paid_at ? ` · ${o.paid_at}` : ''}</div></div>
        <div className="stat"><div className="num">{o.plan_name}</div><div className="lbl">订购计划</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>学生尺码信息</h2>
          <p>
            身高 {o.height_cm || '-'}cm · 体重 {o.weight_kg || '-'}kg · 常穿 {o.usual_size || '-'}
            {o.special_fit ? ` · 特殊版型：${o.special_fit_note}` : ''}
          </p>
          {d.fitting ? (
            <div>
              <h3>试穿日工作人员建议</h3>
              <div className="pill-row">
                {[['上衣', d.fitting.size_top], ['裤子', d.fitting.size_pants], ['裙装', d.fitting.size_skirt], ['外套', d.fitting.size_coat], ['鞋码', d.fitting.size_shoes]].map(([l, v]) =>
                  <span key={l as string} className="tag-chip">{l}：{v as string || '—'}</span>)}
              </div>
              {d.fitting.special_note && <p className="muted" style={{ marginTop: 6 }}>备注：{d.fitting.special_note}</p>}
            </div>
          ) : <p className="muted">暂无试穿记录</p>}
        </div>

        <div className="card">
          <h2>全过程时间线（总务/老师/家长/供应商/工厂/售后围绕同一学生）</h2>
          <div className="timeline" style={{ maxHeight: 320, overflow: 'auto' }}>
            {d.logs.map((l: any) => (
              <div className="ev" key={l.id}>
                <div><b>{l.action}</b> <span className="muted">— {l.actor_name}（{l.actor_role}）</span></div>
                {l.detail && <div className="muted">{l.detail}</div>}
                <div className="t">{l.created_at}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>订单明细（同批校服追踪）</h2>
        <table>
          <thead><tr>
            <th>品类</th><th>部位</th><th>尺码</th><th>数量</th><th>单价</th>
            <th>生产批次</th><th>发货(发/到)</th><th>发放签收</th><th>售后</th>
          </tr></thead>
          <tbody>
            {d.items.map((it: any) => (
              <tr key={it.id}>
                <td>{it.name}{it.is_extra ? <span className="tag-chip">增购</span> : null}</td>
                <td>{GARMENT_LABELS[it.garment_type]}</td><td><b>{it.size}</b></td><td>{it.qty}</td><td>{fmtMoney(it.price)}</td>
                <td className="mono" style={{ fontSize: 11 }}>{it.batches || <span className="muted">未投产</span>}</td>
                <td className="mono" style={{ fontSize: 11 }}>{it.shipments || <span className="muted">—</span>}</td>
                <td className="mono" style={{ fontSize: 11 }}>{it.receipts || <span className="muted">—</span>}</td>
                <td>
                  <button className="btn secondary sm" onClick={() => setCaseFor(it)}>发起售后</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d.makeup && (
        <div className="card">
          <h2>集中试穿漏测 · 补测与生产锁定</h2>
          <div className="grid grid-4">
            <div className="stat"><div className="num"><Badge status={d.makeup.status} /></div><div className="lbl">补测状态{d.makeup.is_first_order ? ' · 首次订购' : ' · 非首次订购'}</div></div>
            <div className="stat"><div className="num">{d.makeup.production_lock && d.makeup.production_lock !== 'none' ? <Badge status={d.makeup.production_lock} /> : '未锁定'}</div><div className="lbl">生产锁定</div></div>
            <div className="stat"><div className="num" style={{ fontSize: 14 }}>{d.makeup.makeup_start || '未安排'}</div><div className="lbl">补测场 {d.makeup.makeup_location || ''}</div></div>
            <div className="stat"><div className="num" style={{ fontSize: 13 }}>{d.makeup.mismatch ? '两次确认不一致' : (d.makeup.f_confirmed_at ? '两次确认一致' : '待确认')}</div><div className="lbl">家长/班主任确认</div></div>
          </div>
          <table>
            <thead><tr><th>环节</th><th>上衣</th><th>裤子</th><th>裙装</th><th>外套</th><th>鞋码</th><th>时间/说明</th></tr></thead>
            <tbody>
              <tr><td>家长参考尺码（风险占位）</td>
                <td>{d.makeup.ref_size_top || '—'}</td><td>{d.makeup.ref_size_pants || '—'}</td><td>{d.makeup.ref_size_skirt || '—'}</td>
                <td>{d.makeup.ref_size_coat || '—'}</td><td>{d.makeup.ref_size_shoes || '—'}</td>
                <td className="muted">{d.makeup.ref_submitted_at || ''}</td></tr>
              <tr><td>班主任测量并确认</td>
                <td>{d.makeup.m_size_top || '—'}</td><td>{d.makeup.m_size_pants || '—'}</td><td>{d.makeup.m_size_skirt || '—'}</td>
                <td>{d.makeup.m_size_coat || '—'}</td><td>{d.makeup.m_size_shoes || '—'}</td>
                <td className="muted">{d.makeup.m_confirmed_at || (d.makeup.m_recorded_at ? '已录入待确认' : '')}</td></tr>
              <tr><td>家长最终确认</td>
                <td>{d.makeup.f_size_top || '—'}</td><td>{d.makeup.f_size_pants || '—'}</td><td>{d.makeup.f_size_skirt || '—'}</td>
                <td>{d.makeup.f_size_coat || '—'}</td><td>{d.makeup.f_size_shoes || '—'}</td>
                <td className="muted">{d.makeup.f_confirmed_at || ''}{d.makeup.decision_reason ? `｜裁决：${d.makeup.decision_reason}` : ''}</td></tr>
            </tbody>
          </table>
          {d.mkDecisions?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <h3>总务处置与影响留痕</h3>
              {d.mkDecisions.map((md: any) => (
                <div key={md.id} className="ev">
                  <div><b>{md.decision === 'prelock' ? '按参考尺码预锁' : md.decision === 'defer' ? '延后' : '复核裁决'}（{md.decider_name}）</b></div>
                  <div className="muted">原因：{md.reason}</div>
                  {md.impact && <div className="muted">影响：{md.impact}</div>}
                  <div className="t">{md.decided_at}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}><Link className="btn secondary sm" href="/makeup">前往集中补测处理 ›</Link></div>
        </div>
      )}

      <div className="card">
        <h2>关联售后工单</h2>
        {d.cases.length ? (
          <table>
            <thead><tr><th>工单号</th><th>类型</th><th>原因</th><th>状态</th><th>描述</th><th></th></tr></thead>
            <tbody>
              {d.cases.map((c: any) => (
                <tr key={c.id}>
                  <td className="mono">{c.case_no}</td><td>{CASE_TYPES.find((x) => x[0] === c.type)?.[1]}</td>
                  <td>{c.reason}</td><td><Badge status={c.status} /></td><td>{c.description}</td>
                  <td><Link className="btn gray sm" href={`/cases/${c.id}`}>处理 ›</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">暂无售后工单</div>}
      </div>

      {caseFor && <CaseModal order={o} item={caseFor} onClose={() => setCaseFor(null)} onDone={() => { setCaseFor(null); show('售后工单已创建'); load(); }} />}
    </div>
  );
}

function CaseModal({ order, item, onClose, onDone }: { order: any; item: any; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState('exchange');
  const reasons = CASE_REASONS[type] || [];
  const [reason, setReason] = useState(reasons[0]?.[0] || 'other');
  const [desc, setDesc] = useState('');
  const [priority, setPriority] = useState('normal');
  const { show, node } = useToast();

  useEffect(() => { setReason(CASE_REASONS[type]?.[0]?.[0] || 'other'); }, [type]);

  async function submit() {
    try {
      await api('/api/cases', {
        method: 'POST',
        body: JSON.stringify({
          student_id: order.student_id, order_id: order.id,
          order_item_id: ['exchange', 'resend'].includes(type) ? item.id : null,
          type, reason, description: desc, priority,
        }),
      });
      onDone();
    } catch (e: any) { show(e.message, true); }
  }

  return (
    <Modal title={`发起售后 · ${item.name}（${item.size}）`} onClose={onClose}>
      {node}
      <div className="grid grid-2">
        <div className="field"><label>售后类型</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {CASE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field"><label>原因</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {reasons.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>优先级（换码高峰/过敏等可置高）</label>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="normal">普通</option><option value="high">高优先</option>
        </select>
      </div>
      <div className="field"><label>情况描述</label><textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <div style={{ textAlign: 'right' }}><button className="btn" onClick={submit}>提交工单</button></div>
    </Modal>
  );
}
