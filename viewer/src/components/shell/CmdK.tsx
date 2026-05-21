'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { IcSearch } from '../ui/icons';

const SEARCH_INDEX = [
  { kind: '페이지', label: '홈',         path: '/' },
  { kind: '페이지', label: '랭킹',       path: '/ranking' },
  { kind: '페이지', label: '이상탐지',   path: '/anomaly' },
  { kind: '페이지', label: '프로모션',   path: '/promo' },
  { kind: '페이지', label: '스냅샷',     path: '/snap' },
  { kind: '페이지', label: '매거진',     path: '/magazine' },
  { kind: '페이지', label: '리뷰',       path: '/reviews' },
  { kind: '페이지', label: '매핑',       path: '/admin/mapping' },
  { kind: '페이지', label: '설정',       path: '/settings' },
  { kind: '페이지', label: '마이페이지', path: '/me' },
  { kind: '회사', label: '코웰패션',           meta: '033290', path: '/company' },
  { kind: '회사', label: 'F&F',                meta: '383220', path: '/company' },
  { kind: '회사', label: 'LF',                 meta: '093050', path: '/company' },
  { kind: '회사', label: '신세계인터내셔날',   meta: '031430', path: '/company' },
  { kind: '회사', label: '한세실업',           meta: '105630', path: '/company' },
  { kind: '브랜드', label: '커버낫',           meta: '코웰패션',       path: '/brand' },
  { kind: '브랜드', label: '디스이즈네버댓',   meta: '제이씨네버댓',   path: '/brand' },
  { kind: '브랜드', label: '아디다스',         meta: '아디다스코리아', path: '/brand' },
  { kind: '브랜드', label: '나이키',           meta: '나이키코리아',   path: '/brand' },
  { kind: '브랜드', label: '널디',             meta: '에이피알',       path: '/brand' },
  { kind: '상품', label: '커버낫 시그니처 로고 스웻셔츠', meta: '#02 · 79,000', path: '/product' },
  { kind: '상품', label: '아디다스 트레포일 후디',         meta: '#01 · 79,000', path: '/product' },
  { kind: '상품', label: '널디 NY 베이직 후디',            meta: '#07 · 62,000', path: '/product' },
  { kind: '액션', label: '오늘의 이상탐지 HIGH 보기',       meta: '17건', path: '/anomaly' },
];

interface CmdKProps { open: boolean; onClose: () => void; }

export default function CmdK({ open, onClose }: CmdKProps) {
  const [query, setQuery] = React.useState('');
  const [kbdIdx, setKbdIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const router = useRouter();

  React.useEffect(() => {
    if (open) {
      setQuery(''); setKbdIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matched = q
    ? SEARCH_INDEX.filter(s => s.label.toLowerCase().includes(q) || (s.meta && s.meta.toLowerCase().includes(q)) || s.kind.toLowerCase().includes(q))
    : SEARCH_INDEX;

  const safeIdx = Math.min(kbdIdx, Math.max(0, matched.length - 1));

  const groups: Record<string, typeof SEARCH_INDEX> = {};
  matched.forEach(m => { if (!groups[m.kind]) groups[m.kind] = []; groups[m.kind].push(m); });

  const pick = (item: (typeof SEARCH_INDEX)[0]) => {
    router.push(item.path);
    onClose();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setKbdIdx(i => Math.min(matched.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setKbdIdx(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (matched[safeIdx]) pick(matched[safeIdx]); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <IcSearch />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setKbdIdx(0); }}
            onKeyDown={handleKey}
            placeholder="회사·브랜드·상품·페이지 검색"
          />
          <span className="kbd-hint">ESC 닫기</span>
        </div>

        <div className="cmdk-list">
          {matched.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--f4)' }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>no results</div>
              <div style={{ marginTop: 6, fontSize: 12 }}>"{query}"와 일치하는 항목이 없습니다</div>
            </div>
          ) : (
            Object.entries(groups).map(([kind, items]) => (
              <React.Fragment key={kind}>
                <div className="cmdk-grp">{kind}</div>
                {items.map((item) => {
                  const idx = matched.indexOf(item);
                  return (
                    <div key={item.label} className={`cmdk-item ${idx === safeIdx ? 'kbd' : ''}`}
                      onMouseEnter={() => setKbdIdx(idx)}
                      onClick={() => pick(item)}>
                      <span className="kind">{item.kind}</span>
                      <span className="title">{item.label}</span>
                      {item.meta && <span className="meta">{item.meta}</span>}
                    </div>
                  );
                })}
              </React.Fragment>
            ))
          )}
        </div>

        <div className="cmdk-foot">
          <span><span className="k">↑</span> <span className="k">↓</span> 탐색</span>
          <span><span className="k">↵</span> 선택</span>
          <span><span className="k">ESC</span> 닫기</span>
        </div>
      </div>
    </div>
  );
}
