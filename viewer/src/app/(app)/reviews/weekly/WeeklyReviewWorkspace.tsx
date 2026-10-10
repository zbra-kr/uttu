'use client';
import React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchOwnBrands } from '@/lib/queries';
import { createNote } from '@/lib/queries-me';
import { supabaseBrowser } from '@/lib/supabase/client';
import { restoreWeeklyDraft, serializeWeeklyDraft, weeklyDraftKey, weeklySubmissionId, type WeeklyDraft } from '@/lib/weekly-review-draft';
import { fetchWeeklyReviews, fetchWeeklyMemos, type WeeklySavedMemo, type WeeklyMemoCursor } from '@/lib/queries-weekly-review';
import { WEEKLY_EVIDENCE_LIMIT, WEEKLY_MEMO_TAG, buildWeeklyMemo, formatWeeklyTime, kstClosedWeek,
  parseWeeklyLocation, uniqueWeeklyEvidence, weeklyHref, weeklyMemoHref, weeklyPeriodError,
  type WeeklyEvidence, type WeeklyCursor, type WeeklyScope } from '@/lib/weekly-review';
import { groupLoadedWeeklyMemos, parseWeeklyMemoNextDate, type WeeklyMemoOrder } from '@/lib/weekly-memo-view';
import WeeklyEvidenceList from './WeeklyEvidenceList';
import styles from './weekly-review.module.css';

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PAGES = 10;
type ReviewState = { key: string; rows: WeeklyEvidence[]; next: WeeklyCursor | null; pages: number;
  fetchedRows: number; loading: boolean; error: string | null };
const emptyReviews = (key: string): ReviewState => ({ key, rows: [], next: null, pages: 0, fetchedRows: 0, loading: false, error: null });

