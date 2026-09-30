'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';
import { ROLE_LABELS, SessionUserT } from '@/lib/types';

const MENUS: { roles: string[]; href: string; label: string }[] = [
  { roles: ['general_affairs', 'admin', 'head_teacher', 'parent'], href: '/dashboard', label: '进度看板' },
  { roles: ['general_affairs', 'admin', 'parent'], href: '/plans', label: '订购计划' },
  { roles: ['general_affairs', 'admin', 'parent', 'head_teacher'], href: '/students', label: '学生与尺码' },
  { roles: ['head_teacher', 'general_affairs', 'admin'], href: '/fitting', label: '试穿日' },
  { roles: ['head_teacher', 'general_affairs', 'admin', 'parent', 'supplier', 'factory'], href: '/makeup', label: '集中补测' },
  { roles: ['general_affairs', 'admin', 'head_teacher', 'parent'], href: '/orders', label: '订单缴费' },
  { roles: ['supplier', 'factory', 'admin', 'general_affairs'], href: '/batches', label: '生产批次' },
  { roles: ['supplier', 'factory', 'admin', 'general_affairs'], href: '/production-blockers', label: '投产限制' },
  { roles: ['supplier', 'factory', 'general_affairs', 'admin'], href: '/shipments', label: '分批发货' },
  { roles: ['general_affairs', 'head_teacher', 'admin'], href: '/distributions', label: '分批发放' },
  { roles: ['general_affairs', 'admin', 'head_teacher', 'parent', 'supplier', 'factory', 'after_sales'], href: '/cases', label: '售后工单' },
  { roles: ['general_affairs', 'admin', 'supplier'], href: '/assessments', label: '供应商考核' },
];

export function Nav() {
  const [user, setUser] = useState<SessionUserT | null | undefined>(undefined);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => { api('/api/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null)); }, [pathname]);

  if (pathname === '/login') return null;
  if (!user) return null;
  const links = MENUS.filter((m) => m.roles.includes(user.role));
  return (
    <div style={{ background: '#fff', borderBottom: '1px solid var(--line)' }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 10, paddingBottom: 10, flexWrap: 'wrap' }}>
        <Link href="/dashboard" style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          🎽 校服协同平台
        </Link>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className="tag-chip"
              style={{
                color: pathname.startsWith(l.href) ? '#fff' : 'var(--ink)',
                background: pathname.startsWith(l.href) ? 'var(--brand)' : 'var(--gray-bg)',
                padding: '3px 10px', borderRadius: 5,
              }}>
              {l.label}
            </Link>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }} className="row">
          <span className="muted">{user.real_name}（{ROLE_LABELS[user.role]}）</span>
          <button className="btn gray sm" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); router.push('/login'); }}>退出</button>
        </div>
      </div>
    </div>
  );
}
