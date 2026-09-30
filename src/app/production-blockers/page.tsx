'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/fetch';
import { Badge, useToast } from '@/components/ui';

export default function ProductionBlockersPage() {
  const [blocked, setBlocked] = useState<any[]>([]);
  const [sizeBlocked, setSizeBlocked] = useState<any[]>([]);
  const [prelocked, setPrelocked] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  useEffect(() => {
    api('/api/dashboard/production-blockers').then((d) => {
      setBlocked(d.blocked); setSizeBlocked(d.size_blocked || []); setPrelocked(d.prelocked || []); setSummary(d.summary);
    });
  }, []);

  return (
    <div>
      <h2>供应商投产看板：哪些订单还不能进入生产</h2>
      <div className="grid grid-4">
        {summary.map((s: any) => (
          <div className="stat" key={`${s.status}-${s.size_lock}`}>
            <div className="num">{s.cnt}</div>
            <div className="lbl">{s.status} <Badge status={s.size_lock} /> · 共 {s.qty} 件</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>① 尺码未闭环：漏测风险占位 / 两次确认不一致待复核（不能锁定生产）</h2>
        <table>
          <thead><tr><th>订单号</th><th>学生</th><th>班级</th><th>计划</th><th>件数</th><th>锁状态</th><th>不能投产的原因</th></tr></thead>
          <tbody>
            {sizeBlocked.map((b: any) => (
              <tr key={b.id}>
                <td className="mono">{b.order_no}</td><td>{b.student_name}</td><td>{b.class_name}</td>
                <td>{b.plan_name}</td><td>{b.total_qty}</td><td><Badge status={b.size_lock} /></td>
                <td><span style={{ color: 'var(--red)' }}>⛔ {b.block_reason}</span></td>
              </tr>
            ))}
            {!sizeBlocked.length && <tr><td colSpan={7} className="empty">没有尺码未闭环的已缴费订单</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>② 缴费/状态阻塞明细与原因</h2>
        <table>
          <thead><tr><th>订单号</th><th>学生</th><th>班级</th><th>计划</th><th>件数</th><th>不能投产的原因</th></tr></thead>
          <tbody>
            {blocked.map((b: any) => (
              <tr key={b.id}>
                <td className="mono">{b.order_no}</td><td>{b.student_name}</td><td>{b.class_name}</td>
                <td>{b.plan_name}</td><td>{b.total_qty}</td>
                <td><span style={{ color: 'var(--red)' }}>⛔ {b.block_reason}</span></td>
              </tr>
            ))}
            {!blocked.length && <tr><td colSpan={6} className="empty">没有缴费/状态阻塞订单</td></tr>}
          </tbody>
        </table>
      </div>

      {prelocked.length > 0 && (
        <div className="card">
          <h2>③ 总务按参考尺码预锁（可投产，需知悉预锁风险）</h2>
          <table>
            <thead><tr><th>订单号</th><th>学生</th><th>班级</th><th>计划</th><th>件数</th></tr></thead>
            <tbody>
              {prelocked.map((b: any) => (
                <tr key={b.id}>
                  <td className="mono">{b.order_no}</td><td>{b.student_name}</td><td>{b.class_name}</td>
                  <td>{b.plan_name}</td><td>{b.total_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
