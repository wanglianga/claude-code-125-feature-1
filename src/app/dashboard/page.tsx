'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/fetch';
import { Badge, fmtMoney } from '@/components/ui';

export default function DashboardPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [planId, setPlanId] = useState('');
  const [data, setData] = useState<any>({ students: [], classes: [] });

  useEffect(() => { api('/api/plans').then((d) => setPlans(d.plans)); }, []);
  useEffect(() => { api(`/api/dashboard/progress${planId ? `?plan_id=${planId}` : ''}`).then(setData); }, [planId]);

  const s = data.students || [];
  const totals = s.reduce((a: any, x: any) => ({
    orders: a.orders + Number(x.order_count),
    paid: a.paid + Number(x.paid_cnt),
    pending: a.pending + Number(x.unpaid_cnt) + Number(x.hold_cnt),
    due: a.due + Number(x.due_total),
    paidAmt: a.paidAmt + Number(x.paid_total),
    cases: a.cases + Number(x.open_cases),
  }), { orders: 0, paid: 0, pending: 0, due: 0, paidAmt: 0, cases: 0 });

  return (
    <div>
      <div className="spread">
        <h2 style={{ margin: '4px 0 14px' }}>全校进度看板</h2>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">全部订购计划</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="grid grid-4">
        <div className="stat"><div className="num">{totals.orders}</div><div className="lbl">订单总数</div></div>
        <div className="stat"><div className="num" style={{ color: 'var(--green)' }}>{totals.paid}</div><div className="lbl">已缴费 / {totals.pending} 待处理</div></div>
        <div className="stat"><div className="num">{fmtMoney(totals.paidAmt)}</div><div className="lbl">已缴金额 / 应收 {fmtMoney(totals.due)}</div></div>
        <div className="stat"><div className="num" style={{ color: totals.cases ? 'var(--red)' : undefined }}>{totals.cases}</div><div className="lbl">未闭环售后工单</div></div>
      </div>

      <div className="card">
        <h2>按班级汇总（缴费 · 试穿）</h2>
        <table>
          <thead><tr><th>校区</th><th>年级</th><th>班级</th><th>学生数</th><th>订单数</th><th>已缴费</th><th>待缴费/挂起</th><th>已试穿人数</th><th>补测未闭环/异常</th></tr></thead>
          <tbody>
            {data.classes?.map((c: any) => (
              <tr key={c.id}>
                <td>{c.campus_name}</td><td>{c.grade_name}</td><td>{c.class_name}</td>
                <td>{c.students}</td><td>{c.orders}</td>
                <td><Badge status="paid" /> {c.paid_cnt}</td>
                <td>{Number(c.pending_cnt) > 0 ? <span style={{ color: 'var(--amber)' }}>{c.pending_cnt}</span> : 0}</td>
                <td>{c.fitted_students}</td>
                <td>{Number(c.makeup_open) > 0 || Number(c.makeup_exc) > 0
                  ? <span style={{ color: 'var(--red)' }}>补测 {c.makeup_open} · 异常 {c.makeup_exc}</span>
                  : (Number(c.makeup_closed) > 0 ? <span style={{ color: 'var(--green)' }}>已闭环 {c.makeup_closed}</span> : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>按学生追踪（缴费 · 试穿 · 生产 · 发放 · 售后）</h2>
        <table>
          <thead><tr>
            <th>学号</th><th>学生</th><th>班级</th><th>在校状态</th><th>订单</th>
            <th>缴费</th><th>试穿</th><th>补测/生产锁定</th><th>已投产(件)</th><th>已签收(件)</th><th>进行中售后</th>
          </tr></thead>
          <tbody>
            {s.map((x: any) => (
              <tr key={x.id}>
                <td className="mono">{x.student_no}</td>
                <td>{x.name}</td><td>{x.campus_name} {x.class_name}</td>
                <td><Badge status={x.student_status} /></td>
                <td>{x.order_count}</td>
                <td>
                  {x.paid_cnt > 0 && <Badge status="paid" />}{' '}
                  {x.unpaid_cnt > 0 && <span title="待缴费"><Badge status="confirmed" /></span>}{' '}
                  {x.hold_cnt > 0 && <Badge status="hold" />}{' '}
                  {x.draft_cnt > 0 && <Badge status="draft" />}{' '}
                  {x.cancelled_cnt > 0 && <Badge status="cancelled" />}
                </td>
                <td>{x.fitted > 0 ? <Badge status="approved" /> : <span className="muted">未试穿</span>}</td>
                <td>
                  {x.makeup_status
                    ? <span title={`生产锁定：${x.production_lock || 'none'}`}><Badge status={x.makeup_status} /></span>
                    : <span className="muted">—</span>}
                </td>
                <td>{x.producing_qty}</td>
                <td>{x.signed_qty}</td>
                <td>{x.open_cases > 0 ? <Badge status="open" /> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