export default function WeeklyReviewWorkspace() {
  const router = useRouter();
  const search = useSearchParams().toString();
  const location = React.useMemo(() => parseWeeklyLocation(new URLSearchParams(search)), [search]);
  const { scope, evidence, error: locationError } = location;
  const scopeKey = scope ? weeklyHref(scope) : '';
  const requestKey = scope ? weeklyHref(scope, evidence) : '';
  const [brands, setBrands] = React.useState<{ id: string; name: string }[]>([]);
  const [brandState, setBrandState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [brandRetry, setBrandRetry] = React.useState(0);
  const selectedBrand = brands.find(brand => brand.id === scope?.brand);
  const selectedBrandId = selectedBrand?.id;
  const [brandInput, setBrandInput] = React.useState(scope?.brand ?? '');
  const [from, setFrom] = React.useState(scope?.from ?? kstClosedWeek().from);
  const [to, setTo] = React.useState(scope?.to ?? kstClosedWeek().to);
  const [rating, setRating] = React.useState<WeeklyScope['rating']>(scope?.rating ?? 'all');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [reviewState, setReviewState] = React.useState<ReviewState>(() => emptyReviews(requestKey));
  const reviewRequest = React.useRef<{ controller: AbortController; version: number; timeout: ReturnType<typeof setTimeout> | null } | null>(null);
  const version = React.useRef(0);
  const listCache = React.useRef(new Map<string, ReviewState>());
  const [retry, setRetry] = React.useState(0);
  const [memos, setMemos] = React.useState<{ owner: string; brand: string; rows: WeeklySavedMemo[]; next: WeeklyMemoCursor | null; loading: boolean; error: string | null }>({ owner: '', brand: '', rows: [], next: null, loading: false, error: null });
  const [memoOrder, setMemoOrder] = React.useState<WeeklyMemoOrder>('latest');
  const memoRequest = React.useRef<AbortController | null>(null);
  const memoVersion = React.useRef(0);
  const [memoRetry, setMemoRetry] = React.useState(0);
  const [draftValue, setDraft] = React.useState<WeeklyDraft | null>(null);
  const [draftUser, setDraftUser] = React.useState<string | null>(null);
  const visibleMemos = memos.owner === draftUser && memos.brand === selectedBrandId ? memos.rows : [];
  const memoGroups = groupLoadedWeeklyMemos(visibleMemos, memoOrder);
  const currentDraftUser = React.useRef<string | null>(null);
  currentDraftUser.current = draftUser;
  const [draftOwner, setDraftOwner] = React.useState<string | null>(null);
  const draft = draftUser && draftOwner === draftUser ? draftValue : null;
  const [draftStorage, setDraftStorage] = React.useState<'ready' | 'unavailable'>('ready');
  const [selectionMessage, setSelectionMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ owner: string; id: string; brandName: string } | null>(null);
  const saveLock = React.useRef(false);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; ++version.current; // eslint-disable-line react-hooks/exhaustive-deps -- request generation, not a DOM ref
      reviewRequest.current?.controller.abort();
      if (reviewRequest.current?.timeout) clearTimeout(reviewRequest.current.timeout);
      reviewRequest.current = null;
    };
  }, []);

  React.useEffect(() => {
    const sb = supabaseBrowser(); let active = true; let authVersion = 0;
    const initialVersion = authVersion;
    sb.auth.getUser().then(({ data, error }) => {
      if (active && authVersion === initialVersion) setDraftUser(!error ? data.user?.id ?? null : null);
    }).catch(() => { if (active && authVersion === initialVersion) setDraftUser(null); });
    const { data: listener } = sb.auth.onAuthStateChange((_event, session) => {
      ++authVersion;
      if (active) setDraftUser(session?.user.id ?? null);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  React.useEffect(() => {
    setDraft(null); setDraftOwner(null); setSaved(null);
    if (!draftUser) return;
    try {
      const stored = sessionStorage.getItem(weeklyDraftKey(draftUser));
      const recovered = stored ? restoreWeeklyDraft(stored) : null;
      setDraft(recovered); setDraftStorage('ready');
      if (stored && !recovered) sessionStorage.removeItem(weeklyDraftKey(draftUser));
    } catch { setDraftStorage('unavailable'); }
    setDraftOwner(draftUser);
  }, [draftUser]);

  React.useEffect(() => {
    if (!draftUser || draftOwner !== draftUser) return;
    try {
      const key = weeklyDraftKey(draftUser);
      if (draft) sessionStorage.setItem(key, serializeWeeklyDraft(draft));
      else sessionStorage.removeItem(key);
      setDraftStorage('ready');
    } catch { setDraftStorage('unavailable'); }
  }, [draft, draftUser, draftOwner]);

  React.useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);

  React.useEffect(() => {
    let active = true;
    setBrandState('loading');
    fetchOwnBrands().then(rows => { if (active) { setBrands(rows); setBrandState('ready'); } })
      .catch(() => { if (active) setBrandState('error'); });
    return () => { active = false; };
  }, [brandRetry]);

  React.useEffect(() => {
    setBrandInput(scope?.brand ?? ''); setFrom(scope?.from ?? kstClosedWeek().from);
    setTo(scope?.to ?? kstClosedWeek().to); setRating(scope?.rating ?? 'all'); setFormError(null);
  }, [scope]);

  React.useEffect(() => {
    reviewRequest.current?.controller.abort();
    if (reviewRequest.current?.timeout) clearTimeout(reviewRequest.current.timeout);
    reviewRequest.current = null;
    const current = ++version.current;
    setReviewState(emptyReviews(requestKey));
    if (!scope || !selectedBrand || brandState !== 'ready') return;
    const cached = !evidence.length ? listCache.current.get(requestKey) : null;
    if (cached) { setReviewState(cached); return; }
    const controller = new AbortController();
    reviewRequest.current = { controller, version: current, timeout: null };
    setReviewState({ ...emptyReviews(requestKey), loading: true });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    reviewRequest.current.timeout = timeout;
    fetchWeeklyReviews(scope, { evidence, signal: controller.signal }).then(page => {
      if (version.current === current) setReviewState({ key: requestKey, ...page, pages: 1, loading: false, error: null });
    }).catch(() => {
      if (version.current === current) setReviewState({ ...emptyReviews(requestKey), error: '리뷰 조회가 지연되거나 실패했습니다. 0건으로 판단하지 마세요. 같은 범위로 다시 시도할 수 있습니다.' });
    }).finally(() => {
      clearTimeout(timeout);
      if (reviewRequest.current?.version === current) reviewRequest.current = null;
    });
    return () => {
      ++version.current; controller.abort(); reviewRequest.current?.controller.abort(); // eslint-disable-line react-hooks/exhaustive-deps -- invalidate whichever request is active
      if (reviewRequest.current?.timeout) clearTimeout(reviewRequest.current.timeout);
      reviewRequest.current = null; clearTimeout(timeout);
    };
    // URL is the complete immutable query contract; no hidden filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, selectedBrand?.id, brandState, retry]);

  React.useEffect(() => {
    if (!reviewState.pages || reviewState.loading || reviewState.key.includes('&evidence=')) return;
    listCache.current.delete(reviewState.key);
    listCache.current.set(reviewState.key, reviewState);
    if (listCache.current.size > 5) listCache.current.delete(listCache.current.keys().next().value!);
  }, [reviewState]);

  const readMemos = async (brand: string, owner: string, cursor: WeeklyMemoCursor | null = null) => {
    if (memoRequest.current) return;
    const current = ++memoVersion.current;
    const controller = new AbortController();
    memoRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let rejectAborted: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
    const onAbort = () => { clearTimeout(timeout); rejectAborted(controller.signal.reason); };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    setMemos(previous => cursor ? { ...previous, loading: true, error: null }
      : { owner, brand, rows: [], next: null, loading: true, error: null });
    try {
      const page = await Promise.race([fetchWeeklyMemos(brand, controller.signal, owner, cursor), aborted]);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (mounted.current && memoVersion.current === current) {
        setMemos(previous => ({ owner, brand, rows: cursor
          ? [...previous.rows, ...page.rows.filter(row => !previous.rows.some(existing => existing.id === row.id))] : page.rows,
          next: page.next, loading: false, error: null }));
      }
    } catch {
      if (mounted.current && memoVersion.current === current) setMemos(previous => ({ ...previous, loading: false,
        error: '이전 메모를 불러오지 못했습니다. 메모가 없는 것은 아닙니다.' }));
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', onAbort);
      if (memoRequest.current === controller) memoRequest.current = null;
    }
  };
  React.useEffect(() => {
    if (!selectedBrandId || !draftUser) { setMemos({ owner: '', brand: '', rows: [], next: null, loading: false, error: null }); return; }
    void readMemos(selectedBrandId, draftUser);
    return () => {
      ++memoVersion.current; memoRequest.current?.abort(); memoRequest.current = null; // eslint-disable-line react-hooks/exhaustive-deps -- invalidate active request generation
    };
    // Owner/brand change and explicit refresh after save invalidate the private list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrandId, draftUser, memoRetry]);
  const loadMoreMemos = () => {
    if (!selectedBrandId || !draftUser || memos.owner !== draftUser || memos.brand !== selectedBrandId || memos.loading) return;
    return readMemos(selectedBrandId, draftUser, memos.next);
  };

  React.useEffect(() => {
    if (!draft || draftStorage !== 'unavailable') return;
    const guard = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!anchor || event.defaultPrevented || event.button !== 0) return;
      const url = new URL(anchor.getAttribute('href')!, window.location.href);
      if (url.origin === window.location.origin && url.pathname === '/reviews/weekly') return;
      if (!window.confirm('임시 보관이 불가능해 저장하지 않은 내용이 사라질 수 있습니다. 이동할까요?')) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [draft, draftStorage]);

  const view = reviewState.key === requestKey ? reviewState : emptyReviews(requestKey);
  const draftMatches = !draft || weeklyHref(draft.scope) === scopeKey;
  const applyScope = (brand = brandInput) => {
    const problem = weeklyPeriodError(from, to);
    if (problem || !brands.some(item => item.id === brand)) { setFormError(problem ?? '브랜드를 선택해 주세요.'); return; }
    setFormError(null);
    router.push(weeklyHref({ brand, from, to, rating, product: scope?.brand === brand ? scope.product : null, at: new Date().toISOString() }), { scroll: false });
  };
  const loadNext = async () => {
    if (!scope || !view.next || view.loading || reviewRequest.current || view.pages >= MAX_PAGES) return;
    const current = ++version.current; const controller = new AbortController();
    reviewRequest.current = { controller, version: current, timeout: null };
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    reviewRequest.current.timeout = timeout;
    setReviewState(previous => ({ ...previous, loading: true, error: null }));
    try {
      const page = await fetchWeeklyReviews(scope, { cursor: view.next, signal: controller.signal });
      if (version.current === current) setReviewState(previous => ({ ...previous,
        rows: uniqueWeeklyEvidence([...previous.rows, ...page.rows]), next: page.next, pages: previous.pages + 1,
        fetchedRows: previous.fetchedRows + page.fetchedRows, loading: false, error: null }));
    } catch {
      if (version.current === current) setReviewState(previous => ({ ...previous, loading: false,
        error: '다음 원문을 불러오지 못했습니다. 이미 불러온 원문만 표시 중이며 나머지는 확인되지 않았습니다.' }));
    } finally { clearTimeout(timeout); if (reviewRequest.current?.version === current) reviewRequest.current = null; }
  };
  const toggleEvidence = (row: WeeklyEvidence) => {
    if (!scope || !selectedBrand || !draftMatches || saving || !draftUser || draftOwner !== draftUser) return;
    const initial = draft ?? { scope, brandName: selectedBrand.name, evidence: [], observation: '', nextCheck: '', nextDate: '' };
    const included = initial.evidence.some(item => item.id === row.id);
    if (!included && initial.evidence.length >= WEEKLY_EVIDENCE_LIMIT) { setSelectionMessage('메모 한 개에는 최대 10개의 원문을 선택할 수 있습니다.'); return; }
    setDraft({ ...initial, evidence: included ? initial.evidence.filter(item => item.id !== row.id) : [...initial.evidence, row] });
    setSelectionMessage(null); setSaved(null); setSaveError(null);
  };
  const saveMemo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || saveLock.current || !draftUser || draftOwner !== draftUser) return;
    let body: string;
    try { body = buildWeeklyMemo(draft); } catch { setSaveError('원문을 선택하고 관찰·다음 확인·확인일을 모두 입력해 주세요.'); return; }
    saveLock.current = true; setSaving(true); setSaveError(null);
    try {
      const submissionId = await weeklySubmissionId(draftUser, body);
      if (!mounted.current || currentDraftUser.current !== draftUser) return;
      const result = await createNote({ body, entity_type: 'brand', entity_id: draft.scope.brand,
        tags: [WEEKLY_MEMO_TAG], mentioned_user_ids: [], send_teams: false, submission_id: submissionId, expected_user_id: draftUser });
      if (!mounted.current || currentDraftUser.current !== draftUser) return;
      if (result.error || !result.data) { setSaveError('메모 저장을 확인하지 못했습니다. 입력은 유지됩니다. 같은 내용으로 재시도하면 중복 저장을 방지합니다.'); return; }
      setSaved({ owner: draftUser, id: result.data.id, brandName: draft.brandName }); setDraft(null);
      setMemoRetry(count => count + 1);
    } catch { if (mounted.current && currentDraftUser.current === draftUser) setSaveError('메모 저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.'); }
    finally { saveLock.current = false; if (mounted.current) setSaving(false); }
  };
  const missingEvidence = evidence.filter(id => !view.rows.some(row => row.id === id));

  return <main className={styles.workspace}>
    <Link href="/reviews">← 리뷰 조회로 돌아가기</Link>
    <header>
      <p className={styles.eyebrow}>상품기획 · 상품/CS의 주간 검토</p>
      <h1>이번 주 상품 개선 검토</h1>
      <p className={styles.muted}>고객이 남긴 원문을 읽고, 다음 상품 회의에서 확인할 질문을 남기세요.</p>
      <ol className={styles.steps}><li>1. 담당 브랜드 선택</li><li>2. 원문을 읽고 근거 선택</li><li>3. 관찰과 다음 확인 저장</li></ol>
    </header>
    <section className={styles.panel} aria-labelledby="weekly-scope-heading">
      <h2 id="weekly-scope-heading">검토할 범위</h2>
      <form className={styles.filters} onSubmit={event => { event.preventDefault(); applyScope(); }}>
        <label className={styles.field}>자사 브랜드
          <select value={brandInput} disabled={brandState !== 'ready'} onChange={event => { setBrandInput(event.target.value); if (event.target.value) applyScope(event.target.value); }}>
            <option value="">브랜드를 선택해 주세요</option>
            {brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>작성 시작일 (KST)<input type="date" required value={from} max={kstClosedWeek().to} onChange={event => setFrom(event.target.value)} /></label>
        <label className={styles.field}>작성 종료일 (KST)<input type="date" required value={to} max={kstClosedWeek().to} onChange={event => setTo(event.target.value)} /></label>
        <label className={styles.field}>별점 범위<select value={rating} onChange={event => setRating(event.target.value as WeeklyScope['rating'])}><option value="all">전체 별점</option><option value="low">1~2점 사례만</option><option value="high">4~5점 사례만</option></select></label>
        <button className={styles.primary} disabled={brandState !== 'ready' || !brandInput}>범위 적용</button>
      </form>
      <p className={styles.muted}>기본은 오늘을 제외한 최근 7개 작성일입니다. 원문은 최신 작성일 순이며, 낮은 별점도 급증·불량 확정이 아닌 개별 사례입니다.</p>
      {scope?.rating === 'high' && <p className={styles.muted}>4~5점 원문에서 고객이 직접 언급한 강점을 읽고, 다음 샘플에서 유지하거나 확인할 내용을 남기세요. 별점만으로 선호 이유나 매출의 원인을 판단할 수 없습니다.</p>}
      {brandState === 'loading' && <p role="status">자사 브랜드를 불러오는 중…</p>}
      {brandState === 'error' && <p role="alert">브랜드를 불러오지 못했습니다. <button className={styles.secondary} onClick={() => setBrandRetry(value => value + 1)}>다시 시도</button></p>}
      {brandState === 'ready' && brands.length === 0 && <p role="status">조회 가능한 자사 브랜드가 없습니다. 브랜드 설정을 확인해 주세요.</p>}
      {(formError || locationError) && <p role="alert" className={styles.error}>{formError || locationError}</p>}
      {scope && brandState === 'ready' && !selectedBrand && <p role="alert">연결된 브랜드를 현재 자사 브랜드 목록에서 확인할 수 없습니다. 다른 브랜드의 원문으로 대체하지 않습니다.</p>}
    </section>
    {!scope && !locationError && <section className={styles.empty} style={{ marginTop: 24 }}>
      <h2>브랜드 하나로 시작하세요</h2><p>해당 기간에 저장된 리뷰 원문을 바로 확인할 수 있습니다.<br />미리 상품을 찾거나 관심 상품을 등록할 필요는 없습니다.</p>
    </section>}
    {scope && selectedBrand && <div className={styles.layout}>
      <section aria-labelledby="weekly-evidence-heading" className={styles.stack}>
        <div>
          <h2 id="weekly-evidence-heading">{selectedBrand.name} · {evidence.length ? '연결된 원문 근거' : '이번 검토의 원문'}</h2>
          <p className={styles.muted}>작성 {scope.from} ~ {scope.to} (KST) · {scope.rating === 'low' ? '1~2점만' : scope.rating === 'high' ? '4~5점만' : '전체 별점'}{scope.product ? ' · 선택 상품만' : ' · 현재 자사 상품'}</p>
          {scope.product && <p className={styles.muted}>선택 상품: {view.rows[0]?.product_name ?? scope.product}</p>}
          <div className={styles.status}>
            조회 기준 {formatWeeklyTime(scope.at)}까지 저장된 행을 확인합니다.<br />
            수집 완전성·원천 전체 리뷰 수는 확인되지 않았습니다. 늦게 수집된 원문은 새로 조회하면 추가될 수 있고, 수정·삭제는 재열람에 반영될 수 있습니다.
          </div>
          <div className={styles.actions}>
            {evidence.length > 0 && <Link href={weeklyHref(scope)} scroll={false}>같은 범위의 원문 목록</Link>}
            {scope.product && <Link href={weeklyHref({ ...scope, product: null })} scroll={false}>같은 기간의 브랜드 원문</Link>}
            <button type="button" className={styles.secondary} onClick={() => {
              const now = new Date();
              router.push(weeklyHref({ ...scope, ...kstClosedWeek(now), at: now.toISOString() }), { scroll: false });
            }}>최근 7일로 새로 조회</button>
          </div>
        </div>
        <div aria-live="polite" aria-busy={view.loading}>
          {view.pages > 0 && <p className={styles.muted}>불러온 원문 {view.rows.length}건{view.fetchedRows !== view.rows.length ? ` (저장 행 ${view.fetchedRows}개에서 원천 ID 중복 제외)` : ''} · 이 화면에서 불러온 범위이며 브랜드 전체 건수가 아닙니다.</p>}
          {view.loading && <p role="status">{view.rows.length ? '다음 원문을 불러오는 중…' : '작성일이 확인된 원문을 불러오는 중…'}</p>}
          {view.error && <div role="alert" className={styles.status}><p>{view.error}</p><button className={styles.secondary} onClick={() => view.pages ? loadNext() : setRetry(value => value + 1)} disabled={view.loading}>같은 범위로 다시 시도</button></div>}
          {!view.loading && !view.error && view.pages > 0 && evidence.length > 0 && missingEvidence.length > 0 && <p role="status" className={styles.status}>연결된 근거 {missingEvidence.length}건을 이 범위에서 확인할 수 없습니다. 삭제·변경 또는 접근 범위를 확인해 주세요. 다른 원문으로 대체하지 않습니다.</p>}
          {!view.loading && !view.error && view.pages > 0 && view.rows.length === 0 && !evidence.length && <div className={styles.empty}><h3>이 범위에서 저장된 원문을 찾지 못했습니다</h3><p>작성 {scope.from} ~ {scope.to} (KST), {scope.rating === 'low' ? '1~2점' : scope.rating === 'high' ? '4~5점' : '전체 별점'} 조건입니다.<br />문제가 없거나 수집이 완료됐다는 뜻은 아닙니다. 위에서 기간이나 별점을 직접 바꿔 확인해 주세요.</p></div>}
        </div>
        {!draftMatches && <p role="status" className={styles.status}>다른 조회 범위의 메모를 작성 중입니다. <a href="#weekly-memo-heading">작성 중인 메모로 이동</a>해서 저장하거나 비운 뒤 새 근거를 선택해 주세요.</p>}
        {!draftUser && <p role="status" className={styles.muted}>로그인을 확인하는 동안 근거 선택을 잠시 기다려 주세요. 계속 선택할 수 없다면 다시 로그인해 주세요.</p>}
        <WeeklyEvidenceList rows={view.rows} scope={scope} selectedIds={draftMatches ? draft?.evidence.map(row => row.id) ?? [] : []}
          selectionBlocked={!draftMatches || saving || !draftUser || draftOwner !== draftUser} onToggle={toggleEvidence} />
        {selectionMessage && <p role="status">{selectionMessage}</p>}
        {view.next && !evidence.length && view.pages < MAX_PAGES && <button className={styles.secondary} onClick={loadNext} disabled={view.loading}>다음 원문 최대 30건 불러오기</button>}
        {view.next && view.pages >= MAX_PAGES && <p className={styles.status}>한 번에 불러오는 10페이지에 도달했습니다. 전체 집계가 아닙니다. 상품 또는 작성일 범위를 좁혀 이어서 확인해 주세요.</p>}
        {view.pages > 0 && !view.next && !view.loading && !view.error && view.rows.length > 0 && !evidence.length && <p className={styles.muted}>이 조회 기준·범위에서 더 불러올 저장 원문은 없습니다. 원천 수집 완료를 뜻하지는 않습니다.</p>}
      </section>
      <aside className={styles.stack} aria-label="검토 기록">
        <section className={styles.panel}>
          <h2>지난 검토에서 이어가기</h2><p className={styles.muted}>이 브랜드에서 내가 저장한 검토 메모를 최신순으로 10개씩 불러옵니다. 다음 확인일은 메모이며 자동 알림은 아닙니다.</p>
          {memos.owner === draftUser && memos.brand === scope.brand && memos.loading && <p role="status">이전 검토를 불러오는 중…</p>}
          {memos.owner === draftUser && memos.brand === scope.brand && memos.error && <p role="alert">{memos.error} <button className={styles.secondary} onClick={loadMoreMemos}>메모 다시 조회</button></p>}
          {memos.owner === draftUser && memos.brand === scope.brand && !memos.loading && !memos.error && memos.rows.length === 0 && <p className={styles.muted}>아직 이 브랜드의 상품 개선 검토 메모가 없습니다.</p>}
          <label className={styles.field}>불러온 메모 보기<select value={memoOrder} onChange={event => setMemoOrder(event.target.value as WeeklyMemoOrder)}><option value="latest">최신순</option><option value="nextDate">다음 확인일 기준</option></select></label>
          <p className={styles.muted}>현재 불러온 메모 {visibleMemos.length}개만 정리합니다. 전체 메모·할 일 수가 아니며, 확인일로 완료 여부를 판단하지 않습니다.</p>
          {memoGroups.map(group => <React.Fragment key={group.date ?? 'unknown'}>
          {memoOrder === 'nextDate' && group.rows.length > 0 && <h3>{group.date ? `다음 확인일 ${group.date}` : '다음 확인일 확인 불가'} · {group.rows.length}개</h3>}
          <ul className={styles.memoList}>{group.rows.map(memo => {
            const nextDate = parseWeeklyMemoNextDate(memo.body);
            return <li key={memo.id}>
            <time className={styles.muted}>{formatWeeklyTime(memo.created_at)}</time>
            <p className={styles.memoBody}>{memo.body.split('\n').filter(line => /^(관찰:|다음 확인:)/.test(line)).join('\n') || '검토 메모'}</p>
            <p className={styles.muted}>{nextDate ? `다음 확인일: ${nextDate}` : '다음 확인일 확인 불가'}</p>
            <div className={styles.actions}><Link href={`/me/notes/${memo.id}?view=memo`}>저장한 메모</Link>
              {weeklyMemoHref(memo.body) && <Link href={weeklyMemoHref(memo.body)!} scroll={false}>당시 근거 다시 보기</Link>}</div>
          </li>; })}</ul></React.Fragment>)}
          {memos.owner === draftUser && memos.brand === scope.brand && memos.next && <button className={styles.secondary} disabled={memos.loading} onClick={loadMoreMemos}>이전 메모 10개 더 보기</button>}
          {memos.owner === draftUser && memos.brand === scope.brand && !memos.next && !memos.loading && !memos.error && memos.rows.length > 0 && <p className={styles.muted}>더 불러올 이전 검토 메모가 없습니다.</p>}
        </section>
      </aside>
    </div>}
    <section className={styles.panel} style={{ marginTop: 24 }} aria-labelledby="weekly-memo-heading">
      <h2 id="weekly-memo-heading" tabIndex={-1}>다음 회의에 가져갈 검토 메모</h2>
      {!draft && <p className={styles.muted}>원문에서 ‘검토 메모의 근거로 선택’을 누르면 관찰과 다음 확인을 남길 수 있습니다. 자동 판단이나 외부 전송 없이 내 메모에 저장합니다.</p>}
      {saved && saved.owner === draftUser && <p role="status">{saved.brandName} 검토 메모를 저장했습니다. <Link href={`/me/notes/${saved.id}?view=memo`}>저장된 메모 보기</Link></p>}
      {draft && <form onSubmit={saveMemo} className={styles.stack}>
        <div className={styles.status}>
          {draft.brandName} · 작성 {draft.scope.from} ~ {draft.scope.to} (KST) · 조회 기준 {formatWeeklyTime(draft.scope.at)} · {draft.scope.rating === 'low' ? '1~2점' : draft.scope.rating === 'high' ? '4~5점' : '전체 별점'}<br />
          선택한 근거 {draft.evidence.length}건 / 최대 10건. 읽고 선택한 사례이며 전체 이슈 건수·비율이 아닙니다.
          {!draftMatches && <p>화면 범위가 바뀌어도 작성 중인 메모는 위 범위로 유지됩니다. 다른 범위의 근거를 더하려면 이 메모를 먼저 저장하거나 비워 주세요.</p>}
        </div>
        <ul>{draft.evidence.map(row => <li key={row.id}>
          {row.product_name} · {row.review_date} · 원천 ID {row.musinsa_review_id || '확인 불가'}{' '}
          <button type="button" className={styles.secondary} disabled={saving} onClick={() => setDraft({ ...draft, evidence: draft.evidence.filter(item => item.id !== row.id) })} aria-label={`${row.product_name} 근거 선택 해제`}>선택 해제</button>
        </li>)}</ul>
        <label className={styles.field}>읽고 확인한 관찰<textarea required maxLength={2000} value={draft.observation} disabled={saving} onChange={event => setDraft({ ...draft, observation: event.target.value })} placeholder="원문에서 확인한 내용과 아직 확인하지 못한 점을 구분해 주세요." /></label>
        <label className={styles.field}>다음에 확인할 것<textarea required maxLength={2000} value={draft.nextCheck} disabled={saving} onChange={event => setDraft({ ...draft, nextCheck: event.target.value })} placeholder="예: 상품 샘플의 마감과 상세페이지 안내를 함께 확인" /></label>
        <label className={styles.field}>다음 확인일<input type="date" required value={draft.nextDate} disabled={saving} onChange={event => setDraft({ ...draft, nextDate: event.target.value })} /></label>
        <p className={styles.muted}>브랜드·작성일·조회 기준·원문 ID·근거 링크가 메모에 함께 저장됩니다. 같은 계정에서 내용과 조회 기준이 완전히 같으면 하나의 메모로 저장됩니다. 다음 확인일에 자동 알림을 보내지는 않습니다. {draftStorage === 'ready' ? '작성 중인 내용은 이 탭에만 임시 보관되며 같은 계정으로 돌아오면 복원됩니다. 탭을 닫기 전 내 메모에 저장해 주세요.' : '이 브라우저에서 임시 보관을 사용할 수 없습니다. 다른 화면으로 이동하기 전에 내 메모에 저장해 주세요.'}</p>
        {saveError && <p role="alert">{saveError}</p>}
        <div className={styles.actions}><button className={styles.primary} disabled={saving || !draft.evidence.length}>{saving ? '저장 중…' : '내 검토 메모에 저장'}</button>
          <button type="button" className={styles.secondary} disabled={saving} onClick={() => { if (window.confirm('선택한 근거와 저장하지 않은 메모 내용을 비울까요?')) { setDraft(null); setSaveError(null); } }}>작성 내용 비우기</button>
          <Link href={weeklyHref(draft.scope, draft.evidence.map(row => row.id))} scroll={false}>선택한 근거만 다시 보기</Link>
        </div>
      </form>}
    </section>
  </main>;
}
