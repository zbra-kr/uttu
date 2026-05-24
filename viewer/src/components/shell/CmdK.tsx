'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { IcSearch } from '../ui/icons';
import { searchCompanies, searchBrands, searchProducts } from '@/lib/queries';

// ── 한글 유사 모음 스왑 (양방향) ────────────────────────────────────────────
// ㅐ(1)↔ㅔ(5), ㅒ(3)↔ㅖ(7): 양방향 스왑으로 어느 쪽으로 입력해도 대응
// 예: 자켓→자캣, 자캣→자켓, 스피드캣→스피드켓, 스피드켓→스피드캣
function swapKoVowels(text: string): string {
  return [...text].map(ch => {
    const code = ch.charCodeAt(0);
    if (code < 0xAC00 || code > 0xD7A3) return ch;
    const offset = code - 0xAC00;
    const cho  = Math.floor(offset / (21 * 28));
    const jung = Math.floor((offset % (21 * 28)) / 28);
    const jong = offset % 28;
    const swap = jung === 1 ? 5 : jung === 5 ? 1 : jung === 3 ? 7 : jung === 7 ? 3 : jung;
    if (swap === jung) return ch;
    return String.fromCharCode(0xAC00 + (cho * 21 + swap) * 28 + jong);
  }).join('');
}

function dedupeId<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
}
function dedupeNo<T extends { musinsa_no: number }>(arr: T[]): T[] {
  const seen = new Set<number>();
  return arr.filter(x => { if (seen.has(x.musinsa_no)) return false; seen.add(x.musinsa_no); return true; });
}

const PAGES = [
  { label: '홈',         path: '/' },
  { label: '랭킹',       path: '/ranking' },
  { label: '이상탐지',   path: '/anomaly' },
  { label: '프로모션',   path: '/promo' },
  { label: '스냅샷',     path: '/snap' },
  { label: '매거진',     path: '/magazine' },
  { label: '리뷰',       path: '/reviews' },
  { label: '브랜드 랭킹', path: '/brand-ranking' },
  { label: '회사 목록',  path: '/companies' },
  { label: '매핑',       path: '/admin/mapping' },
  { label: '설정',       path: '/settings' },
];

type ResultItem =
  | { kind: '페이지';  label: string; path: string }
  | { kind: '회사';    id: string;    corp_name: string }
  | { kind: '브랜드';  id: string;    name: string; slug: string; company_name?: string | null }
  | { kind: '상품';    musinsa_no: number; name: string; brand_name: string; is_own: boolean };

function itemLabel(item: ResultItem): string {
  if (item.kind === '페이지') return item.label;
  if (item.kind === '회사')   return item.corp_name;
  if (item.kind === '브랜드') return item.name;
  return item.name;
}

function itemMeta(item: ResultItem): string | null {
  if (item.kind === '회사')   return null;
  if (item.kind === '브랜드') return item.company_name ?? item.slug;
  if (item.kind === '상품')   return `#${item.musinsa_no} · ${item.brand_name}`;
  return null;
}

function itemPath(item: ResultItem): string {
  if (item.kind === '페이지') return item.path;
  if (item.kind === '회사')   return `/company?id=${item.id}`;
  if (item.kind === '브랜드') return `/brand?id=${item.id}`;
  return `/product?no=${item.musinsa_no}`;
}

interface CmdKProps { open: boolean; onClose: () => void; }

