'use client';
import React from 'react';
import {
  createFundingJob,
  getLatestFundingJob,
  pollFundingJob,
  type FundingJob,
} from '@/lib/queries-funding';

interface Props {
  companyId: string;
  fundingLastCollectedAt: string | null;
  onDone?: () => void;   // 수집 완료 시 콜백 (타임라인 갱신)
}

function fmt(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '.');
}

function is7dFresh(iso: string | null): boolean {
  if (!iso) return false;
  const diffMs = Date.now() - new Date(iso).getTime();
  return diffMs < 7 * 24 * 60 * 60 * 1000;
}

export function FundingCollectButton({ companyId, fundingLastCollectedAt, onDone }: Props) {
  const [job,       setJob]       = React.useState<FundingJob | null>(null);
  const [busy,      setBusy]      = React.useState(false);
  const [msg,       setMsg]       = React.useState<string | null>(null);
  const [cached,    setCached]    = React.useState<string | null>(null);  // collectedAt
  const [forceMode, setForceMode] = React.useState(false);

  const isFresh = !forceMode && is7dFresh(fundingLastCollectedAt);

  // 잡 폴링
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = React.useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startPolling = React.useCallback((compId: string) => {
    stopPolling();
    timerRef.current = setInterval(async () => {
      const latest = await pollFundingJob(compId);
      if (!latest) return;
      setJob(latest);
      if (latest.status === 'done' || latest.status === 'failed') {
        stopPolling();
        setBusy(false);
        if (latest.status === 'done' && onDone) onDone();
      }
    }, 4000);
  }, [stopPolling, onDone]);

  // 마운트 시 진행 중인 잡 복원 — 다른 페이지 갔다 와도 수집중 상태 유지
  React.useEffect(() => {
    getLatestFundingJob(companyId).then((latest) => {
      if (!latest) return;
      if (latest.status === 'pending' || latest.status === 'running') {
        setJob(latest);
        setBusy(true);
        startPolling(companyId);
      }
    });
  }, [companyId, startPolling]);

  React.useEffect(() => () => stopPolling(), [stopPolling]);

  const handleCollect = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setJob(null);
    setCached(null);

    const result = await createFundingJob(companyId);

    if (result.type === 'cached' && !forceMode) {
      setCached(result.collectedAt);
      setBusy(false);
      return;
    }

    if (result.type === 'error') {
      setMsg(`오류: ${result.message}`);
      setBusy(false);
      return;
    }

    if (result.type === 'created') {
      setJob(result.job);
      startPolling(companyId);
      return;
    }

    // cached but forceMode — createFundingJob still returned cached because
    // we didn't bypass server-side; just show the date and stop
    if (result.type === 'cached') {
      setCached(result.collectedAt);
      setBusy(false);
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
      7일 내 수집 완료 ({fmt(cached)})
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
        disabled={busy || isRunning}
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
          최근 수집 {fmt(fundingLastCollectedAt)}
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
      {msg && <span style={{ fontSize: 12, color: 'var(--shf)' }}>{msg}</span>}
    </div>
  );
}
