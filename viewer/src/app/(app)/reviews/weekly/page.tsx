import { Suspense } from 'react';
import WeeklyReviewWorkspace from './WeeklyReviewWorkspace';

export default function WeeklyReviewPage() {
  return <Suspense fallback={<p role="status">상품 개선 검토를 여는 중…</p>}><WeeklyReviewWorkspace /></Suspense>;
}