export default function CmdK({ open, onClose }: CmdKProps) {
  const [query,    setQuery]    = React.useState('');
  const [results,  setResults]  = React.useState<ResultItem[]>([]);
  const [loading,  setLoading]  = React.useState(false);
  const [kbdIdx,   setKbdIdx]   = React.useState(0);
  const inputRef  = React.useRef<HTMLInputElement>(null);
  const timerRef  = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const router    = useRouter();

  React.useEffect(() => {
    if (open) {
      setQuery(''); setKbdIdx(0);
      setResults(PAGES.map(p => ({ kind: '페이지', ...p })));
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    setKbdIdx(0);

    if (timerRef.current) clearTimeout(timerRef.current);

    if (!q.trim()) {
      setResults(PAGES.map(p => ({ kind: '페이지', ...p })));
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const kw      = q.trim();
      const swapped = swapKoVowels(kw);
      // ㅐ↔ㅔ 스왑 결과가 다르면 두 쿼리 병합 (자캣↔자켓 양방향 대응)
      const kws = kw === swapped ? [kw] : [kw, swapped];

      const [companyBatches, brandBatches, productBatches] = await Promise.all([
        Promise.all(kws.map(k => searchCompanies(k, 5))),
        Promise.all(kws.map(k => searchBrands(k, 5))),
        Promise.all(kws.map(k => searchProducts(k, 8))),
      ]);

      const companies = dedupeId(companyBatches.flat()).slice(0, 5);
      const brands    = dedupeId(brandBatches.flat()).slice(0, 5);
      const products  = dedupeNo(productBatches.flat()).slice(0, 8);

      // 페이지는 원본 + 스왑 둘 다 로컬 필터
      const pageKws = [...new Set([kw.toLowerCase(), swapped.toLowerCase()])];
      const pageMatches = PAGES
        .filter(p => pageKws.some(k => p.label.toLowerCase().includes(k)))
        .map(p => ({ kind: '페이지' as const, ...p }));

      const next: ResultItem[] = [
        ...pageMatches,
        ...companies.map(c => ({ kind: '회사'   as const, id: c.id, corp_name: c.corp_name })),
        ...brands.map(b    => ({ kind: '브랜드'  as const, id: b.id, name: b.name, slug: b.slug, company_name: b.company_name })),
        ...products.map(p  => ({ kind: '상품'    as const, musinsa_no: p.musinsa_no, name: p.name, brand_name: p.brand_name, is_own: p.is_own })),
      ];

      setResults(next);
      setLoading(false);
    }, 220);
  };

  const pick = (item: ResultItem) => {
    router.push(itemPath(item));
    onClose();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setKbdIdx(i => Math.min(results.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setKbdIdx(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (results[kbdIdx]) pick(results[kbdIdx]); }
  };

  if (!open) return null;

  const safeIdx = Math.min(kbdIdx, Math.max(0, results.length - 1));

  const groups: Record<string, ResultItem[]> = {};
  results.forEach(r => { if (!groups[r.kind]) groups[r.kind] = []; groups[r.kind].push(r); });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <IcSearch />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKey}
            placeholder="회사·브랜드·상품·페이지 검색"
          />
          {loading
            ? <span className="kbd-hint" style={{ color: 'var(--hs)' }}>검색 중…</span>
            : <span className="kbd-hint">ESC 닫기</span>
          }
        </div>

        <div className="cmdk-list">
          {!loading && results.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--f4)' }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>no results</div>
              <div style={{ marginTop: 6, fontSize: 12 }}>"{query}"와 일치하는 항목이 없습니다</div>
            </div>
          ) : (
            Object.entries(groups).map(([kind, items]) => (
              <React.Fragment key={kind}>
                <div className="cmdk-grp">{kind}</div>
                {items.map((item) => {
                  const idx = results.indexOf(item);
                  const meta = itemMeta(item);
                  const isOwn = item.kind === '상품' && item.is_own;
                  return (
                    <div
                      key={`${kind}-${itemLabel(item)}-${idx}`}
                      className={`cmdk-item ${idx === safeIdx ? 'kbd' : ''}`}
                      onMouseEnter={() => setKbdIdx(idx)}
                      onClick={() => pick(item)}
                    >
                      <span className="kind">{kind}</span>
                      <span className="title">
                        {itemLabel(item)}
                        {isOwn && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 4px', borderRadius: 2 }}>자사</span>}
                      </span>
                      {meta && <span className="meta">{meta}</span>}
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
