'use client';
import React from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { IcSearch, IcCheck, IcX, IcArrowUR, IcShield } from '@/components/ui/icons';

// ─── 타입 ──────────────────────────────────────────────────────────────────
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

type Mode = 'search' | 'input';

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

// ─── 매핑 패널 ──────────────────────────────────────────────────────────────
function MappingPanel({
  company,
  onSaved,
}: {
  company: Company;
  onSaved: (id: string) => void;
}) {
  const [mode, setMode] = React.useState<Mode>('search');
  const [searchQ, setSearchQ]       = React.useState('');
  const [candidates, setCandidates] = React.useState<DartCandidate[]>([]);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [searchError, setSearchError]     = React.useState('');

  const [corpInput, setCorpInput]   = React.useState('');
  const [verify, setVerify]         = React.useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = React.useState(false);
  const [verifyError, setVerifyError]     = React.useState('');

  const [saving, setSaving]     = React.useState(false);
  const [saveError, setSaveError] = React.useState('');

  // 회사 변경 시 리셋
  React.useEffect(() => {
    setMode('search');
    setSearchQ('');
    setCandidates([]);
    setSearchError('');
    setCorpInput('');
    setVerify(null);
    setVerifyError('');
    setSaveError('');
  }, [company.id]);

  // ── Mode A: 이름 검색 ──
  const doSearch = async () => {
    if (!searchQ.trim()) return;
    setSearchLoading(true);
    setSearchError('');
    setCandidates([]);
    try {
      const res = await fetch(`/api/dart/search?q=${encodeURIComponent(searchQ.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '검색 실패');
      setCandidates(json.results ?? []);
    } catch (e: any) {
      setSearchError(e.message);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectCandidate = (c: DartCandidate) => {
    setCorpInput(c.corp_code);
    setMode('input');
    doVerify(c.corp_code);
  };

  // ── Mode B: 직접 입력 + 검증 ──
  const doVerify = async (code?: string) => {
    const raw = code ?? corpInput;
    const parsed = parseCorp(raw);
    if (!parsed || parsed.length !== 8) {
      setVerifyError('8자리 corp_code를 입력하거나 DART URL을 붙여넣으세요');
      return;
    }
    setVerifyLoading(true);
    setVerifyError('');
    setVerify(null);
    try {
      const res = await fetch(`/api/dart/verify?corp_code=${parsed}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '검증 실패');
      setVerify(json);
      setCorpInput(parsed);
    } catch (e: any) {
      setVerifyError(e.message);
    } finally {
      setVerifyLoading(false);
    }
  };

  const doSave = async () => {
    if (!verify) return;
    const parsed = parseCorp(corpInput);
    setSaving(true);
    setSaveError('');
    try {
      const isListed = ['Y', 'K', 'N'].includes(verify.corp_cls);
      const res = await fetch(`/api/companies/${company.id}/corp-code`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corp_code: parsed, is_listed: isListed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '저장 실패');
      onSaved(company.id);
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const bizMatch = verify
    ? normBizNo(verify.bizr_no) !== '' && normBizNo(company.business_number ?? '') !== ''
      ? normBizNo(verify.bizr_no) === normBizNo(company.business_number ?? '')
        ? 'match'
        : 'mismatch'
      : 'unknown'
    : null;

  return (
    <div className="col-flex gap-14" style={{ height: '100%' }}>
      {/* 선택 회사 헤더 */}
      <div className="panel" style={{ background: 'var(--snk)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: company.dart_skip ? 'var(--f4)' : 'var(--f1)' }}>
          {company.corp_name}
          {company.dart_skip && (
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--f4)', fontWeight: 400, fontStyle: 'italic' }}>건너뜀 처리됨</span>
          )}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>
          사업자번호 {company.business_number ?? '—'}
        </div>
      </div>

      {/* 모드 탭 */}
      <div className="row-flex gap-6">
        <button
          className={`btn sm${mode === 'search' ? ' active' : ''}`}
          onClick={() => setMode('search')}
        >이름 검색</button>
        <button
          className={`btn sm${mode === 'input' ? ' active' : ''}`}
          onClick={() => setMode('input')}
        >직접 입력</button>
      </div>

      {/* ── Mode A: 이름 검색 ── */}
      {mode === 'search' && (
        <div className="col-flex gap-10">
          <div className="row-flex gap-6">
            <div className="input row-flex center gap-6" style={{ flex: 1 }}>
              <IcSearch size={13} style={{ color: 'var(--f4)', flexShrink: 0 }} />
              <input
                autoFocus
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="DART 회사명 검색 (Enter)"
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }}
              />
            </div>
            <button className="btn sm" onClick={doSearch} disabled={searchLoading}>
              {searchLoading ? '검색 중…' : '검색'}
            </button>
          </div>

          {searchError && (
            <div style={{ fontSize: 11, color: 'var(--shf)', padding: '6px 8px', background: 'var(--shb)', borderRadius: 4 }}>
              {searchError}
            </div>
          )}

          {candidates.length > 0 && (
            <div className="tbl" style={{ border: '1px solid var(--bd)', borderRadius: 6 }}>
              <div className="row head" style={{ gridTemplateColumns: '1fr 90px 80px' }}>
                <span>DART 회사명</span><span>corp_code</span><span />
              </div>
              {candidates.map(c => (
                <div key={c.corp_code} className="row hover" style={{ gridTemplateColumns: '1fr 90px 80px' }}>
                  <span style={{ fontSize: 12 }}>{c.corp_name}</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>{c.corp_code}</span>
                  <span>
                    <button
                      className="btn sm"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      onClick={() => selectCandidate(c)}
                    >
                      이 회사로 →
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {!searchLoading && candidates.length === 0 && searchQ && !searchError && (
            <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '20px 0' }}>
              검색 결과가 없습니다
            </div>
          )}
        </div>
      )}

      {/* ── Mode B: 직접 입력 + 검증 ── */}
      {mode === 'input' && (
        <div className="col-flex gap-10">
          <div className="row-flex gap-6">
            <div className="input row-flex center gap-6" style={{ flex: 1 }}>
              <input
                autoFocus
                value={corpInput}
                onChange={e => { setCorpInput(e.target.value); setVerify(null); setVerifyError(''); }}
                onKeyDown={e => e.key === 'Enter' && doVerify()}
                placeholder="corp_code 8자리 또는 DART URL 붙여넣기"
                className="mono"
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }}
              />
            </div>
            <button className="btn sm" onClick={() => doVerify()} disabled={verifyLoading}>
              {verifyLoading ? '검증 중…' : '검증'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--f4)' }}>
            예) 00114956 &nbsp;·&nbsp; https://dart.fss.or.kr/corp/mvMaint.do?corp_code=00114956
          </div>

          {verifyError && (
            <div style={{ fontSize: 11, color: 'var(--shf)', padding: '6px 8px', background: 'var(--shb)', borderRadius: 4 }}>
              {verifyError}
            </div>
          )}

          {verify && (
            <div className="panel col-flex gap-8">
              <div className="row-flex between">
                <span style={{ fontSize: 11, color: 'var(--f4)', width: 90 }}>DART 회사명</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)' }}>{verify.corp_name}</span>
              </div>
              <div className="row-flex between">
                <span style={{ fontSize: 11, color: 'var(--f4)', width: 90 }}>사업자번호</span>
                <span className="row-flex center gap-6">
                  <span className="mono" style={{ fontSize: 12 }}>{verify.bizr_no}</span>
                  {bizMatch === 'match' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--slf)', fontWeight: 600 }}>
                      <IcCheck size={12} /> 일치
                    </span>
                  )}
                  {bizMatch === 'mismatch' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--shf)', fontWeight: 600 }}>
                      <IcX size={12} /> 불일치
                    </span>
                  )}
                  {bizMatch === 'unknown' && (
                    <span style={{ fontSize: 10, color: 'var(--f4)' }}>확인불가</span>
                  )}
                </span>
              </div>
              <div className="row-flex between">
                <span style={{ fontSize: 11, color: 'var(--f4)', width: 90 }}>상장 구분</span>
                <span style={{ fontSize: 12 }}>{clsLabel(verify.corp_cls)}</span>
              </div>
              {verify.stock_code?.trim() && (
                <div className="row-flex between">
                  <span style={{ fontSize: 11, color: 'var(--f4)', width: 90 }}>종목코드</span>
                  <span className="mono" style={{ fontSize: 12 }}>{verify.stock_code.trim()}</span>
                </div>
              )}
              {bizMatch === 'mismatch' && (
                <div style={{ fontSize: 11, color: '#F59E0B', padding: '6px 8px', background: 'rgba(245,158,11,0.08)', borderRadius: 4, border: '1px solid rgba(245,158,11,0.2)' }}>
                  ⚠️ 사업자번호가 일치하지 않습니다. 저장을 계속하려면 아래 버튼을 클릭하세요.
                </div>
              )}

              {saveError && (
                <div style={{ fontSize: 11, color: 'var(--shf)', padding: '6px 8px', background: 'var(--shb)', borderRadius: 4 }}>
                  {saveError}
                </div>
              )}

              <div className="row-flex gap-8" style={{ marginTop: 4 }}>
                <button
                  className="btn sm"
                  style={{ background: 'var(--hs)', color: '#fff', borderColor: 'var(--hs)', flex: 1 }}
                  onClick={doSave}
                  disabled={saving}
                >
                  {saving ? '저장 중…' : bizMatch === 'mismatch' ? '⚠️ 강제 저장' : '저장'}
                </button>
                <button className="btn sm" onClick={() => { setVerify(null); setCorpInput(''); }} disabled={saving}>
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────
export default function MappingPage() {
  const [companies, setCompanies]     = React.useState<Company[]>([]);
  const [total, setTotal]             = React.useState(0);
  const [page, setPage]               = React.useState(0);
  const [search, setSearch]           = React.useState('');
  const [debouncedSearch, setDebounced] = React.useState('');
  const [showDone, setShowDone]       = React.useState(false);
  const [showSkipped, setShowSkipped] = React.useState(false);
  const [loading, setLoading]         = React.useState(true);
  const [error, setError]             = React.useState('');
  const [selected, setSelected]       = React.useState<Company | null>(null);

  // 체크박스 선택
  const [checkedIds, setCheckedIds]   = React.useState<Set<string>>(new Set());
  const [batchSkipping, setBatchSkipping] = React.useState(false);
  const [batchError, setBatchError]   = React.useState('');

  // 검색 디바운스
  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // 페이지/필터 변경 시 체크 초기화
  React.useEffect(() => { setCheckedIds(new Set()); }, [page, debouncedSearch, showDone, showSkipped]);

  const fetchList = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let q = supabaseBrowser()
        .from('companies')
        .select('id, corp_name, business_number, dart_skip', { count: 'exact' })
        .not('dart_fetched_at', 'is', null)
        .order('corp_name')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (!showDone) q = q.is('corp_code', null);
      if (!showSkipped) q = q.eq('dart_skip', false);
      if (debouncedSearch.trim()) q = q.ilike('corp_name', `%${debouncedSearch.trim()}%`);

      const { data, error: err, count } = await q;
      if (err) throw err;
      setCompanies(data ?? []);
      setTotal(count ?? 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, showDone, showSkipped]);

  React.useEffect(() => { fetchList(); }, [fetchList]);

  const handleSaved = (id: string) => {
    setCompanies(cs => cs.filter(c => c.id !== id));
    setTotal(t => t - 1);
    setSelected(s => s?.id === id ? null : s);
    setCheckedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  // 체크박스 토글
  const toggleCheck = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 전체 선택/해제
  const allPageChecked = companies.length > 0 && companies.every(c => checkedIds.has(c.id));
  const someChecked = checkedIds.size > 0;

  const toggleAll = () => {
    if (allPageChecked) {
      setCheckedIds(prev => {
        const next = new Set(prev);
        companies.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      setCheckedIds(prev => {
        const next = new Set(prev);
        companies.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  // 일괄 건너뜀 처리
  const doBatchSkip = async (skip: boolean) => {
    const ids = [...checkedIds].filter(id => {
      const c = companies.find(x => x.id === id);
      return c ? c.dart_skip !== skip : false;
    });
    if (!ids.length) { setCheckedIds(new Set()); return; }
    setBatchSkipping(true);
    setBatchError('');
    try {
      const results = await Promise.all(
        ids.map(id =>
          fetch(`/api/companies/${id}/dart-skip`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skip }),
          }).then(r => r.json())
        )
      );
      const failed = results.filter(r => r.error);
      if (failed.length) throw new Error(`${failed.length}개 실패: ${failed[0].error}`);

      if (skip && !showSkipped) {
        // 건너뜀 처리 + 건너뜀 숨김 → 목록에서 제거
        setCompanies(cs => cs.filter(c => !ids.includes(c.id)));
        setTotal(t => t - ids.length);
        setSelected(s => s && ids.includes(s.id) ? null : s);
      } else {
        // dart_skip 상태만 업데이트
        setCompanies(cs => cs.map(c => ids.includes(c.id) ? { ...c, dart_skip: skip } : c));
        setSelected(s => s && ids.includes(s.id) ? { ...s, dart_skip: skip } : s);
      }
      setCheckedIds(new Set());
    } catch (e: any) {
      setBatchError(e.message);
    } finally {
      setBatchSkipping(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // 선택된 항목 중 건너뜀 처리 가능/해제 가능 수
  const checkedSkipCount   = [...checkedIds].filter(id => companies.find(c => c.id === id)?.dart_skip === true).length;
  const checkedUnskipCount = [...checkedIds].filter(id => companies.find(c => c.id === id)?.dart_skip === false).length;

  return (
    <>
      <div className="page-title">
        <h1>DART Corp Code 매핑</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>
          <IcShield size={12} /> admin
        </span>
        <span className="sub">DART 고유번호를 수동으로 찾아 등록</span>
        <div style={{ marginLeft: 'auto' }}>
          <span className="chip" style={{ background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)', fontSize: 11 }}>
            미처리 {total.toLocaleString()}개
          </span>
        </div>
      </div>

      <div className="row-flex gap-14" style={{ alignItems: 'flex-start', height: 'calc(100vh - 140px)' }}>
        {/* ── 좌: 목록 ── */}
        <div className="panel col-flex gap-10" style={{ width: 300, flexShrink: 0, height: '100%', overflow: 'hidden' }}>

          {/* 검색 */}
          <div className="input row-flex center gap-6">
            <IcSearch size={12} style={{ color: 'var(--f4)', flexShrink: 0 }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="회사명 검색"
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, width: '100%', color: 'var(--f1)' }}
            />
          </div>

          {/* 필터 체크박스 */}
          <div className="col-flex gap-4">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--f3)', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={showDone} onChange={e => { setShowDone(e.target.checked); setPage(0); }} style={{ cursor: 'pointer' }} />
              완료 포함 보기
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--f3)', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={showSkipped} onChange={e => { setShowSkipped(e.target.checked); setPage(0); }} style={{ cursor: 'pointer' }} />
              건너뜀 포함 보기
            </label>
          </div>

          {/* 전체선택 + 카운트 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px', borderBottom: '1px solid var(--bd)', paddingBottom: 8 }}>
            <input
              type="checkbox"
              checked={allPageChecked}
              onChange={toggleAll}
              disabled={companies.length === 0}
              title="이 페이지 전체 선택"
              style={{ cursor: 'pointer', flexShrink: 0 }}
            />
            <span style={{ fontSize: 10, color: 'var(--f4)', flex: 1 }}>
              {loading ? '로딩 중…' : error ? '' : `${total.toLocaleString()}개 · ${page + 1}/${Math.max(totalPages, 1)}p`}
            </span>
            {someChecked && (
              <span style={{ fontSize: 10, color: 'var(--hs)', fontWeight: 600 }}>
                {checkedIds.size}개 선택
              </span>
            )}
          </div>

          {error && <div style={{ fontSize: 11, color: 'var(--shf)' }}>{error}</div>}

          {/* 목록 */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {companies.map(c => {
              const isSelected = selected?.id === c.id;
              const isChecked  = checkedIds.has(c.id);
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 6px 5px 8px', borderRadius: 6,
                    background: isSelected ? 'var(--hs-soft)' : isChecked ? 'var(--snk)' : 'transparent',
                    transition: 'background 100ms',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelected(c)}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = isChecked ? 'var(--snk)' : 'var(--snk)'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = isChecked ? 'var(--snk)' : 'transparent'; }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onClick={e => toggleCheck(c.id, e)}
                    onChange={() => {}}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 400,
                      lineHeight: 1.3,
                      color: isSelected ? 'var(--hs)' : c.dart_skip ? 'var(--f4)' : 'var(--f1)',
                      textDecoration: c.dart_skip ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.corp_name}
                    </div>
                    {c.business_number && (
                      <div className="mono" style={{ fontSize: 10, color: isSelected ? 'var(--hs)' : 'var(--f4)', opacity: 0.8 }}>
                        {c.business_number}
                      </div>
                    )}
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

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="row-flex center gap-6">
              <button className="btn sm icon" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>‹</button>
              <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>{page + 1} / {totalPages}</span>
              <button className="btn sm icon" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1 || loading}>›</button>
            </div>
          )}

          {/* 일괄 건너뜀 액션 */}
          {someChecked && (
            <div className="col-flex gap-6" style={{ borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
              {batchError && (
                <div style={{ fontSize: 11, color: 'var(--shf)' }}>{batchError}</div>
              )}
              <div className="row-flex gap-6">
                {checkedUnskipCount > 0 && (
                  <button
                    className="btn sm"
                    style={{ flex: 1, fontSize: 11 }}
                    onClick={() => doBatchSkip(true)}
                    disabled={batchSkipping}
                  >
                    {batchSkipping ? '처리 중…' : `건너뜀 처리 (${checkedUnskipCount}개)`}
                  </button>
                )}
                {showSkipped && checkedSkipCount > 0 && (
                  <button
                    className="btn sm"
                    style={{ flex: 1, fontSize: 11, color: 'var(--slf)', borderColor: 'var(--slf)' }}
                    onClick={() => doBatchSkip(false)}
                    disabled={batchSkipping}
                  >
                    {batchSkipping ? '처리 중…' : `건너뜀 해제 (${checkedSkipCount}개)`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 우: 매핑 패널 ── */}
        <div className="panel" style={{ flex: 1, height: '100%', overflow: 'auto' }}>
          {selected ? (
            <MappingPanel company={selected} onSaved={handleSaved} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
              <span style={{ fontSize: 32, opacity: 0.15 }}>←</span>
              <div style={{ fontSize: 13, color: 'var(--f4)' }}>좌측 목록에서 회사를 선택하세요</div>
              <div style={{ fontSize: 11, color: 'var(--f4)' }}>이름 검색 또는 corp_code 직접 입력으로 DART와 매핑합니다</div>
              <a
                href="https://dart.fss.or.kr"
                target="_blank"
                rel="noopener noreferrer"
                className="btn sm"
                style={{ marginTop: 8, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <IcArrowUR size={12} /> DART 열기
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
