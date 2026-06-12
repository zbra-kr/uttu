'use client';
import React from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { IcSearch, IcCheck, IcX, IcArrowUR, IcShield } from '@/components/ui/icons';
import { useIsMobile } from '@/hooks/useViewport';
import MobileAdminMappingView from './MobileAdminMappingView';

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface UnifiedCompany {
  id: string;
  corp_name: string;
  business_number: string | null;
  corp_code: string | null;
  dart_skip: boolean;
  remark: string | null;
  parent_company_id: string | null;
  parent: { id: string; corp_name: string } | null;
}

interface DartCandidate  { corp_code: string; corp_name: string; stock_code: string; }
interface VerifyResult   { corp_name: string; bizr_no: string; stock_code: string; corp_cls: string; }
interface LinkedBrand    { id: string; name: string; name_eng: string | null; company_skip: boolean; company_confirmed: boolean; remark: string | null; }
interface AddBrandOption { id: string; name: string; name_eng: string | null; slug: string; company_id: string | null; companies: { corp_name: string } | null; }
interface CompanyOption  { id: string; corp_name: string; }
type DartMode = 'search' | 'input';

const PAGE_SIZE = 50;

// ─── 유틸 ────────────────────────────────────────────────────────────────────
const normBizNo = (s: string) => s.replace(/[\s\-]/g, '');
const clsLabel  = (c: string) => c === 'Y' ? '유가증권' : c === 'K' ? '코스닥' : c === 'N' ? '코넥스' : '기타·비상장';
const parseCorp = (raw: string) => {
  const m = /corp_code=(\d{8})/.exec(raw);
  return m ? m[1] : raw.replace(/\D/g, '').slice(0, 8);
};

// ─── 필터 체크박스 ──────────────────────────────────────────────────────────
function FilterChk({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
      color: checked ? 'var(--hs)' : 'var(--f3)', cursor: 'pointer', userSelect: 'none', fontWeight: checked ? 600 : 400 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--hs)' }} />
      {label}
    </label>
  );
}

// ─── 리마크 에디터 ───────────────────────────────────────────────────────────
function RemarkEditor({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft]     = React.useState(value ?? '');
  React.useEffect(() => { setDraft(value ?? ''); }, [value]);
  const commit = () => { setEditing(false); if (draft !== (value ?? '')) onSave(draft); };
  if (editing) return (
    <textarea autoFocus rows={2} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Escape') { setEditing(false); setDraft(value ?? ''); } }}
      style={{ fontSize: 11, color: 'var(--f1)', background: 'var(--snk)', border: '1px solid var(--bd)',
        borderRadius: 4, padding: '3px 6px', width: '100%', resize: 'none', outline: 'none',
        fontFamily: 'inherit', lineHeight: 1.5, marginTop: 4 }} />
  );
  return (
    <button type="button" onClick={() => setEditing(true)}
      style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 11, color: value ? 'var(--f3)' : 'var(--f4)', cursor: 'text',
        marginTop: 4, minHeight: 16, fontStyle: value ? 'normal' : 'italic', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
      {value || '메모 추가...'}
    </button>
  );
}

