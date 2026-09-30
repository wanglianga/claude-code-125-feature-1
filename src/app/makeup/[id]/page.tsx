'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/fetch';
import { Badge, useToast } from '@/components/ui';

const SIZES = ['', '110', '120', '130', '140', '150', '160', '170', '175', '180'];
const SHOES = ['', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40'];
const COLS = [['top', '上衣'], ['pants', '裤'], ['skirt', '裙'], ['coat', '外套'], ['shoes', '鞋码']] as const;

export default function MakeupSessionPage() {
  const { id } = useParams();
  const [me, setMe] = useState<any>(null);
  const [d, setD] = useState<any>(null);
  const [meas, setMeas] = useState<Record<number, any>>({});
  const [pick, setPick] = useState<Record<number, boolean>>({});
  const [deadline, setDeadline] = useState('');
  const { show, node } = useToast();

  const load = () => api(`/api/makeup/${id}`).then((res) => {
    setD(res);
    const m: any = {};
    for (const s of res.students) {
      m[s.id] = {
        top: s.meas_size_top || s.ref_size_top || '',
        pants: s.meas_size_pants || s.ref_size_pants || '',
        skirt: s.meas_size_skirt || s.ref_size_skirt || '',
        coat: s.meas_size_coat || s.ref_size_coat || '',
        shoes: s.meas_size_shoes || s.ref_size_shoes || '',
      };
    }
    setMeas(m);
  });
  useEffect(() => { api('/api/auth/me').then((x) => setMe(x.user)); load(); }, [id]);

  if (!d) return <div className="empty">加载中…</div>;
  const ms = d.session;
  const isStaff = ['head_teacher', 'general_affairs', 'admin'].includes(me?.role);

  async function record(sid: number) {
    try {
      await api(`/api/makeup/${id}`, { method: 'POST', body: JSON.stringify({ action: 'record', student_id: sid, sizes: meas[sid] }) });
      show('实测尺码已登记'); load();
    } catch (e: any) { show(e.message, true); }
  }
  async function teacherConfirm() {
    const ids = Object.entries(pick).filter(([, v]) => v).map(([k]) => Number(k));
    if (!ids.length) return show('请勾选已测待确认的学生', true);
    try {
      const r = await api(`/api/makeup/${id}`, { method: 'POST', body: JSON.stringify({ action: 'teacher_confirm', student_ids: ids, deadline: deadline || undefined }) });
      show(`班主任已确认 ${r.confirmed} 名学生，等待家长在 ${r.deadline} 前确认`); load();
    } catch (e: any) { show(e.message, true); }
  }
  async function complete() {
    try { await api(`/api/makeup/${id}`, { method: 'POST', body: JSON.stringify({ action: 'complete' }) }); show('补测场次完成，样衣归还'); load(); }
    catch (e: any) { show(e.message, true); }
  }

  return (
    <div>
      {node}
      <div className="spread">
        <h2>补测场次 · {ms.class_name} <Badge status={ms.status} /></h2>
        <Link className="btn gray sm" href="/makeup">返回</Link>
      </div>
      <p className="muted">
        {ms.campus_name} · {ms.start_time} ~ {ms.end_time} · {ms.location} · 班主任 {ms.teacher_name} ·
        竞争优先级 <b>{ms.priority_score}</b>{ms.adjust_reason ? <> · 人工调整留痕：{ms.adjust_reason}</> : null}
      </p>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>样衣占用</h2>
        <div className="pill-row">
          {d.reservations.map((r: any) => (
            <span key={r.id} className="tag-chip">尺码 {r.size} × {r.qty}（{r.status === 'reserved' ? '占用中' : '已归还'}）</span>
          ))}
          {!d.reservations.length && <span className="muted">无</span>}
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="spread">
          <h2>补测登记与班主任确认</h2>
          {isStaff && ms.status !== 'completed' && (
            <div className="row">
              <input placeholder="家长确认截止，如 2026-10-16 18:00:00" value={deadline}
                onChange={(e) => setDeadline(e.target.value)} style={{ width: 240 }} />
              <button className="btn secondary sm" onClick={teacherConfirm}>班主任确认勾选学生</button>
              <button className="btn gray sm" onClick={complete}>完成场次并归还样衣</button>
            </div>
          )}
        </div>
        <table>
          <thead><tr>
            <th></th><th>学号</th><th>姓名</th><th>参考尺码(家长)</th>
            {COLS.map(([, l]) => <th key={l}>{l}实测</th>)}
            <th>状态</th><th>双确认</th><th></th>
          </tr></thead>
          <tbody>
            {d.students.map((s: any) => {
              const z = meas[s.id] || {};
              return (
                <tr key={s.id}>
                  <td>{isStaff && s.status === 'measured' && <input type="checkbox" checked={!!pick[s.id]} onChange={(e) => setPick({ ...pick, [s.id]: e.target.checked })} />}</td>
                  <td className="mono">{s.student_no}</td><td>{s.student_name}{s.is_first_order ? <span className="tag-chip">首次订购</span> : null}</td>
                  <td style={{ fontSize: 11 }}>
                    上{s.ref_size_top || '-'} 裤{s.ref_size_pants || '-'} 裙{s.ref_size_skirt || '-'} 外{s.ref_size_coat || '-'} 鞋{s.ref_size_shoes || '-'}
                  </td>
                  {COLS.map(([k]) => (
                    <td key={k}>
                      <select style={{ width: 66 }} value={z[k] || ''} disabled={!isStaff}
                        onChange={(e) => setMeas({ ...meas, [s.id]: { ...z, [k]: e.target.value } })}>
                        {(k === 'shoes' ? SHOES : SIZES).map((x) => <option key={x} value={x}>{x || '—'}</option>)}
                      </select>
                    </td>
                  ))}
                  <td><Badge status={s.status} /></td>
                  <td style={{ fontSize: 11 }}>
                    班主任 {s.teacher_confirmed ? '✅' : '—'}<br />家长 {s.parent_confirmed ? '✅' : '—'}
                  </td>
                  <td>{isStaff && ['waiting', 'overdue', 'sample_shortage', 'measured', 'teacher_done', 'review'].includes(s.status) &&
                    <button className="btn sm" onClick={() => record(s.id)}>{s.measured_at ? '更新实测' : '登记实测'}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 8 }}>
          流程：家长先在“漏测补测-补测学生”提交参考尺码（风险占位）→ 本场登记实测 → 班主任确认测量记录 →
          家长确认最终尺码（一致锁定 / 不一致待复核）。
        </p>
      </div>
    </div>
  );
}
