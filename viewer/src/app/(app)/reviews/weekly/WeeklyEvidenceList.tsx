import Link from 'next/link';
import { formatFiveStarRating } from '@/lib/rating-format';
import { formatWeeklyTime, weeklyHref, type WeeklyEvidence, type WeeklyScope } from '@/lib/weekly-review';
import styles from './weekly-review.module.css';

export default function WeeklyEvidenceList({ rows, scope, selectedIds, selectionBlocked, onToggle }: {
  rows: WeeklyEvidence[]; scope: WeeklyScope; selectedIds: string[];
  selectionBlocked: boolean; onToggle: (row: WeeklyEvidence) => void;
}) {
  return <ul className={styles.cards} aria-label="작성일이 확인된 리뷰 원문">
    {rows.map(row => <li key={row.id} className={styles.card} id={`review-${row.id}`}>
      <h3>{row.product_name}</h3>
      <div className={styles.cardMeta}>
        <span>{row.brand_name}</span><span>작성 {row.review_date} (KST)</span>
        <span>별점 {formatFiveStarRating(row.rating)}</span>
      </div>
      <p className={styles.review}>{row.review_text || '(원문 내용이 비어 있습니다)'}</p>
      {row.purchase_option && <p className={styles.muted}>구매 옵션: {row.purchase_option}</p>}
      <div className={styles.cardMeta}>
        <span>행 저장 {formatWeeklyTime(row.created_at)}</span>
        <span>원천 리뷰 ID {row.musinsa_review_id || '확인 불가'}</span>
      </div>
      <label className={styles.choice}>
        <input type="checkbox" checked={selectedIds.includes(row.id)} disabled={selectionBlocked}
          onChange={() => onToggle(row)} aria-label={`${row.product_name}, ${row.review_date} 리뷰를 검토 근거로 선택`} />
        검토 메모의 근거로 선택
      </label>
      <div className={styles.actions}>
        <Link href={weeklyHref(scope, [row.id])} scroll={false}>이 원문 링크</Link>
        {!scope.product && <Link href={weeklyHref({ ...scope, product: row.product_id })} scroll={false}>이 상품으로 좁혀 보기</Link>}
        {/^[0-9]+$/.test(row.musinsa_no) && <a href={`https://www.musinsa.com/products/${row.musinsa_no}`}
          target="_blank" rel="noopener noreferrer">무신사 상품 페이지 ↗</a>}
      </div>
    </li>)}
  </ul>;
}
