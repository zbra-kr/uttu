'use client';
import React from 'react';
import ReactDOM from 'react-dom';
import { MentionCandidate, searchMentionCandidates } from '@/lib/queries-me';

interface Props {
  query: string;
  onSelect: (candidate: MentionCandidate) => void;
  onClose: () => void;
  anchorRect?: DOMRect;
}

export default function MentionAutocomplete({ query, onSelect, onClose, anchorRect }: Props) {
  const [candidates, setCandidates] = React.useState<MentionCandidate[]>([]);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  React.useEffect(() => {
    setActiveIdx(0);
    if (!query) { setCandidates([]); return; }
    const timer = setTimeout(() => {
      setLoading(true);
      searchMentionCandidates(query).then(r => {
        setCandidates(r);
        setLoading(false);
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, candidates.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && candidates[activeIdx]) {
        e.preventDefault();
        onSelect(candidates[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [candidates, activeIdx, onSelect, onClose]);

  const posStyle: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        bottom: window.innerHeight - anchorRect.top + 4,
        left: anchorRect.left,
        width: Math.max(anchorRect.width, 260),
        zIndex: 9999,
      }
    : {
        position: 'fixed',
        bottom: 120,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 260,
        zIndex: 9999,
      };

  const panel = (
    <div
      style={{
        ...posStyle,
        background: 'var(--bg)',
        border: '0.5px solid var(--bd)',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        maxHeight: 220,
        overflowY: 'auto',
      }}
    >
      {loading && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--f4)' }}>검색 중…</div>
      )}
      {!loading && candidates.length === 0 && query.length > 0 && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--f4)' }}>일치하는 사용자 없음</div>
      )}
      {candidates.map((c, i) => (
        <div
          key={c.id}
          onMouseDown={e => { e.preventDefault(); onSelect(c); }}
          onMouseEnter={() => setActiveIdx(i)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            background: i === activeIdx ? 'var(--snk)' : 'transparent',
            borderBottom: i < candidates.length - 1 ? '0.5px solid var(--bs)' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {c.type === 'team' ? (
            <>
              <span style={{ fontSize: 13 }}>👥</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)' }}>
                  {c.display_name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--f4)', marginLeft: 6 }}>
                  {c.member_ids?.length ?? 0}명
                </span>
              </div>
              <span className="chip" style={{ fontSize: 10, color: 'var(--hs)' }}>팀 전체</span>
            </>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--f1)' }}>
                  {c.display_name ?? c.full_name}
                </span>
                {c.full_name && c.display_name && c.full_name !== c.display_name && (
                  <span style={{ fontSize: 11, color: 'var(--f3)', marginLeft: 6 }}>{c.full_name}</span>
                )}
              </div>
              {c.team && <span className="chip" style={{ fontSize: 10 }}>{c.team}</span>}
            </>
          )}
        </div>
      ))}
    </div>
  );

  if (!mounted) return null;
  return ReactDOM.createPortal(panel, document.body);
}
