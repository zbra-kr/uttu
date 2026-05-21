'use client';
import React from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { IcSearch, IcCheck, IcX, IcArrowUR, IcShield } from '@/components/ui/icons';

// ─── 공통 타입 ───────────────────────────────────────────────────────────────
interface Company {
  id: string;
  corp_name: string;
  business_number: string | null;
  dart_skip: boolean;
}

interface DartCandidate {
  corp_code: string;
  corp_name: string;
  stock_code: string;
}

interface VerifyResult {
  corp_name: string;
  bizr_no: string;
  stock_code: string;
  corp_cls: string;
}

interface Brand {
  id: string;
  name: string;
  name_eng: string | null;
  slug: string;
  company_id: string | null;
  company_skip: boolean;
  company_confirmed: boolean;
  companies: { id: string; corp_name: string } | null;
}

interface CompanyOption {
  id: string;
  corp_name: string;
}

interface CompanyListItem {
  id: string;
  corp_name: string;
  business_number: string | null;
}

interface LinkedBrand {
  id: string;
  name: string;
  name_eng: string | null;
  company_skip: boolean;
  company_confirmed: boolean;
}

interface AddBrandOption {
  id: string;
  name: string;
  name_eng: string | null;
  slug: string;
  company_id: string | null;
  companies: { corp_name: string } | null;
}

type DartMode = 'search' | 'input';

const PAGE_SIZE = 50;

