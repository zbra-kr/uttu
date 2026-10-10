'use client';
export default function ProductCategoryReadState({ status, empty, retry }: { status: string; empty: boolean; retry: () => void }) {
  if (status === 'ready' && !empty) return null;
  return <div role="status" style={{ padding: '12px 13px', color: 'var(--f4)', fontSize: 12 }}>
    <div style={{ marginBottom: 6 }}>카테고리 진입 현황</div>
    {status === 'loading' ? '카테고리 현황을 불러오는 중…' : status === 'signedout' ? '로그인 후 카테고리 현황을 확인할 수 있습니다.' : status === 'error' ? <>카테고리 현황을 불러오지 못했습니다. <button type="button" onClick={retry}>다시 시도</button></> : '저장된 카테고리 진입 기록이 없습니다.'}
  </div>;
}
