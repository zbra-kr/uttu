'use client';
import React from 'react';
import { SHELL_NAVIGATION, SHELL_GROUPS, shellAncestors, shellGroupsForPath, shellPathMatches } from '@/lib/shell-navigation';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { IcMore, IcChevL, IcChevR, IcChevD } from '../ui/icons';

const ROUTES = SHELL_NAVIGATION.filter(item => !item.sidebarHidden);
const GROUP_PARENTS = SHELL_GROUPS;

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  theme: string;
  navCounts?: Record<string, number>;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Sidebar({ collapsed, onToggle, theme, navCounts = {} }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const [hovering, setHovering] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [user, setUser] = React.useState<{ name: string; email: string; initials: string; role: string; avatarUrl: string | null } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const isPeek  = collapsed && hovering;
  const show    = !collapsed || hovering;
  const isAdmin = user?.role === 'admin';

  // 로그인 유저 정보
  React.useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const email = data.user.email ?? '';
      const { data: profile } = await sb
        .from('profiles')
        .select('full_name, display_name, role, avatar_url')
        .eq('id', data.user.id)
        .single();
      const name = profile?.full_name || email.split('@')[0];
      setUser({ name, email, initials: getInitials(name), role: profile?.role ?? 'viewer', avatarUrl: profile?.avatar_url ?? null });
    });
  }, []);

  // 외부 클릭 시 메뉴 닫기
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await supabaseBrowser().auth.signOut();
    router.push('/login');
  };

  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => { setMounted(true); }, []);
  const isActive = (path: string) => mounted && shellPathMatches(pathname ?? '', path);
  React.useEffect(() => {
    setOpen(previous => new Set([...previous, ...shellGroupsForPath(pathname ?? '')]));
  }, [pathname]);

  const toggleGroup = (id: string) => {
    setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  return (
    <aside
      className={`sb${collapsed && !hovering ? ' collapsed' : ''}${isPeek ? ' peek' : ''}`}
      onMouseEnter={() => collapsed && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="sb-brand">
        {show && (
          <Link href="/" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <img
              src={theme === 'dark'
                ? '/images/uttu/svg/uttu-wordmark-white.svg'
                : '/images/uttu/svg/uttu-wordmark.svg'}
              alt="UTTU"
              style={{ height: 22, objectFit: 'contain', objectPosition: 'left' }}
            />
          </Link>
        )}
        <button
          className="toggle"
          onClick={onToggle}
          title={show ? '메뉴 접기' : '메뉴 펼치기'}
          style={{ marginLeft: show ? 'auto' : 0 }}
        >
          {collapsed ? <IcChevR /> : <IcChevL />}
        </button>
      </div>

      {show && <div className="sb-section">workspace</div>}
      <nav className="sb-nav">
        {ROUTES.map(r => {
          if (r.adminOnly && !isAdmin) return null;

          const isSub    = !!r.parent;
          const isParent = GROUP_PARENTS.has(r.id);
          const isOpen   = open.has(r.id);
          const isExt    = !!r.external;

          if (!shellAncestors(r.id).every(id => open.has(id))) return null;

          // 관리자 그룹 상단에 구분선
          const showDivider = r.id === 'admin' && show;

          return (
            <React.Fragment key={r.id}>
              {showDivider && (
                <div style={{ height: 1, background: 'var(--bd)', margin: '6px 10px' }} />
              )}
              <div style={{ position: 'relative' }}>
                {r.disclosure ? (
                  <button type="button" className="sb-item" aria-expanded={isOpen} aria-label={r.label}
                    title={!show ? r.label : undefined} onClick={() => toggleGroup(r.id)}
                    style={{ width: '100%', textAlign: 'left' }}>
                    <r.Icon size={16} />{show && <span>{r.label}</span>}
                    {show && <IcChevD size={12} style={{ marginLeft: 'auto', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />}
                  </button>
                ) : isExt ? (
                  <a
                    href={r.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sb-item"
                    title={!show ? r.label : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: show ? 8 : 0 }}
                  >
                    <r.Icon size={16} />
                    {show && <span>{r.label}</span>}
                  </a>
                ) : (
                  <Link
                    href={r.path}
                    className={`sb-item${isSub ? ' sub' : ''} ${isActive(r.path) ? 'active' : ''}`}
                    title={!show ? r.label : undefined}
                  >
                    <r.Icon size={isSub ? 13 : 16} />
                    {show && <span>{r.label}</span>}
                    {show && navCounts[r.id] ? <span className="num">{navCounts[r.id]}</span> : null}
                  </Link>
                )}
                {show && isParent && !r.disclosure && (
                  <button
                    type="button"
                    className="sb-toggle"
                    aria-label={`${r.label} 하위 메뉴`}
                    aria-expanded={isOpen}
                    onClick={e => { e.preventDefault(); toggleGroup(r.id); }}
                    title={isOpen ? '접기' : '펼치기'}
                  >
                    <IcChevD size={12} style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms ease' }} />
                  </button>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </nav>

      {/* 하단 유저 영역 */}
      <div ref={menuRef} style={{ position: 'relative', marginTop: 'auto' }}>

        {/* 드롭업 메뉴 */}
        {menuOpen && show && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
            background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 7,
            padding: 4, zIndex: 200,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
          }}>
            <Link
              href="/me"
              onClick={() => setMenuOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5, fontSize: 12, color: 'var(--f1)', textDecoration: 'none', transition: 'background 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              내 프로필
            </Link>
            <Link
              href="/me?tab=password"
              onClick={() => setMenuOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5, fontSize: 12, color: 'var(--f1)', textDecoration: 'none', transition: 'background 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              비밀번호 변경
            </Link>
            <div style={{ height: 1, background: 'var(--bd)', margin: '4px 6px' }} />
            <button
              onClick={handleSignOut}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5, fontSize: 12, color: 'var(--shf)', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 100ms', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--shb)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              로그아웃
            </button>
          </div>
        )}

        {/* 푸터 행 */}
        <div className={`sb-foot${mounted && pathname === '/me' ? ' active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: show ? 8 : 0 }}>
          <Link
            href="/me"
            onClick={() => setMenuOpen(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit', overflow: 'hidden' }}
            title={!show ? (user?.name ?? '내 프로필') : undefined}
          >
            <div className="avatar" style={{ flexShrink: 0, overflow: 'hidden', padding: user?.avatarUrl ? 0 : undefined }}>
              {user?.avatarUrl
                ? <img src={user.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : (user?.initials ?? '?')
              }
            </div>
            {show && (
              <div className="who" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <span className="n" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.name ?? '…'}
                </span>
                <span className="e" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.email ?? ''}
                </span>
              </div>
            )}
          </Link>
          {show && (
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
              title="메뉴"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: menuOpen ? 'var(--hs)' : 'var(--f4)', flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: 5, transition: 'color 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--f1)')}
              onMouseLeave={e => (e.currentTarget.style.color = menuOpen ? 'var(--hs)' : 'var(--f4)')}
            >
              <IcMore />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
