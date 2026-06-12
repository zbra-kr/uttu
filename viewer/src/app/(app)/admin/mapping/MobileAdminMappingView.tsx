'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

type Tab = 'dart' | 'brand';

interface DartRow {
  id: string;
  corp_name: string;
  dart_corp_code: string | null;
  business_number: string | null;
  dart_skip: boolean;
}

interface BrandRow {
  id: string;
  name: string;
  company_id: string | null;
  company_name: string | null;
}

export default function MobileAdminMappingView() {
  const [tab, setTab] = useState<Tab>('dart');
  const [dartRows, setDartRows] = useState<DartRow[]>([]);
  const [brandRows, setBrandRows] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<Set<Tab>>(new Set());
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadDart() {
    setLoading(true);
    setLoadError(null);
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('companies')
      .select('id, corp_name, dart_corp_code, business_number, dart_skip')
      .order('corp_name')
      .limit(200);
    if (error) { console.error('[mapping] loadDart failed', error); setLoadError(error.message); setLoading(false); return; }
    setDartRows((data as DartRow[]) ?? []);
    setLoading(false);
  }

  async function loadBrand() {
    setLoading(true);
    setLoadError(null);
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('brands')
      .select('id, name, company_id, companies(corp_name)')
      .order('name')
      .limit(300);
    if (error) { console.error('[mapping] loadBrand failed', error); setLoadError(error.message); setLoading(false); return; }
    setBrandRows(
      ((data ?? []) as unknown[]).map((r: unknown) => {
        const row = r as { id: string; name: string; company_id: string | null; companies: { corp_name: string } | null };
        return {
          id: row.id,
          name: row.name,
          company_id: row.company_id,
          company_name: row.companies?.corp_name ?? null,
        };
      })
    );
    setLoading(false);
  }

  function switchTab(t: Tab) {
    setTab(t);
    setSearch('');
    if (!loaded.has(t)) {
      setLoaded(prev => new Set(prev).add(t));
      if (t === 'dart') loadDart();
      else loadBrand();
    }
  }

  // 첫 탭 자동 로드
  if (!loaded.has('dart') && tab === 'dart') {
    setLoaded(new Set(['dart']));
    loadDart();
  }

  const filteredDart = search
    ? dartRows.filter(r => r.corp_name.includes(search) || (r.dart_corp_code ?? '').includes(search))
    : dartRows;

  const filteredBrand = search
    ? brandRows.filter(r => r.name.includes(search) || (r.company_name ?? '').includes(search))
    : brandRows;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {/* 탭 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {([['dart', 'DART 매핑'], ['brand', '브랜드-회사']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            style={{
              flex: 1, padding: '8px 0', fontSize: 12, fontWeight: tab === t ? 700 : 400,
              background: tab === t ? 'var(--hs)' : 'var(--sur)',
              color: tab === t ? 'var(--rai)' : 'var(--f3)',
              border: '1px solid var(--bd)', borderRadius: 7, cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="검색"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 7,
          border: '1px solid var(--bd)', background: 'var(--sur)',
          color: 'var(--f1)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
      />

      {loadError && (
        <div style={{ background: 'var(--shb)', border: '1px solid var(--shf)', borderRadius: 7, padding: '10px 12px', fontSize: 12, color: 'var(--shf)' }}>
          {loadError}
        </div>
      )}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>
      )}

      {!loading && tab === 'dart' && (
        filteredDart.length === 0
          ? <MobileEmptyState icon="🔗" title="매핑 데이터가 없습니다" />
          : filteredDart.map(r => (
            <div key={r.id} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.corp_name}
                  </div>
                  {r.dart_corp_code && (
                    <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>{r.dart_corp_code}</div>
                  )}
                </div>
                {r.dart_skip ? (
                  <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--f4)', background: 'var(--snk)', padding: '2px 6px', borderRadius: 5 }}>SKIP</span>
                ) : r.dart_corp_code ? (
                  <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--slf)', background: 'var(--slb)', padding: '2px 6px', borderRadius: 5 }}>매핑됨</span>
                ) : (
                  <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--smf)', background: 'var(--smb)', padding: '2px 6px', borderRadius: 5 }}>미매핑</span>
                )}
              </div>
            </div>
          ))
      )}

      {!loading && tab === 'brand' && (
        filteredBrand.length === 0
          ? <MobileEmptyState icon="🔗" title="브랜드 데이터가 없습니다" />
          : filteredBrand.map(r => (
            <div key={r.id} style={{ padding: '10px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>{r.company_name ?? '회사 미연결'}</div>
                </div>
                {r.company_id ? (
                  <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--slf)', background: 'var(--slb)', padding: '2px 6px', borderRadius: 5 }}>연결됨</span>
                ) : (
                  <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--smf)', background: 'var(--smb)', padding: '2px 6px', borderRadius: 5 }}>미연결</span>
                )}
              </div>
            </div>
          ))
      )}
    </div>
  );
}
