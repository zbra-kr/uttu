import Link from 'next/link';
import { ROUTES } from '@/lib/routes';
export default function ProductComparisonLink({ productNo }: { productNo: string }) {
  return <Link className="btn sm" href={ROUTES.productCompare(productNo)} style={{ marginTop: 8 }}>가격·고객 안내 점검 →</Link>;
}
