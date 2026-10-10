import { Suspense } from 'react';
import ProductComparisonWorkspace from './ProductComparisonWorkspace';
export default function ProductComparisonPage() {
  return <Suspense fallback={<p role="status">비교 화면을 준비하는 중…</p>}><ProductComparisonWorkspace /></Suspense>;
}