// ─── 유틸 ──────────────────────────────────────────────────────────────────
function normBizNo(s: string) { return s.replace(/[\s\-]/g, ''); }
function clsLabel(c: string) {
  return c === 'Y' ? '유가증권' : c === 'K' ? '코스닥' : c === 'N' ? '코넥스' : '기타·비상장';
}
function parseCorp(raw: string): string {
  const m = /corp_code=(\d{8})/.exec(raw);
  if (m) return m[1];
  return raw.replace(/\D/g, '').slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════════════════
// DART 매핑 패널 (우측)
// ═══════════════════════════════════════════════════════════════════════════
function MappingPanel({ company, onSaved }: { company: Company; onSaved: (id: string) => void }) {
  const [mode, setMode]               = React.useState<DartMode>('search');
  const [searchQ, setSearchQ]         = React.useState('');
  const [candidates, setCandidates]   = React.useState<DartCandidate[]>([]);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [searchError, setSearchError] = React.useState('');
  const [corpInput, setCorpInput]     = React.useState('');
  const [verify, setVerify]           = React.useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = React.useState(false);
  const [verifyError, setVerifyError] = React.useState('');
  const [saving, setSaving]           = React.useState(false);
  const [saveError, setSaveError]     = React.useState('');

  React.useEffect(() => {
    setMode('search'); setSearchQ(''); setCandidates([]); setSearchError('');
    setCorpInput(''); setVerify(null); setVerifyError(''); setSaveError('');
  }, [company.id]);

  const doSearch = async () => {
    if (!searchQ.trim()) return;
    setSearchLoading(true); setSearchError(''); setCandidates([]);
    try {
      const res  = await fetch(`/api/dart/search?q=${encodeURIComponent(searchQ.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '검색 실패');
      setCandidates(json.results ?? []);
    } catch (e: any) { setSearchError(e.message); }
    finally { setSearchLoading(false); }
  };

  const selectCandidate = (c: DartCandidate) => {
    setCorpInput(c.corp_code); setMode('input'); doVerify(c.corp_code);
  };

  const doVerify = async (code?: string) => {
    const parsed = parseCorp(code ?? corpInput);
    if (!parsed || parsed.length !== 8) { setVerifyError('8자리 corp_code를 입력하거나 DART URL을 붙여넣으세요'); return; }
    setVerifyLoading(true); setVerifyError(''); setVerify(null);
    try {
      const res  = await fetch(`/api/dart/verify?corp_code=${parsed}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '검증 실패');
      setVerify(json); setCorpInput(parsed);
    } catch (e: any) { setVerifyError(e.message); }
    finally { setVerifyLoading(false); }
  };

  const doSave = async () => {
    if (!verify) return;
    const parsed = parseCorp(corpInput);
    setSaving(true); setSaveError('');
    try {
      const isListed = ['Y', 'K', 'N'].includes(verify.corp_cls);
      const res  = await fetch(`/api/companies/${company.id}/corp-code`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corp_code: parsed, is_listed: isListed }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setSaveError(`이미 '${json.existing_corp_name}'에 등록된 corp_code입니다. 해당 회사의 중복 레코드로 보입니다.`);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? '저장 실패');
      onSaved(company.id);
    } catch (e: any) { setSaveError(e.message); }
    finally { setSaving(false); }
  };

  const bizMatch = verify
    ? normBizNo(verify.bizr_no) && normBizNo(company.business_number ?? '')
      ? normBizNo(verify.bizr_no) === normBizNo(company.business_number ?? '') ? 'match' : 'mismatch'
      : 'unknown'
    : null;

  const [linkedBrands, setLinkedBrands] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    supabaseBrowser()
      .from('brands').select('id, name').eq('company_id', company.id).order('name').limit(50)
      .then(({ data }) => setLinkedBrands(data ?? []));
  }, [company.id]);

  return (
    <div className="col-flex gap-14" style={{ height: '100%' }}>
      <div className="panel" style={{ background: 'var(--snk)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: company.dart_skip ? 'var(--f4)' : 'var(--f1)' }}>
          {company.corp_name}
          {company.dart_skip && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--f4)', fontWeight: 400, fontStyle: 'italic' }}>건너뜀 처리됨</span>}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>사업자번호 {company.business_number ?? '—'}</div>
        {linkedBrands.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {linkedBrands.map(b => (
              <span key={b.id} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10,
                background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--f3)' }}>
                {b.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="row-flex gap-6">
        <button className={`btn sm${mode === 'search' ? ' active' : ''}`} onClick={() => setMode('search')}>이름 검색</button>
        <button className={`btn sm${mode === 'input' ? ' active' : ''}`} onClick={() => setMode('input')}>직접 입력</button>
      </div>

      {mode === 'search' && (
        <div className="col-flex gap-10">
          <div className="row-flex gap-6">
            <div className="input row-flex center gap-6" style={{ flex: 1 }}>
              <IcSearch size={13} style={{ color: 'var(--f4)', flexShrink: 0 }} />
              <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="DART 회사명 검색 (Enter)"
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
            </div>
            <button className="btn sm" onClick={doSearch} disabled={searchLoading}>{searchLoading ? '검색 중…' : '검색'}</button>
          </div>
          {searchError && <div style={{ fontSize: 11, color: 'var(--shf)', padding: '6px 8px', background: 'var(--shb)', borderRadius: 4 }}>{searchError}</div>}
          {candidates.length > 0 && (
            <div className="tbl" style={{ border: '1px solid var(--bd)', borderRadius: 6 }}>
              <div className="row head" style={{ gridTemplateColumns: '1fr 90px 80px' }}>
                <span>DART 회사명</span><span>corp_code</span><span />
              </div>
              {candidates.map(c => (
                <div key={c.corp_code} className="row hover" style={{ gridTemplateColumns: '1fr 90px 80px' }}>
                  <span style={{ fontSize: 12 }}>{c.corp_name}</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>{c.corp_code}</span>
                  <span><button className="btn sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => selectCandidate(c)}>이 회사로 →</button></span>
                </div>
              ))}
            </div>
          )}
          {!searchLoading && candidates.length === 0 && searchQ && !searchError && (
            <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '20px 0' }}>검색 결과가 없습니다</div>
          )}
        </div>
      )}

      {mode === 'input' && (
        <div className="col-flex gap-10">
          <div className="row-flex gap-6">
            <div className="input row-flex center gap-6" style={{ flex: 1 }}>
              <input autoFocus value={corpInput}
                onChange={e => { setCorpInput(e.target.value); setVerify(null); setVerifyError(''); }}
                onKeyDown={e => e.key === 'Enter' && doVerify()} placeholder="corp_code 8자리 또는 DART URL 붙여넣기"
                className="mono" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
            </div>
            <button className="btn sm" onClick={() => doVerify()} disabled={verifyLoading}>{verifyLoading ? '검증 중…' : '검증'}</button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--f4)' }}>예) 00114956 &nbsp;·&nbsp; https://dart.fss.or.kr/corp/mvMaint.do?corp_code=00114956</div>
          {verifyError && <div style={{ fontSize: 11, color: 'var(--shf)', padding: '6px 8px', background: 'var(--shb)', borderRadius: 4 }}>{verifyError}</div>}
          {verify && (
            <div className="panel col-flex gap-8">
              <div className="row-flex between"><span style={{ fontSize: 11, color: 'var(--f4)', width: 90 }}>DART 회사명</span><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)' }}>{verify.corp_name}</span></div>
              <div className="row-flex between">
                <span style={{ fontSize: 11, color: 'var(--f4)', width: 90 }}>사업자번호</span>
                <span className="row-flex center gap-6">
                  <span className="mono" style={{ fontSize: 12 }}>{verify.bizr_no}</span>
                  {bizMatch === 'match'    && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--slf)', fontWeight: 600 }}><IcCheck size={12} /> 일치</span>}
                  {bizMatch === 'mismatch' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--shf)', fontWeight: 600 }}><IcX size={12} /> 불일치</span>}
                  {bizMatch === 'unknown'  && <span style={{ fontSize: 10, color: 'var(--f4)' }}>확인불가</span>}
                </span>
              </div>
              <div className="row-flex between"><span style={{ fontSize: 11, color: 'var(--f4)', width: 90 }}>상장 구분</span><span style={{ fontSize: 12 }}>{clsLabel(verify.corp_cls)}</span></div>
              {verify.stock_code?.trim() && <div className="row-flex between"><span style={{ fontSize: 11, color: 'var(--f4)', width: 90 }}>종목코드</span><span className="mono" style={{ fontSize: 12 }}>{verify.stock_code.trim()}</span></div>}
              {bizMatch === 'mismatch' && (
                <div style={{ fontSize: 11, color: '#F59E0B', padding: '6px 8px', background: 'rgba(245,158,11,0.08)', borderRadius: 4, border: '1px solid rgba(245,158,11,0.2)' }}>
                  ⚠️ 사업자번호가 일치하지 않습니다. 저장을 계속하려면 아래 버튼을 클릭하세요.
                </div>
              )}
              {saveError && <div style={{ fontSize: 11, color: 'var(--shf)', padding: '6px 8px', background: 'var(--shb)', borderRadius: 4 }}>{saveError}</div>}
              <div className="row-flex gap-8" style={{ marginTop: 4 }}>
                <button className="btn sm" style={{ background: 'var(--hs)', color: '#fff', borderColor: 'var(--hs)', flex: 1 }} onClick={doSave} disabled={saving}>
                  {saving ? '저장 중…' : bizMatch === 'mismatch' ? '⚠️ 강제 저장' : '저장'}
                </button>
                <button className="btn sm" onClick={() => { setVerify(null); setCorpInput(''); }} disabled={saving}>취소</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 회사 기준 브랜드 관리 패널 (우측)
// ═══════════════════════════════════════════════════════════════════════════
function CompanyBrandPanel({ company }: { company: CompanyListItem }) {
  const [brands, setBrands]         = React.useState<LinkedBrand[]>([]);
  const [loading, setLoading]       = React.useState(true);
  const [checkedIds, setCheckedIds] = React.useState<Set<string>>(new Set());
  const [addQ, setAddQ]             = React.useState('');
  const [addResults, setAddResults] = React.useState<AddBrandOption[]>([]);
  const [addSearching, setAddSearching] = React.useState(false);
  const [busyIds, setBusyIds]       = React.useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy]   = React.useState(false);
  const [batchError, setBatchError] = React.useState('');

  const fetchBrands = React.useCallback(async () => {
    setLoading(true);
    const { data } = await (supabaseBrowser()
      .from('brands')
      .select('id, name, name_eng, company_skip, company_confirmed')
      .eq('company_id', company.id)
      .not('detail_fetched_at', 'is', null)
      .order('name') as any);
    setBrands((data ?? []) as LinkedBrand[]);
    setLoading(false);
  }, [company.id]);

  React.useEffect(() => {
    fetchBrands();
    setCheckedIds(new Set()); setAddQ(''); setAddResults([]);
  }, [fetchBrands]);

  // 브랜드 추가 검색 (현재 회사 제외)
  React.useEffect(() => {
    if (!addQ.trim()) { setAddResults([]); return; }
    const t = setTimeout(async () => {
      setAddSearching(true);
      const q = addQ.trim();
      const { data } = await (supabaseBrowser()
        .from('brands')
        .select('id, name, name_eng, slug, company_id, companies(corp_name)')
        .or(`name.ilike.%${q}%,slug.ilike.%${q}%`)
        .not('detail_fetched_at', 'is', null)
        .neq('company_id', company.id)
        .order('name')
        .limit(15) as any);
      setAddResults(data ?? []);
      setAddSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [addQ, company.id]);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });

  const confirmBrand = async (brandId: string) => {
    setBusy(brandId, true);
    const res = await fetch(`/api/brands/${brandId}/company`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: company.id }),
    });
    if (res.ok) setBrands(bs => bs.map(b => b.id === brandId ? { ...b, company_confirmed: true } : b));
    setBusy(brandId, false);
  };

  const unlinkBrand = async (brandId: string) => {
    setBusy(brandId, true);
    const res = await fetch(`/api/brands/${brandId}/company`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: null, confirmed: false }),
    });
    if (res.ok) {
      setBrands(bs => bs.filter(b => b.id !== brandId));
      setCheckedIds(prev => { const n = new Set(prev); n.delete(brandId); return n; });
    }
    setBusy(brandId, false);
  };

  const addBrand = async (brandId: string) => {
    setBusy(brandId, true);
    const res = await fetch(`/api/brands/${brandId}/company`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: company.id }),
    });
    if (res.ok) {
      await fetchBrands();
      setAddResults(prev => prev.filter(b => b.id !== brandId));
    }
    setBusy(brandId, false);
  };

  const batchOp = async (op: 'confirm' | 'skip' | 'unskip') => {
    const ids = [...checkedIds];
    if (!ids.length) return;
    setBatchBusy(true); setBatchError('');
    try {
      let results: any[];
      if (op === 'confirm') {
        results = await Promise.all(
          ids.filter(id => !brands.find(b => b.id === id)?.company_confirmed).map(id =>
            fetch(`/api/brands/${id}/company`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ company_id: company.id }),
            }).then(r => r.json())
          )
        );
        setBrands(bs => bs.map(b => ids.includes(b.id) ? { ...b, company_confirmed: true } : b));
      } else {
        const skip = op === 'skip';
        results = await Promise.all(
          ids.filter(id => brands.find(b => b.id === id)?.company_skip !== skip).map(id =>
            fetch(`/api/brands/${id}/company-skip`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skip }),
            }).then(r => r.json())
          )
        );
        setBrands(bs => bs.map(b => ids.includes(b.id) ? { ...b, company_skip: skip } : b));
      }
      const failed = results.filter(r => r.error);
      if (failed.length) throw new Error(`${failed.length}개 실패`);
      setCheckedIds(new Set());
    } catch (e: any) { setBatchError(e.message); }
    finally { setBatchBusy(false); }
  };

  const allChecked   = brands.length > 0 && brands.every(b => checkedIds.has(b.id));
  const toggleAll    = () => allChecked ? setCheckedIds(new Set()) : setCheckedIds(new Set(brands.map(b => b.id)));
  const selUnconf    = [...checkedIds].filter(id => !brands.find(b => b.id === id)?.company_confirmed).length;
  const selUnskipped = [...checkedIds].filter(id => !brands.find(b => b.id === id)?.company_skip).length;
  const selSkipped   = [...checkedIds].filter(id =>  brands.find(b => b.id === id)?.company_skip).length;

  return (
    <div className="col-flex gap-14" style={{ height: '100%' }}>
      {/* 회사 헤더 */}
      <div className="panel" style={{ background: 'var(--snk)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>{company.corp_name}</div>
        {company.business_number && <div className="mono" style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>사업자번호 {company.business_number}</div>}
        {!loading && <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>{brands.length}개 브랜드 연결됨</div>}
      </div>

      {/* 연결된 브랜드 목록 */}
      <div className="col-flex gap-8" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
          <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={brands.length === 0} style={{ cursor: 'pointer' }} />
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)', flex: 1 }}>연결된 브랜드</div>
          {checkedIds.size > 0 && <span style={{ fontSize: 10, color: 'var(--hs)', fontWeight: 600 }}>{checkedIds.size}개 선택</span>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
          {loading && <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '30px 0' }}>로딩 중…</div>}
          {!loading && brands.length === 0 && <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '30px 0' }}>연결된 브랜드 없음</div>}
          {brands.map(b => {
            const isChk  = checkedIds.has(b.id);
            const isBusy = busyIds.has(b.id);
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6,
                background: isChk ? 'var(--snk)' : 'transparent' }}>
                <input type="checkbox" checked={isChk}
                  onChange={() => setCheckedIds(prev => { const n = new Set(prev); isChk ? n.delete(b.id) : n.add(b.id); return n; })}
                  style={{ cursor: 'pointer', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: b.company_skip ? 'var(--f4)' : 'var(--f1)', textDecoration: b.company_skip ? 'line-through' : 'none' }}>
                    {b.name}
                    {b.name_eng && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--f4)' }}>{b.name_eng}</span>}
                    {b.company_confirmed && !b.company_skip && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--slf)' }}>✓</span>}
                  </div>
                </div>
                <div className="row-flex gap-4" style={{ flexShrink: 0 }}>
                  <button className="btn sm" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--slf)', opacity: b.company_confirmed ? 0.3 : 1 }}
                    onClick={() => confirmBrand(b.id)} disabled={isBusy || b.company_confirmed}>확인</button>
                  <button className="btn sm" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--shf)' }}
                    onClick={() => unlinkBrand(b.id)} disabled={isBusy}>분리</button>
                </div>
              </div>
            );
          })}
        </div>

        {checkedIds.size > 0 && (
          <div className="col-flex gap-6" style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
            {batchError && <div style={{ fontSize: 11, color: 'var(--shf)' }}>{batchError}</div>}
            <div className="row-flex gap-6">
              {selUnconf > 0 && (
                <button className="btn sm" style={{ flex: 1, fontSize: 11, color: 'var(--slf)', borderColor: 'var(--slf)' }}
                  onClick={() => batchOp('confirm')} disabled={batchBusy}>
                  {batchBusy ? '처리 중…' : `확인 (${selUnconf}개)`}
                </button>
              )}
              {selUnskipped > 0 && (
                <button className="btn sm" style={{ flex: 1, fontSize: 11 }} onClick={() => batchOp('skip')} disabled={batchBusy}>
                  {batchBusy ? '처리 중…' : `건너뜀 (${selUnskipped}개)`}
                </button>
              )}
              {selSkipped > 0 && (
                <button className="btn sm" style={{ flex: 1, fontSize: 11 }} onClick={() => batchOp('unskip')} disabled={batchBusy}>
                  {batchBusy ? '처리 중…' : `건너뜀 해제 (${selSkipped}개)`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 브랜드 추가 */}
      <div className="col-flex gap-8" style={{ borderTop: '1px solid var(--bd)', paddingTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>브랜드 추가</div>
        <div className="input row-flex center gap-6">
          <IcSearch size={13} style={{ color: 'var(--f4)', flexShrink: 0 }} />
          <input value={addQ} onChange={e => setAddQ(e.target.value)} placeholder="브랜드명 검색 (다른 회사 포함)"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
        </div>
        {addSearching && <div style={{ fontSize: 11, color: 'var(--f4)' }}>검색 중…</div>}
        {addResults.length > 0 && (
          <div className="tbl" style={{ border: '1px solid var(--bd)', borderRadius: 6 }}>
            {addResults.map(b => (
              <div key={b.id} className="row hover" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name}{b.name_eng && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--f4)' }}>{b.name_eng}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--f4)' }}>
                    <span className="mono">{b.slug}</span>
                    {' · '}현재: {(b.companies as any)?.corp_name ?? '회사 없음'}
                  </div>
                </div>
                <button className="btn sm" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }}
                  onClick={() => addBrand(b.id)} disabled={busyIds.has(b.id)}>
                  {busyIds.has(b.id) ? '…' : '추가'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DART 코드 매핑 탭
// ═══════════════════════════════════════════════════════════════════════════
function DartTab() {
  const [companies, setCompanies]       = React.useState<Company[]>([]);
  const [total, setTotal]               = React.useState(0);
  const [page, setPage]                 = React.useState(0);
  const [search, setSearch]             = React.useState('');
  const [debouncedSearch, setDebounced] = React.useState('');
  const [showDone, setShowDone]         = React.useState(false);
  const [showSkipped, setShowSkipped]   = React.useState(false);
  const [loading, setLoading]           = React.useState(true);
  const [error, setError]               = React.useState('');
  const [selected, setSelected]         = React.useState<Company | null>(null);
  const [checkedIds, setCheckedIds]     = React.useState<Set<string>>(new Set());
  const [batchSkipping, setBatchSkipping] = React.useState(false);
  const [batchError, setBatchError]     = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => { setCheckedIds(new Set()); }, [page, debouncedSearch, showDone, showSkipped]);

  const fetchList = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      let q = supabaseBrowser()
        .from('companies')
        .select('id, corp_name, business_number, dart_skip', { count: 'exact' })
        .not('dart_fetched_at', 'is', null)
        .order('corp_name')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!showDone)    q = q.is('corp_code', null);
      if (!showSkipped) q = q.eq('dart_skip', false);
      if (debouncedSearch.trim()) q = q.ilike('corp_name', `%${debouncedSearch.trim()}%`);
      const { data, error: err, count } = await q;
      if (err) throw err;
      setCompanies(data ?? []); setTotal(count ?? 0);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [page, debouncedSearch, showDone, showSkipped]);

  React.useEffect(() => { fetchList(); }, [fetchList]);

  const handleSaved = (id: string) => {
    setCompanies(cs => cs.filter(c => c.id !== id));
    setTotal(t => t - 1);
    setSelected(s => s?.id === id ? null : s);
    setCheckedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const toggleCheck = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const allPageChecked = companies.length > 0 && companies.every(c => checkedIds.has(c.id));
  const toggleAll = () => {
    if (allPageChecked) setCheckedIds(prev => { const n = new Set(prev); companies.forEach(c => n.delete(c.id)); return n; });
    else setCheckedIds(prev => { const n = new Set(prev); companies.forEach(c => n.add(c.id)); return n; });
  };

  const doBatchSkip = async (skip: boolean) => {
    const ids = [...checkedIds].filter(id => companies.find(x => x.id === id)?.dart_skip !== skip);
    if (!ids.length) { setCheckedIds(new Set()); return; }
    setBatchSkipping(true); setBatchError('');
    try {
      const results = await Promise.all(ids.map(id =>
        fetch(`/api/companies/${id}/dart-skip`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skip }),
        }).then(r => r.json())
      ));
      const failed = results.filter(r => r.error);
      if (failed.length) throw new Error(`${failed.length}개 실패: ${failed[0].error}`);
      if (skip && !showSkipped) {
        setCompanies(cs => cs.filter(c => !ids.includes(c.id)));
        setTotal(t => t - ids.length);
        setSelected(s => s && ids.includes(s.id) ? null : s);
      } else {
        setCompanies(cs => cs.map(c => ids.includes(c.id) ? { ...c, dart_skip: skip } : c));
        setSelected(s => s && ids.includes(s.id) ? { ...s, dart_skip: skip } : s);
      }
      setCheckedIds(new Set());
    } catch (e: any) { setBatchError(e.message); }
    finally { setBatchSkipping(false); }
  };

  const totalPages        = Math.ceil(total / PAGE_SIZE);
  const checkedSkipCount  = [...checkedIds].filter(id => companies.find(c => c.id === id)?.dart_skip === true).length;
  const checkedUnskipCount= [...checkedIds].filter(id => companies.find(c => c.id === id)?.dart_skip === false).length;

  return (
    <div className="row-flex gap-14" style={{ alignItems: 'flex-start', height: 'calc(100vh - 140px)' }}>
      {/* 좌: 목록 */}
      <div className="panel col-flex gap-10" style={{ width: 300, flexShrink: 0, height: '100%', overflow: 'hidden' }}>
        <div className="input row-flex center gap-6">
          <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="회사명 검색"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
        </div>
        <div className="col-flex gap-4">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--f3)', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={showDone} onChange={e => { setShowDone(e.target.checked); setPage(0); }} style={{ cursor: 'pointer' }} />완료 포함 보기
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--f3)', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={showSkipped} onChange={e => { setShowSkipped(e.target.checked); setPage(0); }} style={{ cursor: 'pointer' }} />건너뜀 포함 보기
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
          <input type="checkbox" checked={allPageChecked} onChange={toggleAll} disabled={companies.length === 0} style={{ cursor: 'pointer', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: 'var(--f4)', flex: 1 }}>
            {loading ? '로딩 중…' : error ? '' : `${total.toLocaleString()}개 · ${page + 1}/${Math.max(totalPages, 1)}p`}
          </span>
          {checkedIds.size > 0 && <span style={{ fontSize: 10, color: 'var(--hs)', fontWeight: 600 }}>{checkedIds.size}개 선택</span>}
        </div>
        {error && <div style={{ fontSize: 11, color: 'var(--shf)' }}>{error}</div>}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {companies.map(c => {
            const isSel = selected?.id === c.id;
            const isChk = checkedIds.has(c.id);
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 8px', borderRadius: 6,
                background: isSel ? 'var(--hs-soft)' : isChk ? 'var(--snk)' : 'transparent', cursor: 'pointer' }}
                onClick={() => setSelected(c)}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'var(--snk)'; }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = isChk ? 'var(--snk)' : 'transparent'; }}>
                <input type="checkbox" checked={isChk} onClick={e => toggleCheck(c.id, e)} onChange={() => {}} style={{ cursor: 'pointer', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: isSel ? 600 : 400, lineHeight: 1.3,
                    color: isSel ? 'var(--hs)' : c.dart_skip ? 'var(--f4)' : 'var(--f1)',
                    textDecoration: c.dart_skip ? 'line-through' : 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.corp_name}
                  </div>
                  {c.business_number && <div className="mono" style={{ fontSize: 10, color: isSel ? 'var(--hs)' : 'var(--f4)', opacity: 0.8 }}>{c.business_number}</div>}
                </div>
              </div>
            );
          })}
          {!loading && companies.length === 0 && !error && (
            <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '40px 0' }}>
              {debouncedSearch ? '검색 결과 없음' : '미처리 항목 없음 ✓'}
            </div>
          )}
        </div>
        {totalPages > 1 && (
          <div className="row-flex center gap-6">
            <button className="btn sm icon" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>‹</button>
            <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{page + 1} / {totalPages}</span>
            <button className="btn sm icon" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1 || loading}>›</button>
          </div>
        )}
        {checkedIds.size > 0 && (
          <div className="col-flex gap-6" style={{ borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
            {batchError && <div style={{ fontSize: 11, color: 'var(--shf)' }}>{batchError}</div>}
            <div className="row-flex gap-6">
              {checkedUnskipCount > 0 && (
                <button className="btn sm" style={{ flex: 1, fontSize: 11 }} onClick={() => doBatchSkip(true)} disabled={batchSkipping}>
                  {batchSkipping ? '처리 중…' : `건너뜀 (${checkedUnskipCount}개)`}
                </button>
              )}
              {showSkipped && checkedSkipCount > 0 && (
                <button className="btn sm" style={{ flex: 1, fontSize: 11, color: 'var(--slf)', borderColor: 'var(--slf)' }} onClick={() => doBatchSkip(false)} disabled={batchSkipping}>
                  {batchSkipping ? '처리 중…' : `해제 (${checkedSkipCount}개)`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 우: 매핑 패널 */}
      <div className="panel" style={{ flex: 1, height: '100%', overflow: 'auto' }}>
        {selected ? (
          <MappingPanel company={selected} onSaved={handleSaved} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
            <span style={{ fontSize: 32, opacity: 0.15 }}>←</span>
            <div style={{ fontSize: 13, color: 'var(--f4)' }}>좌측 목록에서 회사를 선택하세요</div>
            <div style={{ fontSize: 11, color: 'var(--f4)' }}>이름 검색 또는 corp_code 직접 입력으로 DART와 매핑합니다</div>
            <a href="https://dart.fss.or.kr" target="_blank" rel="noopener noreferrer"
              className="btn sm" style={{ marginTop: 8, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <IcArrowUR size={12} /> DART 열기
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 브랜드-회사 매핑 탭 (회사 기준)
// ═══════════════════════════════════════════════════════════════════════════
function BrandTab() {
  const [companies, setCompanies]         = React.useState<CompanyListItem[]>([]);
  const [total, setTotal]                 = React.useState(0);
  const [page, setPage]                   = React.useState(0);
  const [search, setSearch]               = React.useState('');
  const [debSearch, setDebSearch]         = React.useState('');
  const [loading, setLoading]             = React.useState(true);
  const [error, setError]                 = React.useState('');
  const [selected, setSelected]           = React.useState<CompanyListItem | null>(null);
  const [showSkipped, setShowSkipped]     = React.useState(false);
  const [hideAllConfirmed, setHideAllConfirmed] = React.useState(true);

  React.useEffect(() => {
    const t = setTimeout(() => { setDebSearch(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchCompanies = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      let excludeIds: string[] | null = null;
      if (hideAllConfirmed) {
        // 연결된 브랜드가 있으면서 전부 confirmed/skipped인 회사만 제외
        // 브랜드가 아예 없는 회사는 제외하지 않음(미완료 상태)
        const [{ data: allPd }, { data: unfinPd }] = await Promise.all([
          supabaseBrowser().from('brands').select('company_id').limit(5000),
          supabaseBrowser()
            .from('brands').select('company_id')
            .eq('company_confirmed', false).eq('company_skip', false).limit(5000),
        ]);
        const allLinkedIds = new Set(
          (allPd ?? []).map((b: any) => b.company_id as string).filter(Boolean)
        );
        const unfinishedIds = new Set(
          (unfinPd ?? []).map((b: any) => b.company_id as string).filter(Boolean)
        );
        // 완료 = 연결 브랜드 있고, 미완료 브랜드 없음
        excludeIds = [...allLinkedIds].filter(id => !unfinishedIds.has(id));
      }

      let q = (supabaseBrowser()
        .from('companies')
        .select('id, corp_name, business_number', { count: 'exact' })
        .order('corp_name')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)) as any;
      if (!showSkipped) q = q.eq('dart_skip', false);
      if (debSearch.trim()) q = q.ilike('corp_name', `%${debSearch.trim()}%`);
      if (excludeIds && excludeIds.length > 0) {
        for (const id of excludeIds) q = q.neq('id', id);
      }
      const { data, error: err, count } = await q;
      if (err) throw err;
      setCompanies(data ?? []); setTotal(count ?? 0);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [page, debSearch, showSkipped, hideAllConfirmed]);

  React.useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="row-flex gap-14" style={{ alignItems: 'flex-start', height: 'calc(100vh - 140px)' }}>
      {/* 좌: 회사 목록 */}
      <div className="panel col-flex gap-10" style={{ width: 300, flexShrink: 0, height: '100%', overflow: 'hidden' }}>
        <div className="input row-flex center gap-6">
          <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="회사명 검색"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--f3)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={hideAllConfirmed} onChange={e => { setHideAllConfirmed(e.target.checked); setPage(0); }} style={{ cursor: 'pointer' }} />
          미완료만 보기
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--f3)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={showSkipped} onChange={e => { setShowSkipped(e.target.checked); setPage(0); }} style={{ cursor: 'pointer' }} />
          건너뜀 포함 보기
        </label>
        <div style={{ fontSize: 10, color: 'var(--f4)', borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
          {loading ? '로딩 중…' : error ? '' : `${total.toLocaleString()}개 · ${page + 1}/${Math.max(totalPages, 1)}p`}
        </div>
        {error && <div style={{ fontSize: 11, color: 'var(--shf)' }}>{error}</div>}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {companies.map(c => {
            const isSel = selected?.id === c.id;
            return (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column', padding: '6px 8px', borderRadius: 6,
                background: isSel ? 'var(--hs-soft)' : 'transparent', cursor: 'pointer' }}
                onClick={() => setSelected(c)}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'var(--snk)'; }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                <div style={{ fontSize: 12, fontWeight: isSel ? 600 : 400, color: isSel ? 'var(--hs)' : 'var(--f1)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.corp_name}</div>
                {c.business_number && (
                  <div className="mono" style={{ fontSize: 10, color: isSel ? 'var(--hs)' : 'var(--f4)', opacity: 0.8 }}>{c.business_number}</div>
                )}
              </div>
            );
          })}
          {!loading && companies.length === 0 && !error && (
            <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '40px 0' }}>
              {debSearch ? '검색 결과 없음' : '회사 없음'}
            </div>
          )}
        </div>
        {totalPages > 1 && (
          <div className="row-flex center gap-6">
            <button className="btn sm icon" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>‹</button>
            <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{page + 1} / {totalPages}</span>
            <button className="btn sm icon" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1 || loading}>›</button>
          </div>
        )}
      </div>

      {/* 우: 브랜드 관리 패널 */}
      <div className="panel" style={{ flex: 1, height: '100%', overflow: 'auto' }}>
        {selected ? (
          <CompanyBrandPanel company={selected} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
            <span style={{ fontSize: 32, opacity: 0.15 }}>←</span>
            <div style={{ fontSize: 13, color: 'var(--f4)' }}>좌측에서 회사를 선택하세요</div>
            <div style={{ fontSize: 11, color: 'var(--f4)' }}>해당 회사에 연결된 브랜드를 확인하고 수정할 수 있습니다</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 메인 페이지
// ═══════════════════════════════════════════════════════════════════════════
export default function MappingPage() {
  const [tab, setTab] = React.useState<'dart' | 'brand'>('dart');

  return (
    <>
      <div className="page-title">
        <h1>매핑 관리</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>
          <IcShield size={12} /> admin
        </span>
        <div className="row-flex gap-4" style={{ marginLeft: 10 }}>
          <button className={`btn sm${tab === 'dart' ? ' active' : ''}`} onClick={() => setTab('dart')}>
            DART 코드 매핑
          </button>
          <button className={`btn sm${tab === 'brand' ? ' active' : ''}`} onClick={() => setTab('brand')}>
            브랜드-회사 매핑
          </button>
        </div>
      </div>

      {tab === 'dart'  && <DartTab />}
      {tab === 'brand' && <BrandTab />}
    </>
  );
}
