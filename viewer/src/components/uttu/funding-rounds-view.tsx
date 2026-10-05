'use client';
import React from 'react';
import { FundingTimeline } from './funding-timeline';
import { type FundingRoundsState } from './use-funding-rounds';

export function FundingRoundsView({ funding }: { funding: FundingRoundsState }) {
  return <>
    {funding.signedOut ? <p role="status">로그인 후 투자정보를 조회할 수 있습니다.</p> : <>
      {funding.loading && <p role="status">투자정보를 불러오는 중…</p>}
      <div>
        {funding.error && <p role="status">{funding.loaded ? '새로고침에 실패했습니다. 이전에 조회한 투자정보를 표시합니다.' : '투자정보를 불러오지 못했습니다.'}</p>}
        {(funding.loaded || funding.error) && <button key="refresh" type="button" className="btn sm" aria-disabled={funding.loading} onClick={() => { if (!funding.loading) void funding.refresh(); }}>투자정보 다시 조회</button>}
      </div>
      {funding.loaded && <FundingTimeline rounds={funding.rounds} />}
    </>}
  </>;
}