// ─── DART 매핑 섹션 ─────────────────────────────────────────────────────────
function DartSection({ company, onSaved }: { company: UnifiedCompany; onSaved: (id: string, corpCode: string) => void }) {
  const [mode, setMode]                   = React.useState<DartMode>('search');
  const [searchQ, setSearchQ]             = React.useState('');
  const [candidates, setCandidates]       = React.useState<DartCandidate[]>([]);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [searchError, setSearchError]     = React.useState('');
  const [corpInput, setCorpInput]         = React.useState('');
  const [verify, setVerify]               = React.useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = React.useState(false);
  const [verifyError, setVerifyError]     = React.useState('');
  const [saving, setSaving]               = React.useState(false);
  const [saveError, setSaveError]         = React.useState('');

  React.useEffect(() => {
    setMode('search'); setSearchQ(''); setCandidates([]); setSearchError('');
    setCorpInput(''); setVerify(null); setVerifyError(''); setSaveError('');
  }, [company.id]);

  const doSearch = async () => {
    if (!searchQ.trim()) return;
    setSearchLoading(true); setSearchError(''); setCandidates([]);
    try {
      const res  = await fetch(`/api/dart/search?q=${encodeURIComponent(searchQ.trim())}`);
      const text = await res.text();
      if (!text) throw new Error('DART_API_KEY 설정을 확인하거나 잠시 후 다시 시도하세요.');
      let json: any;
      try { json = JSON.parse(text); } catch { throw new Error(`응답 파싱 오류 (HTTP ${res.status})`); }
      if (!res.ok) throw new Error(json.error ?? '검색 실패');
      setCandidates(json.results ?? []);
    } catch (e: any) { setSearchError(e.message); }
    finally { setSearchLoading(false); }
  };

  const selectCandidate = (c: DartCandidate) => { setCorpInput(c.corp_code); setMode('input'); doVerify(c.corp_code); };

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
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corp_code: parsed, is_listed: isListed }),
      });
      const json = await res.json();
      if (res.status === 409) { setSaveError(`이미 '${json.existing_corp_name}'에 등록된 corp_code`); return; }
      if (!res.ok) throw new Error(json.error ?? '저장 실패');
      onSaved(company.id, parsed);
    } catch (e: any) { setSaveError(e.message); }
    finally { setSaving(false); }
  };

  const bizMatch = verify
    ? normBizNo(verify.bizr_no) && normBizNo(company.business_number ?? '')
      ? normBizNo(verify.bizr_no) === normBizNo(company.business_number ?? '') ? 'match' : 'mismatch'
      : 'unknown'
    : null;

  return (
    <div className="col-flex gap-10">
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        DART 코드 매핑
        {company.corp_code && (
          <span style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--slf)', background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.2)', borderRadius: 4, padding: '1px 6px', fontWeight: 400, textTransform: 'none' }}>
            ✓ {company.corp_code}
          </span>
        )}
        {company.dart_skip && (
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--f4)', fontWeight: 400 }}>건너뜀 처리됨</span>
        )}
      </div>

      <div className="row-flex gap-6">
        <button className={`btn sm${mode === 'search' ? ' active' : ''}`} onClick={() => setMode('search')}>이름 검색</button>
        <button className={`btn sm${mode === 'input'  ? ' active' : ''}`} onClick={() => setMode('input')}>직접 입력</button>
        <a href="https://dart.fss.or.kr" target="_blank" rel="noopener noreferrer"
          className="btn sm" style={{ marginLeft: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <IcArrowUR size={11} /> DART
        </a>
      </div>

      {mode === 'search' && (
        <div className="col-flex gap-8">
          <div className="row-flex gap-6">
            <div className="input row-flex center gap-6" style={{ flex: 1 }}>
              <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
              <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="DART 회사명 (Enter)"
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
            </div>
            <button className="btn sm" onClick={doSearch} disabled={searchLoading}>{searchLoading ? '…' : '검색'}</button>
          </div>
          {searchError && <div style={{ fontSize: 11, color: 'var(--shf)', padding: '5px 8px', background: 'var(--shb)', borderRadius: 4 }}>{searchError}</div>}
          {candidates.length > 0 && (
            <div className="tbl" style={{ border: '1px solid var(--bd)', borderRadius: 6 }}>
              <div className="row head" style={{ gridTemplateColumns: '1fr 90px 70px' }}>
                <span>DART 회사명</span><span>corp_code</span><span />
              </div>
              {candidates.map(c => (
                <div key={c.corp_code} className="row hover" style={{ gridTemplateColumns: '1fr 90px 70px' }}>
                  <span style={{ fontSize: 12 }}>{c.corp_name}</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>{c.corp_code}</span>
                  <span><button className="btn sm" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => selectCandidate(c)}>선택 →</button></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'input' && (
        <div className="col-flex gap-8">
          <div className="row-flex gap-6">
            <div className="input row-flex center gap-6" style={{ flex: 1 }}>
              <input autoFocus value={corpInput} onChange={e => { setCorpInput(e.target.value); setVerify(null); setVerifyError(''); }}
                onKeyDown={e => e.key === 'Enter' && doVerify()} placeholder="corp_code 8자리 또는 DART URL"
                className="mono" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
            </div>
            <button className="btn sm" onClick={() => doVerify()} disabled={verifyLoading}>{verifyLoading ? '…' : '검증'}</button>
          </div>
          {verifyError && <div style={{ fontSize: 11, color: 'var(--shf)', padding: '5px 8px', background: 'var(--shb)', borderRadius: 4 }}>{verifyError}</div>}
          {verify && (
            <div className="panel col-flex gap-8" style={{ background: 'var(--snk)' }}>
              <div className="row-flex between"><span style={{ fontSize: 11, color: 'var(--f4)', width: 80 }}>DART 회사명</span><span style={{ fontSize: 12, fontWeight: 600 }}>{verify.corp_name}</span></div>
              <div className="row-flex between">
                <span style={{ fontSize: 11, color: 'var(--f4)', width: 80 }}>사업자번호</span>
                <span className="row-flex center gap-6">
                  <span className="mono" style={{ fontSize: 12 }}>{verify.bizr_no}</span>
                  {bizMatch === 'match'    && <span style={{ fontSize: 10, color: 'var(--slf)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}><IcCheck size={11} /> 일치</span>}
                  {bizMatch === 'mismatch' && <span style={{ fontSize: 10, color: 'var(--shf)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}><IcX size={11} /> 불일치</span>}
                  {bizMatch === 'unknown'  && <span style={{ fontSize: 10, color: 'var(--f4)' }}>확인불가</span>}
                </span>
              </div>
              <div className="row-flex between"><span style={{ fontSize: 11, color: 'var(--f4)', width: 80 }}>상장 구분</span><span style={{ fontSize: 12 }}>{clsLabel(verify.corp_cls)}</span></div>
              {bizMatch === 'mismatch' && (
                <div style={{ fontSize: 11, color: 'var(--warn)', padding: '5px 8px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--warn) 20%, transparent)' }}>
                  ⚠️ 사업자번호 불일치
                </div>
              )}
              {saveError && <div style={{ fontSize: 11, color: 'var(--shf)', padding: '5px 8px', background: 'var(--shb)', borderRadius: 4 }}>{saveError}</div>}
              <div className="row-flex gap-6">
                <button className="btn sm" style={{ background: 'var(--hs)', color: 'var(--white)', borderColor: 'var(--hs)', flex: 1 }} onClick={doSave} disabled={saving}>
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

// ─── 모회사 설정 섹션 ────────────────────────────────────────────────────────
function ParentSection({ company, onSaved }: { company: UnifiedCompany; onSaved: (parentId: string | null) => void }) {
  const [q, setQ]                 = React.useState('');
  const [results, setResults]     = React.useState<CompanyOption[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [busyId, setBusyId]       = React.useState<string | null>(null);
  const [saving, setSaving]       = React.useState(false);
  const [error, setError]         = React.useState('');

  React.useEffect(() => { setQ(''); setResults([]); setError(''); }, [company.id]);

  React.useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabaseBrowser().from('companies').select('id, corp_name')
        .ilike('corp_name', `%${q.trim()}%`).neq('id', company.id).order('corp_name').limit(10);
      setResults((data ?? []) as CompanyOption[]);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, company.id]);

  const doSave = async (parentId: string | null) => {
    if (parentId) setBusyId(parentId); else setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/companies/${company.id}/parent`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_company_id: parentId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '저장 실패');
      setQ(''); setResults([]);
      onSaved(parentId);
    } catch (e: any) { setError(e.message); }
    finally { setBusyId(null); setSaving(false); }
  };

  return (
    <div className="col-flex gap-8">
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>모회사 설정</div>

      {/* 현재 모회사 */}
      {company.parent ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 5,
          background: 'var(--snk)', border: '1px solid var(--bd)' }}>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {company.parent.corp_name}
          </span>
          <button className="btn sm" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--shf)', flexShrink: 0 }}
            onClick={() => doSave(null)} disabled={saving}>{saving ? '…' : '해제'}</button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--f4)' }}>없음 (최상위)</div>
      )}

      {/* 모회사 검색 */}
      <div className="col-flex gap-4">
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>모회사 설정</div>
        <div className="input row-flex center gap-6">
          <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="회사명 검색"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
        </div>
        {searching && <div style={{ fontSize: 11, color: 'var(--f4)' }}>검색 중…</div>}
        {results.length > 0 && (
          <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden', maxHeight: 160, overflowY: 'auto' }}>
            {results.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                borderBottom: '1px solid var(--bd)' }} className="hover">
                <span style={{ flex: 1, fontSize: 12 }}>{c.corp_name}</span>
                <button className="btn sm" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }}
                  onClick={() => doSave(c.id)} disabled={busyId === c.id}>{busyId === c.id ? '…' : '설정'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--shf)' }}>{error}</div>}
    </div>
  );
}

// ─── 자회사 설정 섹션 ────────────────────────────────────────────────────────
function SubsidiarySection({ company }: { company: UnifiedCompany }) {
  const [subsidiaries, setSubsidiaries] = React.useState<CompanyOption[]>([]);
  const [loading, setLoading]           = React.useState(true);
  const [q, setQ]                       = React.useState('');
  const [results, setResults]           = React.useState<CompanyOption[]>([]);
  const [searching, setSearching]       = React.useState(false);
  const [busyIds, setBusyIds]           = React.useState<Set<string>>(new Set());

  const fetchSubs = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabaseBrowser()
      .from('companies').select('id, corp_name')
      .eq('parent_company_id', company.id).order('corp_name');
    setSubsidiaries((data ?? []) as CompanyOption[]);
    setLoading(false);
  }, [company.id]);

  React.useEffect(() => { fetchSubs(); setQ(''); setResults([]); }, [fetchSubs]);

  React.useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const subIds = new Set(subsidiaries.map(s => s.id));
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabaseBrowser().from('companies').select('id, corp_name')
        .ilike('corp_name', `%${q.trim()}%`)
        .neq('id', company.id)
        .order('corp_name').limit(10);
      setResults(((data ?? []) as CompanyOption[]).filter(c => !subIds.has(c.id)));
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, company.id, subsidiaries]);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });

  const addSub = async (child: CompanyOption) => {
    setBusy(child.id, true);
    const res = await fetch(`/api/companies/${child.id}/parent`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_company_id: company.id }),
    });
    if (res.ok) {
      setSubsidiaries(prev => [...prev, child].sort((a, b) => a.corp_name.localeCompare(b.corp_name)));
      setResults(prev => prev.filter(c => c.id !== child.id));
      setQ('');
    }
    setBusy(child.id, false);
  };

  const removeSub = async (childId: string) => {
    setBusy(childId, true);
    const res = await fetch(`/api/companies/${childId}/parent`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_company_id: null }),
    });
    if (res.ok) setSubsidiaries(prev => prev.filter(c => c.id !== childId));
    setBusy(childId, false);
  };

  return (
    <div className="col-flex gap-8">
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        자회사 목록
        {!loading && subsidiaries.length > 0 && (
          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--f4)', fontSize: 10, textTransform: 'none' }}>{subsidiaries.length}개</span>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: 'var(--f4)' }}>로딩 중…</div>
      ) : subsidiaries.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--f4)' }}>등록된 자회사 없음</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 140, overflowY: 'auto' }}>
          {subsidiaries.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 5,
              background: 'var(--snk)', border: '1px solid var(--bd)' }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--f1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.corp_name}</span>
              <button className="btn sm" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--shf)', flexShrink: 0 }}
                onClick={() => removeSub(c.id)} disabled={busyIds.has(c.id)}>{busyIds.has(c.id) ? '…' : '해제'}</button>
            </div>
          ))}
        </div>
      )}

      <div className="col-flex gap-4">
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>자회사 추가</div>
        <div className="input row-flex center gap-6">
          <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="회사명 검색"
            style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
        </div>
        {searching && <div style={{ fontSize: 11, color: 'var(--f4)' }}>검색 중…</div>}
        {results.length > 0 && (
          <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden', maxHeight: 160, overflowY: 'auto' }}>
            {results.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                cursor: 'pointer', borderBottom: '1px solid var(--bd)' }}
                className="hover">
                <span style={{ flex: 1, fontSize: 12 }}>{c.corp_name}</span>
                <button className="btn sm" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }}
                  onClick={() => addSub(c)} disabled={busyIds.has(c.id)}>{busyIds.has(c.id) ? '…' : '추가'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 브랜드 관리 섹션 ────────────────────────────────────────────────────────
interface SubCompanyBrands { id: string; corp_name: string; brands: LinkedBrand[]; }

function BrandSection({ company }: { company: UnifiedCompany }) {
  const [brands, setBrands]         = React.useState<LinkedBrand[]>([]);
  const [subGroups, setSubGroups]   = React.useState<SubCompanyBrands[]>([]);
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
    // 자사 브랜드
    const { data: mainData } = await (supabaseBrowser().from('brands')
      .select('id, name, name_eng, company_skip, company_confirmed, remark')
      .eq('company_id', company.id).not('detail_fetched_at', 'is', null).order('name') as any);
    setBrands((mainData ?? []) as LinkedBrand[]);

    // 자회사 목록 → 자회사별 브랜드
    const { data: subsData } = await supabaseBrowser()
      .from('companies').select('id, corp_name')
      .eq('parent_company_id', company.id).order('corp_name');
    const subs = (subsData ?? []) as CompanyOption[];
    if (subs.length > 0) {
      const subIds = subs.map(s => s.id);
      const { data: subBrandData } = await (supabaseBrowser().from('brands')
        .select('id, name, name_eng, company_skip, company_confirmed, remark, company_id')
        .in('company_id', subIds).not('detail_fetched_at', 'is', null).order('name') as any);
      const brandsBySubId = new Map<string, LinkedBrand[]>();
      for (const b of (subBrandData ?? [])) {
        const arr = brandsBySubId.get(b.company_id) ?? [];
        arr.push(b);
        brandsBySubId.set(b.company_id, arr);
      }
      setSubGroups(subs.map(s => ({ ...s, brands: brandsBySubId.get(s.id) ?? [] })));
    } else {
      setSubGroups([]);
    }
    setLoading(false);
  }, [company.id]);

  React.useEffect(() => { fetchBrands(); setCheckedIds(new Set()); setAddQ(''); setAddResults([]); }, [fetchBrands]);

  React.useEffect(() => {
    if (!addQ.trim()) { setAddResults([]); return; }
    const t = setTimeout(async () => {
      setAddSearching(true);
      const { data } = await (supabaseBrowser().from('brands')
        .select('id, name, name_eng, slug, company_id, companies(corp_name)')
        .or(`name.ilike.%${addQ.trim()}%,slug.ilike.%${addQ.trim()}%`)
        .not('detail_fetched_at', 'is', null)
        .or(`company_id.neq.${company.id},company_id.is.null`)
        .order('name').limit(15) as any);
      setAddResults(data ?? []);
      setAddSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [addQ, company.id]);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });

  const saveBrandRemark = async (brandId: string, v: string) => {
    setBrands(bs => bs.map(b => b.id === brandId ? { ...b, remark: v || null } : b));
    await fetch(`/api/brands/${brandId}/remark`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remark: v || null }),
    });
  };

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
    if (res.ok) { setBrands(bs => bs.filter(b => b.id !== brandId)); setCheckedIds(prev => { const n = new Set(prev); n.delete(brandId); return n; }); }
    setBusy(brandId, false);
  };

  const addBrand = async (brandId: string) => {
    setBusy(brandId, true);
    const res = await fetch(`/api/brands/${brandId}/company`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: company.id }),
    });
    if (res.ok) { await fetchBrands(); setAddResults(prev => prev.filter(b => b.id !== brandId)); }
    setBusy(brandId, false);
  };

  const batchOp = async (op: 'confirm' | 'skip' | 'unskip') => {
    const ids = [...checkedIds];
    if (!ids.length) return;
    setBatchBusy(true); setBatchError('');
    try {
      if (op === 'confirm') {
        await Promise.all(ids.filter(id => !brands.find(b => b.id === id)?.company_confirmed).map(id =>
          fetch(`/api/brands/${id}/company`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: company.id }) })
        ));
        setBrands(bs => bs.map(b => ids.includes(b.id) ? { ...b, company_confirmed: true } : b));
      } else {
        const skip = op === 'skip';
        await Promise.all(ids.filter(id => brands.find(b => b.id === id)?.company_skip !== skip).map(id =>
          fetch(`/api/brands/${id}/company-skip`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skip }) })
        ));
        setBrands(bs => bs.map(b => ids.includes(b.id) ? { ...b, company_skip: skip } : b));
      }
      setCheckedIds(new Set());
    } catch (e: any) { setBatchError(e.message); }
    finally { setBatchBusy(false); }
  };

  const allChecked   = brands.length > 0 && brands.every(b => checkedIds.has(b.id));
  const selUnconf    = [...checkedIds].filter(id => !brands.find(b => b.id === id)?.company_confirmed).length;
  const selUnskipped = [...checkedIds].filter(id => !brands.find(b => b.id === id)?.company_skip).length;
  const selSkipped   = [...checkedIds].filter(id =>  brands.find(b => b.id === id)?.company_skip).length;

  return (
    <div className="col-flex gap-10" style={{ height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--f3)', letterSpacing: '0.05em', textTransform: 'uppercase', flex: 1 }}>
          브랜드 관리
          {!loading && (
            <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--f4)', fontSize: 10, textTransform: 'none' }}>
              {brands.length}개
              {subGroups.length > 0 && ` + 자회사 ${subGroups.reduce((s, g) => s + g.brands.length, 0)}개`}
            </span>
          )}
        </div>
        <input type="checkbox" checked={allChecked} onChange={() => allChecked ? setCheckedIds(new Set()) : setCheckedIds(new Set(brands.map(b => b.id)))}
          disabled={brands.length === 0} style={{ cursor: 'pointer' }} />
        {checkedIds.size > 0 && <span style={{ fontSize: 10, color: 'var(--hs)', fontWeight: 600 }}>{checkedIds.size}개</span>}
      </div>

      {/* 연결된 브랜드 목록 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
        {loading && <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '30px 0' }}>로딩 중…</div>}
        {!loading && brands.length === 0 && subGroups.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '30px 0' }}>연결된 브랜드 없음</div>
        )}
        {brands.map(b => {
          const isChk = checkedIds.has(b.id); const isBusy = busyIds.has(b.id);
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
                  {b.name_eng && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--f4)' }}>{b.name_eng}</span>}
                  {b.company_confirmed && !b.company_skip && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--slf)' }}>✓</span>}
                </div>
                <RemarkEditor value={b.remark} onSave={v => saveBrandRemark(b.id, v)} />
              </div>
              <div className="row-flex gap-4" style={{ flexShrink: 0 }}>
                <button className="btn sm" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--slf)', opacity: b.company_confirmed ? 0.3 : 1 }}
                  onClick={() => confirmBrand(b.id)} disabled={isBusy || b.company_confirmed}>확인</button>
                <button className="btn sm" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--shf)' }}
                  onClick={() => unlinkBrand(b.id)} disabled={isBusy}>분리</button>
              </div>
            </div>
          );
        })}

        {/* 자회사 브랜드 (읽기 전용) */}
        {!loading && subGroups.map(sg => (
          <div key={sg.id}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--f4)', padding: '10px 8px 4px',
              letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ↳ {sg.corp_name}
              </span>
              <span style={{ flexShrink: 0 }}>{sg.brands.length}개</span>
            </div>
            {sg.brands.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--f4)', padding: '2px 8px 6px', fontStyle: 'italic' }}>브랜드 없음</div>
            ) : sg.brands.map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 4px 20px', borderRadius: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: b.company_skip ? 'var(--f4)' : 'var(--f2)', textDecoration: b.company_skip ? 'line-through' : 'none' }}>
                    {b.name}
                    {b.name_eng && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--f4)' }}>{b.name_eng}</span>}
                    {b.company_confirmed && !b.company_skip && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--slf)' }}>✓</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 일괄 처리 */}
      {checkedIds.size > 0 && (
        <div className="col-flex gap-6" style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
          {batchError && <div style={{ fontSize: 11, color: 'var(--shf)' }}>{batchError}</div>}
          <div className="row-flex gap-6">
            {selUnconf    > 0 && <button className="btn sm" style={{ flex: 1, fontSize: 11, color: 'var(--slf)', borderColor: 'var(--slf)' }} onClick={() => batchOp('confirm')} disabled={batchBusy}>확인 ({selUnconf})</button>}
            {selUnskipped > 0 && <button className="btn sm" style={{ flex: 1, fontSize: 11 }} onClick={() => batchOp('skip')} disabled={batchBusy}>건너뜀 ({selUnskipped})</button>}
            {selSkipped   > 0 && <button className="btn sm" style={{ flex: 1, fontSize: 11 }} onClick={() => batchOp('unskip')} disabled={batchBusy}>해제 ({selSkipped})</button>}
          </div>
        </div>
      )}

      {/* 브랜드 추가 */}
      <div className="col-flex gap-6" style={{ borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--f3)' }}>브랜드 추가</div>
        <div className="input row-flex center gap-6">
          <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
          <input value={addQ} onChange={e => setAddQ(e.target.value)} placeholder="브랜드명 검색"
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
                    <span className="mono">{b.slug}</span> · {(b.companies as any)?.corp_name ?? '회사 없음'}
                  </div>
                </div>
                <button className="btn sm" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }}
                  onClick={() => addBrand(b.id)} disabled={busyIds.has(b.id)}>{busyIds.has(b.id) ? '…' : '추가'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 직접 등록 모달 ──────────────────────────────────────────────────────────
function CreateModal({ onClose }: { onClose: () => void }) {
  const [cCorpName, setCCorpName]       = React.useState('');
  const [cBizNo, setCBizNo]             = React.useState('');
  const [cIncludeDart, setCIncludeDart] = React.useState(false);
  const [cSaving, setCSaving]           = React.useState(false);
  const [cError, setCError]             = React.useState('');
  const [cSuccess, setCSuccess]         = React.useState('');

  const [bSlug, setBSlug]                 = React.useState('');
  const [bName, setBName]                 = React.useState('');
  const [bNameEng, setBNameEng]           = React.useState('');
  const [bCompanyQ, setBCompanyQ]         = React.useState('');
  const [bCompanyResults, setBCompanyResults] = React.useState<CompanyOption[]>([]);
  const [bCompanySelected, setBCompanySelected] = React.useState<CompanyOption | null>(null);
  const [bSearching, setBSearching]       = React.useState(false);
  const [bSaving, setBSaving]             = React.useState(false);
  const [bError, setBError]               = React.useState('');
  const [bSuccess, setBSuccess]           = React.useState('');

  React.useEffect(() => {
    if (!bCompanyQ.trim()) { setBCompanyResults([]); return; }
    const t = setTimeout(async () => {
      setBSearching(true);
      const { data } = await supabaseBrowser().from('companies').select('id, corp_name')
        .ilike('corp_name', `%${bCompanyQ.trim()}%`).order('corp_name').limit(10);
      setBCompanyResults((data ?? []) as CompanyOption[]);
      setBSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [bCompanyQ]);

  const submitCompany = async () => {
    if (!cCorpName.trim()) { setCError('법인명은 필수입니다'); return; }
    setCSaving(true); setCError(''); setCSuccess('');
    try {
      const res = await fetch('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corp_name: cCorpName.trim(), business_number: cBizNo.trim() || undefined, include_dart: cIncludeDart }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '등록 실패');
      setCSuccess(`등록 완료: ${json.corp_name}`);
      setCCorpName(''); setCBizNo(''); setCIncludeDart(false);
    } catch (e: any) { setCError(e.message); }
    finally { setCSaving(false); }
  };

  const submitBrand = async () => {
    if (!bSlug.trim()) { setBError('slug은 필수입니다'); return; }
    if (!bName.trim()) { setBError('브랜드명은 필수입니다'); return; }
    setBSaving(true); setBError(''); setBSuccess('');
    try {
      const res = await fetch('/api/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: bSlug.trim(), name: bName.trim(), name_eng: bNameEng.trim() || undefined, company_id: bCompanySelected?.id }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '등록 실패');
      setBSuccess(`등록 완료: ${json.name} (${json.slug})`);
      setBSlug(''); setBName(''); setBNameEng(''); setBCompanyQ(''); setBCompanySelected(null); setBCompanyResults([]);
    } catch (e: any) { setBError(e.message); }
    finally { setBSaving(false); }
  };

  const fs: React.CSSProperties = { background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 12,
        padding: 24, display: 'flex', gap: 20, maxWidth: 720, width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none',
          cursor: 'pointer', color: 'var(--f4)', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>

        {/* 회사 등록 */}
        <div className="col-flex gap-12" style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>회사 직접 등록</div>
          <div className="col-flex gap-8">
            <div><div style={{ fontSize: 11, color: 'var(--f3)', marginBottom: 4 }}>법인명 <span style={{ color: 'var(--shf)' }}>*</span></div>
              <div className="input"><input value={cCorpName} onChange={e => setCCorpName(e.target.value)} placeholder="(주)브랜드코리아"
                onKeyDown={e => e.key === 'Enter' && submitCompany()} style={fs} /></div></div>
            <div><div style={{ fontSize: 11, color: 'var(--f3)', marginBottom: 4 }}>사업자번호 (선택)</div>
              <div className="input"><input value={cBizNo} onChange={e => setCBizNo(e.target.value)} placeholder="000-00-00000" className="mono" style={fs} /></div></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--f3)', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={cIncludeDart} onChange={e => setCIncludeDart(e.target.checked)} style={{ cursor: 'pointer' }} />
              dart_fetched_at 설정 (DART 완료 표시)
            </label>
          </div>
          {cError   && <div style={{ fontSize: 11, color: 'var(--shf)', padding: '6px 8px', background: 'var(--shb)', borderRadius: 4 }}>{cError}</div>}
          {cSuccess && <div style={{ fontSize: 11, color: 'var(--slf)', padding: '6px 8px', background: 'rgba(34,197,94,0.08)', borderRadius: 4, border: '1px solid rgba(34,197,94,0.2)' }}>{cSuccess}</div>}
          <button className="btn sm" style={{ background: 'var(--hs)', color: 'var(--white)', borderColor: 'var(--hs)' }} onClick={submitCompany} disabled={cSaving}>
            {cSaving ? '등록 중…' : '회사 등록'}
          </button>
        </div>

        <div style={{ width: 1, background: 'var(--bd)' }} />

        {/* 브랜드 등록 */}
        <div className="col-flex gap-12" style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>브랜드 직접 등록</div>
          <div className="col-flex gap-8">
            <div><div style={{ fontSize: 11, color: 'var(--f3)', marginBottom: 4 }}>slug <span style={{ color: 'var(--shf)' }}>*</span></div>
              <div className="input"><input value={bSlug} onChange={e => setBSlug(e.target.value)} placeholder="adidas" className="mono" style={fs} /></div></div>
            <div><div style={{ fontSize: 11, color: 'var(--f3)', marginBottom: 4 }}>브랜드명 <span style={{ color: 'var(--shf)' }}>*</span></div>
              <div className="input"><input value={bName} onChange={e => setBName(e.target.value)} placeholder="아디다스" style={fs} /></div></div>
            <div><div style={{ fontSize: 11, color: 'var(--f3)', marginBottom: 4 }}>영문명 (선택)</div>
              <div className="input"><input value={bNameEng} onChange={e => setBNameEng(e.target.value)} placeholder="Adidas" style={fs} /></div></div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--f3)', marginBottom: 4 }}>회사 연결 (선택)</div>
              {bCompanySelected ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--snk)', borderRadius: 6, border: '1px solid var(--bd)' }}>
                  <span style={{ fontSize: 12, flex: 1 }}>{bCompanySelected.corp_name}</span>
                  <button className="btn sm" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--shf)' }} onClick={() => { setBCompanySelected(null); setBCompanyQ(''); }}>✕</button>
                </div>
              ) : (
                <div className="col-flex gap-4">
                  <div className="input row-flex center gap-6">
                    <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
                    <input value={bCompanyQ} onChange={e => setBCompanyQ(e.target.value)} placeholder="회사명 검색" style={fs} />
                  </div>
                  {bSearching && <div style={{ fontSize: 11, color: 'var(--f4)' }}>검색 중…</div>}
                  {bCompanyResults.length > 0 && (
                    <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden' }}>
                      {bCompanyResults.map(c => (
                        <div key={c.id} className="row hover" style={{ gridTemplateColumns: '1fr', cursor: 'pointer' }}
                          onClick={() => { setBCompanySelected(c); setBCompanyQ(''); setBCompanyResults([]); }}>
                          <span style={{ fontSize: 12 }}>{c.corp_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {bError   && <div style={{ fontSize: 11, color: 'var(--shf)', padding: '6px 8px', background: 'var(--shb)', borderRadius: 4 }}>{bError}</div>}
          {bSuccess && <div style={{ fontSize: 11, color: 'var(--slf)', padding: '6px 8px', background: 'rgba(34,197,94,0.08)', borderRadius: 4, border: '1px solid rgba(34,197,94,0.2)' }}>{bSuccess}</div>}
          <button className="btn sm" style={{ background: 'var(--hs)', color: 'var(--white)', borderColor: 'var(--hs)' }} onClick={submitBrand} disabled={bSaving}>
            {bSaving ? '등록 중…' : '브랜드 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
export default function MappingPage() {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  if (isMobile) return <MobileAdminMappingView />;
  return <MappingDesktopView />;
}

function MappingDesktopView() {
  // ── 회사 목록 상태 ──────────────────────────────────────────────────────────
  const [companies, setCompanies]       = React.useState<UnifiedCompany[]>([]);
  const [total, setTotal]               = React.useState(0);
  const [page, setPage]                 = React.useState(0);
  const [search, setSearch]             = React.useState('');
  const [debouncedSearch, setDebounced] = React.useState('');
  const [loading, setLoading]           = React.useState(true);
  const [error, setError]               = React.useState('');
  const [selected, setSelected]         = React.useState<UnifiedCompany | null>(null);
  const [checkedIds, setCheckedIds]     = React.useState<Set<string>>(new Set());
  const [batchSkipping, setBatchSkipping] = React.useState(false);
  const [showCreate, setShowCreate]     = React.useState(false);
  const [showFilters, setShowFilters]   = React.useState(false);

  // ── 필터 상태 ──────────────────────────────────────────────────────────────
  const [showDone,          setShowDone]          = React.useState(false);
  const [doneOnly,          setDoneOnly]           = React.useState(false);
  const [showSkipped,       setShowSkipped]        = React.useState(false);
  const [listedOnly,        setListedOnly]         = React.useState(false);
  const [unlistedOnly,      setUnlistedOnly]       = React.useState(false);
  const [hasParent,         setHasParent]          = React.useState(false);
  const [noParent,          setNoParent]           = React.useState(false);
  const [hasSubs,           setHasSubs]            = React.useState(false);
  const [hasBrands,         setHasBrands]          = React.useState(false);
  const [noBrands,          setNoBrands]           = React.useState(false);
  const [hasUnconfirmed,    setHasUnconfirmed]     = React.useState(false);
  const [hasOwnBrands,      setHasOwnBrands]       = React.useState(false);
  const [hasSkippedBrands,  setHasSkippedBrands]   = React.useState(false);
  const [noBizNo,           setNoBizNo]            = React.useState(false);
  const [hasRemark,         setHasRemark]          = React.useState(false);

  const activeFilterCount = [
    showDone, doneOnly, showSkipped, listedOnly, unlistedOnly, hasParent, noParent, hasSubs,
    hasBrands, noBrands, hasUnconfirmed, hasOwnBrands, hasSkippedBrands, noBizNo, hasRemark,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setShowDone(false); setDoneOnly(false); setShowSkipped(false); setListedOnly(false); setUnlistedOnly(false);
    setHasParent(false); setNoParent(false); setHasSubs(false);
    setHasBrands(false); setNoBrands(false); setHasUnconfirmed(false);
    setHasOwnBrands(false); setHasSkippedBrands(false);
    setNoBizNo(false); setHasRemark(false);
    setPage(0);
  };

  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => { setCheckedIds(new Set()); }, [
    page, debouncedSearch, showDone, doneOnly, showSkipped, listedOnly, unlistedOnly,
    hasParent, noParent, hasSubs, hasBrands, noBrands, hasUnconfirmed,
    hasOwnBrands, hasSkippedBrands, noBizNo, hasRemark,
  ]);

  const fetchList = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error: err } = await supabaseBrowser().rpc('get_mapping_company_list', {
        p_limit:              PAGE_SIZE,
        p_offset:             page * PAGE_SIZE,
        p_search:             debouncedSearch.trim() || null,
        p_show_done:          showDone,
        p_done_only:          doneOnly,
        p_show_skipped:       showSkipped,
        p_listed_only:        listedOnly,
        p_unlisted_only:      unlistedOnly,
        p_has_parent:         hasParent,
        p_no_parent:          noParent,
        p_has_subs:           hasSubs,
        p_has_brands:         hasBrands,
        p_no_brands:          noBrands,
        p_has_unconfirmed:    hasUnconfirmed,
        p_has_own_brands:     hasOwnBrands,
        p_has_skipped_brands: hasSkippedBrands,
        p_no_biz_no:          noBizNo,
        p_has_remark:         hasRemark,
      } as any);
      if (err) throw err;
      const result = data as { total: number; rows: UnifiedCompany[] };
      setCompanies(result.rows ?? []); setTotal(result.total ?? 0);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [
    page, debouncedSearch, showDone, doneOnly, showSkipped, listedOnly, unlistedOnly,
    hasParent, noParent, hasSubs, hasBrands, noBrands, hasUnconfirmed,
    hasOwnBrands, hasSkippedBrands, noBizNo, hasRemark,
  ]);

  React.useEffect(() => { fetchList(); }, [fetchList]);

  const handleDartSaved = (id: string, corpCode: string) => {
    setCompanies(cs => cs.map(c => c.id === id ? { ...c, corp_code: corpCode } : c));
    setSelected(s => s?.id === id ? { ...s, corp_code: corpCode } : s);
    if (!showDone) {
      setCompanies(cs => cs.filter(c => c.id !== id));
      setTotal(t => t - 1);
      setSelected(s => s?.id === id ? null : s);
    }
  };

  const handleParentSaved = (parentId: string | null) => {
    fetchList();
    setSelected(s => s ? { ...s, parent_company_id: parentId, parent: parentId ? (companies.find(c => c.id === parentId) ?? null) as any : null } : null);
  };

  const handleBatchSkip = async (skip: boolean) => {
    const ids = [...checkedIds].filter(id => companies.find(x => x.id === id)?.dart_skip !== skip);
    if (!ids.length) { setCheckedIds(new Set()); return; }
    setBatchSkipping(true);
    try {
      await Promise.all(ids.map(id => fetch(`/api/companies/${id}/dart-skip`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skip }),
      })));
      if (skip && !showSkipped) {
        setCompanies(cs => cs.filter(c => !ids.includes(c.id)));
        setTotal(t => t - ids.length);
        setSelected(s => s && ids.includes(s.id) ? null : s);
      } else {
        setCompanies(cs => cs.map(c => ids.includes(c.id) ? { ...c, dart_skip: skip } : c));
        setSelected(s => s && ids.includes(s.id) ? { ...s, dart_skip: skip } : s);
      }
      setCheckedIds(new Set());
    } finally { setBatchSkipping(false); }
  };

  const totalPages         = Math.ceil(total / PAGE_SIZE);
  const allPageChecked     = companies.length > 0 && companies.every(c => checkedIds.has(c.id));
  const checkedSkipCount   = [...checkedIds].filter(id => companies.find(c => c.id === id)?.dart_skip === true).length;
  const checkedUnskipCount = [...checkedIds].filter(id => companies.find(c => c.id === id)?.dart_skip === false).length;
  const H = 'calc(100vh - 130px)';

  return (
    <>
      {/* 헤더 */}
      <div className="page-title">
        <h1>매핑 관리</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>
          <IcShield size={12} /> admin
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn sm" style={{ background: 'var(--hs)', color: 'var(--white)', borderColor: 'var(--hs)' }}
            onClick={() => setShowCreate(true)}>
            + 직접 등록
          </button>
        </div>
      </div>

      {/* 직접 등록 모달 */}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}

      {/* 3패널 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 380px 1fr', gap: 12, height: H, alignItems: 'flex-start' }}>

        {/* ── 패널 1: 회사 목록 ── */}
        <div className="panel col-flex gap-8" style={{ height: '100%', overflow: 'hidden' }}>
          <div className="input row-flex center gap-6">
            <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="회사명·브랜드명 검색"
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }} />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--f4)', padding: 0, fontSize: 13, lineHeight: 1, flexShrink: 0 }}>✕</button>
            )}
          </div>

          {/* 필터 토글 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setShowFilters(v => !v)}
              style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer',
                color: activeFilterCount > 0 ? 'var(--hs)' : 'var(--f3)', fontSize: 11, padding: 0, textAlign: 'left' }}>
              <span style={{ fontSize: 9, opacity: 0.7 }}>{showFilters ? '▲' : '▼'}</span>
              필터
              {activeFilterCount > 0 && (
                <span style={{ background: 'var(--hs)', color: 'var(--white)', borderRadius: 8, fontSize: 9, fontWeight: 700,
                  padding: '1px 5px', lineHeight: 1.4 }}>{activeFilterCount}</span>
              )}
            </button>
            {activeFilterCount > 0 && (
              <button onClick={resetFilters} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--f4)', padding: 0 }}>초기화</button>
            )}
          </div>

          {/* 필터 패널 */}
          {showFilters && (
            <div className="col-flex gap-10" style={{ padding: '8px 10px', background: 'var(--snk)', borderRadius: 8, border: '1px solid var(--bd)' }}>
              {/* DART 상태 */}
              <div className="col-flex gap-4">
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>DART</div>
                <FilterChk label="완료 포함" checked={showDone}    onChange={v => { setShowDone(v);    if (v) setDoneOnly(false); setPage(0); }} />
                <FilterChk label="완료만"   checked={doneOnly}    onChange={v => { setDoneOnly(v);    if (v) setShowDone(false); setPage(0); }} />
                <FilterChk label="건너뜀 포함" checked={showSkipped} onChange={v => { setShowSkipped(v); setPage(0); }} />
              </div>
              {/* 상장 */}
              <div className="col-flex gap-4">
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>상장</div>
                <FilterChk label="상장사만"   checked={listedOnly}   onChange={v => { setListedOnly(v);   if (v) setUnlistedOnly(false); setPage(0); }} />
                <FilterChk label="비상장사만" checked={unlistedOnly} onChange={v => { setUnlistedOnly(v); if (v) setListedOnly(false);   setPage(0); }} />
              </div>
              {/* 회사 구조 */}
              <div className="col-flex gap-4">
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>구조</div>
                <FilterChk label="모회사 있음"  checked={hasParent} onChange={v => { setHasParent(v); if (v) setNoParent(false); setPage(0); }} />
                <FilterChk label="최상위만"     checked={noParent}  onChange={v => { setNoParent(v);  if (v) setHasParent(false); setPage(0); }} />
                <FilterChk label="자회사 있음"  checked={hasSubs}   onChange={v => { setHasSubs(v);   setPage(0); }} />
              </div>
              {/* 브랜드 */}
              <div className="col-flex gap-4">
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>브랜드</div>
                <FilterChk label="브랜드 있음"     checked={hasBrands}        onChange={v => { setHasBrands(v);        if (v) setNoBrands(false);  setPage(0); }} />
                <FilterChk label="브랜드 없음"     checked={noBrands}         onChange={v => { setNoBrands(v);         if (v) setHasBrands(false); setPage(0); }} />
                <FilterChk label="미확인 있음"     checked={hasUnconfirmed}   onChange={v => { setHasUnconfirmed(v);   setPage(0); }} />
                <FilterChk label="자사브랜드 있음" checked={hasOwnBrands}     onChange={v => { setHasOwnBrands(v);     setPage(0); }} />
                <FilterChk label="건너뜀 있음"     checked={hasSkippedBrands} onChange={v => { setHasSkippedBrands(v); setPage(0); }} />
              </div>
              {/* 데이터 품질 */}
              <div className="col-flex gap-4">
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--f4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>데이터</div>
                <FilterChk label="사업자번호 없음" checked={noBizNo}    onChange={v => { setNoBizNo(v);    setPage(0); }} />
                <FilterChk label="메모 있음"       checked={hasRemark}  onChange={v => { setHasRemark(v);  setPage(0); }} />
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
            <input type="checkbox" checked={allPageChecked}
              onChange={() => allPageChecked ? setCheckedIds(prev => { const n = new Set(prev); companies.forEach(c => n.delete(c.id)); return n; })
                : setCheckedIds(prev => { const n = new Set(prev); companies.forEach(c => n.add(c.id)); return n; })}
              disabled={companies.length === 0} style={{ cursor: 'pointer', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--f4)', flex: 1 }}>
              {loading ? '로딩 중…' : `${total.toLocaleString()}개 · ${page + 1}/${Math.max(totalPages, 1)}p`}
            </span>
            {checkedIds.size > 0 && <span style={{ fontSize: 10, color: 'var(--hs)', fontWeight: 600 }}>{checkedIds.size}개</span>}
          </div>

          {error && <div style={{ fontSize: 11, color: 'var(--shf)' }}>{error}</div>}

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {companies.map(c => {
              const isSel = selected?.id === c.id;
              const isChk = checkedIds.has(c.id);
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 8px', borderRadius: 6,
                  background: isSel ? 'var(--hs-soft)' : isChk ? 'var(--snk)' : 'transparent', cursor: 'pointer' }}
                  onClick={() => setSelected(c)}>
                  <input type="checkbox" checked={isChk}
                    onClick={e => { e.stopPropagation(); setCheckedIds(prev => { const n = new Set(prev); isChk ? n.delete(c.id) : n.add(c.id); return n; }); }}
                    onChange={() => {}} style={{ cursor: 'pointer', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: isSel ? 600 : 400, lineHeight: 1.3,
                      color: isSel ? 'var(--hs)' : c.dart_skip ? 'var(--f4)' : 'var(--f1)',
                      textDecoration: c.dart_skip ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.corp_name}
                      {c.corp_code && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--slf)' }}>●</span>}
                    </div>
                    {c.business_number && <div className="mono" style={{ fontSize: 10, color: 'var(--f4)', opacity: 0.8 }}>{c.business_number}</div>}
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
              <div className="row-flex gap-6">
                {checkedUnskipCount > 0 && (
                  <button className="btn sm" style={{ flex: 1, fontSize: 11 }} onClick={() => handleBatchSkip(true)} disabled={batchSkipping}>
                    {batchSkipping ? '처리 중…' : `건너뜀 (${checkedUnskipCount})`}
                  </button>
                )}
                {showSkipped && checkedSkipCount > 0 && (
                  <button className="btn sm" style={{ flex: 1, fontSize: 11, color: 'var(--slf)', borderColor: 'var(--slf)' }} onClick={() => handleBatchSkip(false)} disabled={batchSkipping}>
                    {batchSkipping ? '처리 중…' : `해제 (${checkedSkipCount})`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 패널 2: DART 매핑 + 모회사 설정 ── */}
        <div className="panel col-flex gap-0" style={{ height: '100%', overflow: 'auto' }}>
          {selected ? (
            <>
              {/* 회사 정보 헤더 */}
              <div style={{ padding: '0 0 14px', borderBottom: '1px solid var(--bd)', marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--f1)', lineHeight: 1.2 }}>{selected.corp_name}</div>
                {selected.business_number && <div className="mono" style={{ fontSize: 11, color: 'var(--f4)', marginTop: 3 }}>{selected.business_number}</div>}
                <RemarkEditor value={selected.remark}
                  onSave={async v => {
                    setSelected(s => s ? { ...s, remark: v || null } : s);
                    await fetch(`/api/companies/${selected.id}/remark`, {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remark: v || null }),
                    });
                  }} />
              </div>
              <div className="col-flex gap-0" style={{ flex: 1 }}>
                <DartSection key={`dart-${selected.id}`} company={selected} onSaved={handleDartSaved} />
                <div style={{ height: 1, background: 'var(--bd)', margin: '20px 0' }} />
                <ParentSection key={`parent-${selected.id}`} company={selected} onSaved={handleParentSaved} />
                <div style={{ height: 1, background: 'var(--bd)', margin: '20px 0' }} />
                <SubsidiarySection key={`sub-${selected.id}`} company={selected} />
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--f4)' }}>
              <span style={{ fontSize: 28, opacity: 0.15 }}>←</span>
              <div style={{ fontSize: 13 }}>회사를 선택하세요</div>
              <div style={{ fontSize: 11 }}>DART 코드 매핑, 모회사·자회사 설정</div>
            </div>
          )}
        </div>

        {/* ── 패널 3: 브랜드 관리 ── */}
        <div className="panel col-flex gap-0" style={{ height: '100%', overflow: 'hidden' }}>
          {selected ? (
            <BrandSection key={`brand-${selected.id}`} company={selected} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--f4)' }}>
              <span style={{ fontSize: 28, opacity: 0.15 }}>←</span>
              <div style={{ fontSize: 13 }}>회사를 선택하세요</div>
              <div style={{ fontSize: 11 }}>브랜드 연결·확인·분리</div>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
