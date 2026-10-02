'use client';
import React from 'react';
import { createPortal } from 'react-dom';
import { TOUR_STEPS, clampSpotlight, positionCallout, type Rect } from '@/lib/onboarding/tour';
import { IcBookmark, IcEdit, IcSpark } from '@/components/ui/icons';
import styles from './tour.module.css';

type Props = { step: number; saveWarning: boolean; onNext: () => void; onBack: () => void; onSkip: () => void };
export default function TourOverlay({ step, saveWarning, onNext, onBack, onSkip }: Props) {
  const current = TOUR_STEPS[step];
  const dialog = React.useRef<HTMLDialogElement>(null);
  const card = React.useRef<HTMLDivElement>(null);
  const title = React.useRef<HTMLHeadingElement>(null);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [viewport, setViewport] = React.useState({ width: window.innerWidth, height: window.innerHeight, offsetTop: 0 });
  const [cardSize, setCardSize] = React.useState({ width: 380, height: 270 });
  const [missing, setMissing] = React.useState(false);
  const [questionTried, setQuestionTried] = React.useState(false);
  const [mention, setMention] = React.useState('');
  const [mentionSelected, setMentionSelected] = React.useState(false);
  const [bookmarked, setBookmarked] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // Native modal inertness blocks every underlying pointer, focus and keyboard control.
    el.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.setAttribute('data-uttu-tour-active', 'true');
    return () => { el.close(); document.body.style.overflow = overflow; document.documentElement.removeAttribute('data-uttu-tour-active'); };
  }, []);
  React.useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [step]);

  React.useLayoutEffect(() => {
    let raf = 0;
    let scrolled: Element | null = null;
    let disposed = false;
    let graceElapsed = false;
    setRect(null);
    setMissing(false);
    const measure = () => {
      raf = 0;
      if (disposed) return;
      const visual = window.visualViewport;
      setViewport({ width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight, offsetTop: visual?.offsetTop ?? 0 });
      const element = current.target ? Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${current.target}"]`)).find(el => {
        const bounds = el.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      }) : null;
      let visibleTarget: Rect | null = null;
      if (element) {
        if (scrolled !== element) {
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          scrolled = element;
        }
        const bounds = element.getBoundingClientRect();
        visibleTarget = clampSpotlight(bounds, window.innerWidth, window.innerHeight);
      }
      if (!visibleTarget) scrolled = null;
      setRect(visibleTarget);
      setMissing(!!current.target && graceElapsed && !visibleTarget);
      if (card.current) {
        const bounds = card.current.getBoundingClientRect();
        const naturalHeight = Math.max(bounds.height, card.current.scrollHeight + Math.max(0, bounds.height - card.current.clientHeight));
        setCardSize(previous => Math.abs(previous.width - bounds.width) > 1 || Math.abs(previous.height - naturalHeight) > 1 ? { width: bounds.width, height: naturalHeight } : previous);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const observer = new MutationObserver(records => {
      // Our own positioning/state updates must not cause an observer render loop.
      if (records.some(record => !dialog.current?.contains(record.target))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-tour'] });
    const resize = new ResizeObserver(schedule);
    if (card.current) resize.observe(card.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    // Follow shell panel animations, including restored AI panel preferences.
    const intervals = [0, 100, 300, 600, 1200].map(delay => window.setTimeout(schedule, delay));
    const timeout = window.setTimeout(() => { graceElapsed = true; schedule(); }, 1800);
    schedule();
    return () => {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); resize.disconnect();
      intervals.forEach(clearTimeout); clearTimeout(timeout);
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [current]);

  const position = positionCallout(rect ? { ...rect, top: rect.top - viewport.offsetTop } : null, viewport, cardSize);
  const spotlight = position.anchored ? rect : null;
  const focusables = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Stop application-wide shortcuts (including Cmd/Ctrl+K) behind the modal.
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') e.preventDefault();
    if (e.key !== 'Tab') return;
    const nodes = focusables();
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === title.current)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };

  const mask = spotlight ? [
    { top: 0, left: 0, right: 0, height: spotlight.top },
    { top: spotlight.top + spotlight.height, left: 0, right: 0, bottom: 0 },
    { top: spotlight.top, left: 0, width: spotlight.left, height: spotlight.height },
    { top: spotlight.top, left: spotlight.left + spotlight.width, right: 0, height: spotlight.height },
  ] : [{ inset: 0 }];

  return createPortal(
    <dialog ref={dialog} className={styles.overlay} aria-modal="true" aria-labelledby="uttu-tour-title" aria-describedby="uttu-tour-description" onCancel={e => { e.preventDefault(); onSkip(); }} onKeyDown={onKeyDown}>
      {mask.map((style, index) => <div key={index} className={styles.shade} style={style} aria-hidden="true" />)}
      {spotlight && <div className={styles.spotlight} style={spotlight} aria-hidden="true" />}
      {spotlight && step === 0 && <button className={styles.targetAction} style={spotlight} aria-label="UTTU AI 연습 열기" onClick={onNext} />}
      <div ref={card} className={styles.card} style={{ left: position.left, top: position.top + viewport.offsetTop, maxHeight: position.maxHeight, maxWidth: Math.max(1, viewport.width - 32) }}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>UTTU 시작 가이드 · {step + 1} / {TOUR_STEPS.length}</span>
          <button className={styles.skip} onClick={onSkip} aria-label="가이드 건너뛰기">건너뛰기 <span aria-hidden="true">×</span></button>
        </header>
        <div className={styles.progress} aria-hidden="true">{TOUR_STEPS.map((item, index) => <span key={item.id} className={index <= step ? styles.progressDone : ''} />)}</div>
        <h2 id="uttu-tour-title" ref={title} tabIndex={-1} className={styles.title}>{current.title}</h2>
        <p id="uttu-tour-description" className={styles.description}>{current.description}</p>

        {step === 1 && <section className={styles.practice} aria-label="AI 질문 연습">
          <span className={styles.badge}>연습 · AI 사용량 차감 없음</span>
          <button className={styles.sampleQuestion} onClick={() => setQuestionTried(true)}><IcSpark /> 이번 주 주목할 브랜드 알려줘</button>
          {questionTried && <div role="status" className={styles.sampleAnswer}><strong>답변 예시</strong><p>브랜드의 순위 변화와 판매 흐름을 함께 살펴볼게요. 실제 질문을 보내면 조회 가능한 데이터를 바탕으로 분석해요.</p><small>화면 설명용 예시이며 실제 분석 결과가 아닙니다</small></div>}
        </section>}
        {step === 2 && <section className={styles.practice} aria-label="메모 열기 연습">
          <span className={styles.badge}>연습용 화면</span>
          <div className={styles.sampleItem}><div><small>상품 랭킹</small><strong>동료에게 공유할 인사이트</strong></div><button className={styles.outlineButton} onClick={onNext}><IcEdit /> 메모 열기</button></div>
        </section>}
        {step === 3 && <section className={styles.practice} aria-label="멘션 연습">
          <span className={styles.badge}>연습 · 메모 저장 및 Teams 전송 없음</span>
          <label className={styles.label} htmlFor="uttu-tour-mention">연습용 메모</label>
          <textarea id="uttu-tour-mention" className={styles.textarea} value={mention} placeholder="@정호철 함께 확인해 주세요" rows={2} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={e => { setMention(e.target.value); setMentionSelected(false); }} />
          {!composing && !mentionSelected && mention.includes('@') && <button className={styles.mentionCandidate} onClick={() => { setMention('@정호철 함께 확인해 주세요'); setMentionSelected(true); }}>@정호철 <small>연습용 후보 선택</small></button>}
          {mentionSelected && <p role="status" className={styles.success}>✓ 동료 선택을 연습했어요. 실제 알림은 보내지 않았어요</p>}
          <p className={styles.hint}>실제 메모에서는 Teams 연결 상태와 전송 선택에 따라 동료에게 알림을 보내요. 메모를 저장하기 전 전송 여부를 확인하세요.</p>
        </section>}
        {step === 4 && <section className={styles.practice} aria-label="북마크 연습">
          <span className={styles.badge}>연습 · 실제 목록에는 저장되지 않음</span>
          <div className={styles.sampleItem}><div><small>샘플 상품</small><strong>UTTU 연습용 티셔츠</strong></div><button className={styles.outlineButton} aria-pressed={bookmarked} onClick={() => setBookmarked(value => !value)}><IcBookmark fill={bookmarked ? 'currentColor' : 'none'} />{bookmarked ? '저장됨' : '북마크'}</button></div>
          {bookmarked && <p className={styles.success} role="status">✓ 북마크 연습 완료! 한 번 더 누르면 해제돼요</p>}
        </section>}
        {rect && !position.anchored && <p className={styles.hint}>화면 공간이 좁아 설명을 중앙에 표시해요. 다음 단계로 계속할 수 있어요.</p>}
        {missing && <p className={styles.hint}>이 화면에서는 버튼이 보이지 않아 설명으로 안내해요. 다음 단계로 계속할 수 있어요.</p>}
        {saveWarning && <p className={styles.hint} role="status">진행 상태를 저장하지 못했어요. 연습은 계속할 수 있으며, 다음 로그인 때 다시 안내될 수 있어요.</p>}
        <footer className={styles.footer}>
          {step > 0 ? <button className={styles.back} onClick={onBack}>이전</button> : <span className={styles.hint}>약 1분 · 언제든 건너뛰기</span>}
          <button className={styles.next} onClick={onNext}>{current.action}<span aria-hidden="true">{step === TOUR_STEPS.length - 1 ? ' ✓' : ' →'}</span></button>
        </footer>
        {step === TOUR_STEPS.length - 1 && <p className={styles.replayHint}>도움말 (?)에서 언제든 시작 가이드를 다시 볼 수 있어요</p>}
      </div>
    </dialog>, document.body,
  );
}
