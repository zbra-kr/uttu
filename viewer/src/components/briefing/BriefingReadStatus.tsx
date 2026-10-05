'use client';
import type { BriefingReadState } from '@/hooks/useBriefingRead';

export default function BriefingReadStatus({ state, label, date, retainedLabel }: { state: BriefingReadState; label: string; date?: string; retainedLabel?: string }) {
  return <div style={{ fontSize: 12, color: 'var(--f3)' }}>
    {state.signedOut ? <p role="status">로그인 후 {label}를 조회할 수 있습니다.</p> : <>
      {state.loading && <p role="status">{date && `${date} `}{label}를 불러오는 중…</p>}
      {state.error && <p role="status">{date && `${date} `}{label} {state.timedOut ? '조회 시간이 초과되었습니다.' : '조회에 실패했습니다.'}{state.loaded ? retainedLabel ? ` ${retainedLabel}를 표시합니다.` : ` 이전에 조회한 ${date ? '같은 날짜의 ' : ''}데이터를 표시합니다.` : ' 다시 조회해 주세요.'}</p>}
      <button type="button" className="btn sm" aria-disabled={state.loading} onClick={() => { if (!state.loading) void state.retry(); }}>{label} 다시 조회</button>
    </>}
  </div>;
}
