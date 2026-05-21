'use client';
import React from 'react';
import { IcSpark, IcChevL, IcChevR } from '../ui/icons';

const QUICK_PROMPTS_BY_ROUTE: Record<string, string[]> = {
  '/':          ['오늘의 핵심 변화 요약', '자사 영향이 큰 이상탐지', '수집 작업 점검'],
  '/ranking':   ['오늘 TOP10 핵심 변화', '여 20대에서 급등한 상품', '자사 매칭 자동 추천'],
  '/anomaly':   ['우선순위 HIGH 요약', '미해소 항목 처리 권장 순서', '유사 과거 사례'],
  '/company':   ['이 회사 핵심 신호', '산하 브랜드별 성과 정리', '자사에 미칠 영향'],
  '/brand':     ['이 브랜드 강점·약점', '자사 동종 SKU와 비교', '주력 상품 가설'],
  '/product':   ['왜 이 변화가 생겼지?', '자사 유사 SKU 매칭', '직전 90일 가격 패턴'],
  '/promo':     ['선택된 프로모션 합집합 요약', '경쟁 압박이 큰 카테고리', '자사 대응 권장안'],
  '/snap':      ['이번 스냅의 트렌드 키워드', '자사 매칭 우선순위', '재해석 가능한 룩'],
  '/magazine':  ['이 매거진의 메시지', '등장 상품 중 자사 인접', '향후 캠페인 활용'],
  '/reviews':   ['최근 부정 리뷰 패턴', '품질 이슈 클러스터', '응답 우선순위'],
  '/matching':  ['매칭 신뢰도 검토', '유사도 낮은 후보 이유', '자동 매칭 제안'],
  '/settings':  ['알림 최적화 권장', '수집 실패 작업 진단'],
  '/me':        ['이번 주 활동 패턴', '저장 필터 재사용 추천'],
};

interface Message { role: 'user' | 'ai'; text: string; error?: boolean; }

interface AiPanelProps {
  open: boolean;
  onToggle: () => void;
  context: string[];
  route: string;
}

function formatAiMessage(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) {
      return <span key={i} className="mono tnum" style={{ color: 'var(--hs)', fontWeight: 500 }}>{p.slice(1, -1)}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}

export default function AiPanel({ open, onToggle, context, route }: AiPanelProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [thinking, setThinking] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, thinking]);

  React.useEffect(() => { setMessages([]); }, [route]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || thinking) return;
    const next: Message[] = [...messages, { role: 'user', text: t }];
    setMessages(next);
    setInput('');
    setThinking(true);
    try {
      const contextLine = `현재 화면: ${context[0]} (route=${route})\n컨텍스트: ${context.slice(1).join(' · ')}`;
      const conversation = next.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
      // @ts-expect-error – window.claude injected by Claude.ai design sandbox
      const reply = await window.claude?.complete?.({
        messages: [
          { role: 'user', content: `당신은 b.cave의 UTTU — 무신사 데이터 분석 AI 어시스턴트입니다. 응답은 한국어로 간결하게 (2-4문장).\n\n${contextLine}\n\n${t}` },
          ...conversation.slice(1),
        ],
      }) ?? '(AI 패널은 실제 API 연동 후 동작합니다.)';
      setMessages(m => [...m, { role: 'ai', text: reply }]);
    } catch {
      setMessages(m => [...m, { role: 'ai', text: '응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.', error: true }]);
    } finally {
      setThinking(false);
    }
  };

  if (!open) {
    return (
      <aside className="aip collapsed" onClick={onToggle} title="UTTU AI 열기" style={{ cursor: 'pointer' }}>
        <div className="aip-head">
          <button className="toggle" title="UTTU AI"><IcChevL /></button>
        </div>
        <div className="aip-rail">
          <span className="badge">AI</span>
          <span className="vlabel">UTTU · ASK</span>
        </div>
      </aside>
    );
  }

  const quickPrompts = QUICK_PROMPTS_BY_ROUTE[route] || QUICK_PROMPTS_BY_ROUTE['/'];

  return (
    <aside className="aip">
      <div className="aip-head">
        <div className="title">
          <span style={{ color: 'var(--hs)' }}><IcSpark /></span>
          <span className="name">UTTU AI</span>
          <span className="sub">· claude · live</span>
        </div>
        <button className="toggle" onClick={onToggle} title="닫기"><IcChevR /></button>
      </div>

      <div className="aip-context">
        <span className="lbl">context</span>
        <div className="ctx">
          {context.map((c, i) => <span key={i} className="chip">{c}</span>)}
        </div>
      </div>

      <div className="aip-body" ref={bodyRef}>
        {messages.length === 0 && (
          <>
            <div className="aip-msg ai">
              <span className="role">UTTU</span>
              <div className="bubble">
                안녕하세요. 지금 보시는 화면(<span className="hs" style={{ fontWeight: 500 }}>{context[0]}</span>)에 대해 도와드릴게요. 아래 질문 중 하나를 누르거나, 자연어로 물어보세요.
              </div>
            </div>
            <div className="aip-quick">
              {quickPrompts.map((q, i) => (
                <button key={i} className="q" onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          </>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`aip-msg ${m.role}`}>
            <span className="role">{m.role === 'user' ? '정호철' : 'UTTU'}</span>
            <div className="bubble" style={m.error ? { color: 'var(--shf)' } : {}}>
              {formatAiMessage(m.text)}
            </div>
          </div>
        ))}

        {thinking && (
          <div className="aip-think">
            <span className="dot" />
            <span>thinking · {context[0]}</span>
          </div>
        )}
      </div>

      <div className="aip-foot">
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} style={{ margin: 0 }}>
          <div className="aip-input">
            <span className="arrow">↑</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="이어서 질문하세요"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--f1)',
                letterSpacing: '-0.012em',
              }}
              disabled={thinking}
            />
            <span className="kbd">⌘ ↵</span>
          </div>
        </form>
      </div>
    </aside>
  );
}
