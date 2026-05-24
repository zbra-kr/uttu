'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { NotificationInbox, fetchInbox, markRead, markAllRead } from '@/lib/queries-me';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return '방금';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}일 전`;
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  limit?: number;
  compact?: boolean;
  onUnreadChange?: (n: number) => void;
}

export default function InboxList({ limit = 30, compact = false, onUnreadChange }: Props) {
  const router = useRouter();
  const [items, setItems] = React.useState<NotificationInbox[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchInbox(limit).then(rows => {
      setItems(rows);
      setLoading(false);
      onUnreadChange?.(rows.filter(r => !r.read_at).length);
    });
    // onUnreadChange는 의도적으로 deps 제외 — 초기 로드 시 1회만 호출
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const handleClick = async (item: NotificationInbox) => {
    if (!item.read_at) {
      const nextItems = items.map(r => r.id === item.id ? { ...r, read_at: new Date().toISOString() } : r);
      setItems(nextItems);
      onUnreadChange?.(nextItems.filter(r => !r.read_at).length);
      await markRead(item.id);
    }
    if (item.link) router.push(item.link);
  };

  const handleMarkAll = async () => {
    const now = new Date().toISOString();
    const nextItems = items.map(r => ({ ...r, read_at: r.read_at ?? now }));
    setItems(nextItems);
    onUnreadChange?.(0);
    await markAllRead();
  };

  if (loading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--f4)', padding: compact ? '8px 12px' : '12px 0', textAlign: 'center' }}>
        불러오는 중…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--f4)', padding: compact ? '12px' : '12px 0', textAlign: 'center' }}>
        받은 알림이 없습니다.
      </div>
    );
  }

  const hasUnread = items.some(r => !r.read_at);
  const pad = compact ? '7px 12px' : '9px 6px';

  return (
    <div>
      {hasUnread && (
        <div style={{ textAlign: 'right', padding: compact ? '6px 12px' : '4px 0', borderBottom: '0.5px solid var(--bs)' }}>
          <button className="btn sm" onClick={handleMarkAll}>모두 읽음</button>
        </div>
      )}
      {items.map((item, i) => (
        <div
          key={item.id}
          onClick={() => handleClick(item)}
          style={{
            padding: pad,
            borderBottom: i < items.length - 1 ? '0.5px dashed var(--bs)' : 'none',
            background: item.read_at ? 'transparent' : 'var(--hs-soft)',
            cursor: 'pointer',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ width: 6, flexShrink: 0, paddingTop: 4, display: 'flex', justifyContent: 'center' }}>
            {!item.read_at && (
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--hs)' }} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: compact ? 12 : 12,
              fontWeight: item.read_at ? 400 : 500,
              color: 'var(--f1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {item.title}
            </div>
            {!compact && item.body && (
              <div style={{
                fontSize: 11,
                color: 'var(--f3)',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {item.body}
              </div>
            )}
          </div>
          <span className="mono dim" style={{ fontSize: 10, flexShrink: 0, marginTop: 2 }}>
            {relativeTime(item.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
