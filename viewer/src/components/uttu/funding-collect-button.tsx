'use client';
import React from 'react';
import {
  createFundingJob,
  getLatestFundingJob,
  pollFundingJob,
  type FundingJob,
} from '@/lib/queries-funding';
import { useFundingScope } from './use-funding-scope';
import { startFundingRead, FundingReadTimeoutError } from '@/lib/funding-read';
import { fmtDate } from '@/lib/format';

interface Props {
  companyId: string;
  fundingLastCollectedAt: string | null;
  onDone?: () => void;   // 수집 완료 시 콜백 (타임라인 갱신)
}

function is7dFresh(iso: string | null): boolean {
  if (!iso) return false;
  const diffMs = Date.now() - new Date(iso).getTime();
  return diffMs < 7 * 24 * 60 * 60 * 1000;
}

export function FundingCollectButton(props: Props) {
  const scope = useFundingScope(props.companyId);
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
    <FundingCollectControl key={scope.key ?? props.companyId} {...props} scope={scope} />
    {!scope.signedOut && <button type="button" className="btn sm" aria-disabled={!scope.authError} onClick={() => { if (scope.authError) scope.retryAuth(); }}>로그인 상태 다시 조회</button>}
  </div>;
}

function FundingCollectControl({ companyId, fundingLastCollectedAt, onDone, scope }: Props & { scope: ReturnType<typeof useFundingScope> }) {
  const { key, isCurrent } = scope;
  const [job, setJob] = React.useState<FundingJob | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [cached, setCached] = React.useState<string | null>(null);
  const [forceMode, setForceMode] = React.useState(false);
  const [statusError, setStatusError] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const operation = React.useRef(0);
  const reading = React.useRef(false);
  const read = React.useRef<ReturnType<typeof startFundingRead> | null>(null);
  const completed = React.useRef(new Set<string>());
  const onDoneRef = React.useRef(onDone); onDoneRef.current = onDone;
  const isFresh = !forceMode && is7dFresh(fundingLastCollectedAt);
  const stop = React.useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const readStatus = React.useCallback(async (expectedJob?: FundingJob) => {
    if (!key || !isCurrent(key) || reading.current) return;
    stop(); const version = ++operation.current;
    const valid = () => isCurrent(key) && version === operation.current;
    setBusy(true); setMsg(null); setStatusError(false);
    const check = async (tracked: FundingJob | undefined, attempt: number): Promise<void> => {
      reading.current = true;
      const active = startFundingRead(signal => tracked ? pollFundingJob(companyId, tracked.id, signal) : getLatestFundingJob(companyId, signal));
      read.current = active;
      try {
        const next = await active.promise;
        if (!valid()) return;
        if (next && (next.company_id !== companyId || (tracked && next.id !== tracked.id))) throw new Error('Unexpected job');
        if (!next && tracked) throw new Error('Job unavailable');
        setJob(next);
        if (next?.status === 'pending' || next?.status === 'running') {
          // Attempt cap is separate from each read's 15-second UI deadline.
          if (attempt >= 75) throw new Error('Polling paused');
          timer.current = setTimeout(() => { timer.current = null; void check(next, attempt + 1); }, 4000);
        } else if (tracked && next?.status === 'done' && !completed.current.has(next.id)) {
          completed.current.add(next.id); onDoneRef.current?.();
        }
      } catch (error) {
        if (valid()) { stop(); setStatusError(true); setMsg(error instanceof FundingReadTimeoutError ? '수집 상태 조회 시간이 초과되었습니다. 상태를 다시 조회해 주세요.' : '수집 상태를 확인하지 못했습니다. 상태를 다시 조회해 주세요.'); }
      } finally {
        if (read.current === active) read.current = null;
        if (valid()) { reading.current = false; setBusy(false); }
      }
    };
    await check(expectedJob, 1);
  }, [companyId, key, isCurrent, stop]);

  React.useEffect(() => {
    void readStatus();
    const counter = operation, activeReading = reading, activeRead = read;
    return () => { counter.current++; activeReading.current = false; activeRead.current?.cancel(); activeRead.current = null; stop(); };
  }, [readStatus, stop]);

  const handleCollect = async () => {
    const key = scope.key;
    if (busy || statusError || !key || !scope.isCurrent(key)) return;
    stop(); const version = ++operation.current;
    const valid = () => scope.isCurrent(key) && version === operation.current;
    setBusy(true); setMsg(null); setJob(null); setCached(null);
    try {
      const result = await createFundingJob(companyId, forceMode);
      if (!valid()) return;
      if (result.type === 'cached') setCached(result.collectedAt);
      else if (result.type === 'error') setMsg('수집 요청을 처리하지 못했습니다.');
      else if (result.job.company_id === companyId) {
        setJob(result.job); void readStatus(result.job);
      } else { setStatusError(true); setMsg('수집 상태를 확인하지 못했습니다.'); }
    } catch {
      if (valid()) setMsg('수집 요청을 처리하지 못했습니다.');
    } finally {
      if (valid()) setBusy(false);
    }
  };

  // ── 상태 표시 ──────────────────────────────────────────────────────
  const statusLine = (() => {
    if (!job) return null;
    if (job.status === 'pending') return (
      <span style={{ fontSize: 12, color: 'var(--f3)' }}>⏳ 대기 중…</span>
    );
    if (job.status === 'running') return (
      <span style={{ fontSize: 12, color: 'var(--smf)' }}>🔄 수집 중…</span>
    );
    if (job.status === 'done') return (
      <span style={{ fontSize: 12, color: 'var(--slf)' }}>완료 — {job.rounds_found}건 수집됨</span>
    );
    if (job.status === 'failed') return (
      <span style={{ fontSize: 12, color: 'var(--shf)' }}>실패 — {job.error ?? '알 수 없는 오류'}</span>
    );
    return null;
  })();

  const cachedNotice = cached ? (
    <span style={{ fontSize: 11, color: 'var(--f3)' }}>
      저장된 최근 수집 기록 ({fmtDate(cached)})
      {!forceMode && (
        <>
          {' '}·{' '}
          <button
            onClick={() => { setForceMode(true); setCached(null); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--hs)', textDecoration: 'underline', fontFamily: 'inherit' }}
          >
            강제 재수집
          </button>
        </>
      )}
    </span>
  ) : null;

  const isRunning = job?.status === 'pending' || job?.status === 'running';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {/* 메인 버튼 */}
      <button
        className="btn sm"
        onClick={handleCollect}
        disabled={busy || isRunning || statusError || !scope.key}
        style={{
          opacity: (busy || isRunning) ? 0.6 : 1,
          cursor:  (busy || isRunning) ? 'not-allowed' : 'pointer',
        }}
      >
        {isRunning ? '수집 중…' : (isFresh && !forceMode) ? '재수집' : '투자정보 수집'}
      </button>

      {/* 최근 수집일 안내 (초기 상태, 캐시 있을 때) */}
      {!job && !cached && !msg && isFresh && fundingLastCollectedAt && (
        <span style={{ fontSize: 11, color: 'var(--f4)' }}>
          저장된 수집 기록 {fmtDate(fundingLastCollectedAt)}
          {' '}·{' '}
          <button
            onClick={() => setForceMode(true)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--f3)', textDecoration: 'underline', fontFamily: 'inherit' }}
          >
            강제 재수집
          </button>
        </span>
      )}

      {/* 캐시 반환 메시지 */}
      {cachedNotice}

      {/* 잡 진행 상태 */}
      {statusLine}

      {/* 오류 메시지 */}
      {msg && <span role="status" style={{ fontSize: 12, color: 'var(--shf)' }}>{msg}</span>}
      {scope.key && <button type="button" className="btn sm" aria-disabled={busy} onClick={() => { if (!busy) void readStatus(job ?? undefined); }}>수집 상태 다시 조회</button>}
      {scope.authError && <span role="status">로그인 상태를 확인하지 못했습니다.</span>}
      {scope.signedOut && <span role="status">로그인 후 수집 상태를 조회할 수 있습니다.</span>}
    </div>
  );
}
