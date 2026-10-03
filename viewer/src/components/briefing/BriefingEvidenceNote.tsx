/** Scope guidance applies to stored and newly generated text; it is not a fact-check. */
export default function BriefingEvidenceNote({ audience }: { audience: string }) {
  return (
    <aside aria-label="AI 분석 읽기 안내" style={{ borderLeft: '2px solid var(--bd)', paddingLeft: 10 }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--f3)', letterSpacing: '0.04em', marginBottom: 4 }}>
        AI 분석 · 원자료 확인 필요
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--f3)' }}>
        {audience === 'cs'
          ? '리뷰 분석은 생성 당시 수집·조회된 표본 기준입니다. 전체 고객의 평가나 현재 리뷰 총수를 뜻하지 않습니다.'
          : '랭킹·조회수 변화만으로 매출·수요 증가, 콘텐츠의 인과적 효과 또는 ROI를 확인할 수 없습니다.'}
        {' '}본문의 단정적 표현도 검증된 결론으로 보지 마세요.
      </p>
    </aside>
  );
}
