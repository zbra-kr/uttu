'use client';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRouter } from 'next/navigation';
import { IcSpark, IcChevL, IcChevR, IcExpand, IcContract, IcClock } from '../ui/icons';
import { fetchAllowedModels, updatePreferredModel, type AllowedModel } from '@/lib/queries-me';

const QUICK_PROMPTS_BY_ROUTE: Record<string, string[]> = {
  '/':         ['오늘의 핵심 변화 요약', '자사 영향이 큰 이상탐지', '수집 작업 현황'],
  '/ranking':  ['오늘 TOP10 핵심 변화', '여성 20대 급등 상품', '자사 상위 랭킹 현황'],
  '/anomaly':  ['HIGH 이상탐지 요약', '미처리 항목 우선순위', '오늘 신규 탐지 건수'],
  '/company':  ['이 회사 핵심 지표', '산하 브랜드 성과', '자사 대비 경쟁 분석'],
  '/brand':    ['이 브랜드 강점·약점', '자사 동종 SKU 비교', '최근 랭킹 추이'],
  '/product':  ['이 상품 변화 원인', '자사 유사 SKU 비교', '최근 가격 패턴'],
  '/promo':    ['현재 진행 프로모션 요약', '경쟁 압박 카테고리', '자사 대응 권장안'],
  '/snap':     ['이번 스냅 트렌드 키워드', '자사 매칭 우선순위', '인기 스타일 분석'],
  '/magazine': ['최근 기사 트렌드', '자사 브랜드 언급 현황', '캠페인 활용 아이디어'],
  '/reviews':  ['최근 부정 리뷰 패턴', '품질 이슈 클러스터', '응답 우선 순위'],
  '/companies':['자사 보유 법인 목록', '재무 데이터 있는 경쟁사', '매출 TOP5 회사'],
};

const ROUTE_LABEL: Record<string, string> = {
  '/': '홈', '/ranking': '랭킹', '/brand': '브랜드', '/product': '상품',
  '/company': '회사', '/promo': '프로모션', '/snap': '스냅', '/magazine': '매거진',
  '/reviews': '리뷰', '/anomaly': '이상탐지', '/companies': '회사목록',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 3600000)    return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000)   return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

// ── SSE 이벤트 타입 ───────────────────────────────────────────────────────────
type SseEvent =
  | { type: 'delta';     text: string }
  | { type: 'tool_call'; name: string; label: string }
  | { type: 'navigate';  path: string; reason: string }
  | { type: 'error';     message: string }
  | { type: 'done' };

interface ToolCall   { name: string; label: string }
interface Message    { role: 'user' | 'ai'; text: string; error?: boolean; toolCalls?: ToolCall[] }
interface AiSession  { id: string; title: string | null; route: string; started_at: string; message_count: number | null }

// ── Markdown 렌더링 ───────────────────────────────────────────────────────────

const BlockCodeCtx = React.createContext(false);

function MdCode({ children, className }: { children?: React.ReactNode; className?: string }) {
  const inPre = React.useContext(BlockCodeCtx);
  if (inPre) {
    return (
      <code className={className} style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }}>
        {children}
      </code>
    );
  }
  return (
    <code style={{
      fontFamily: 'var(--mono)', fontSize: 11,
      color: 'var(--hs)', background: 'var(--hs-soft)',
      padding: '1px 4px', borderRadius: 3,
    }}>
      {children}
    </code>
  );
}

const PRE_S: React.CSSProperties = {
  background: 'var(--snk)', border: '0.5px solid var(--bs)',
  borderRadius: 6, padding: '10px 12px',
  overflowX: 'auto', margin: '6px 0',
  fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6,
  color: 'var(--f1)', whiteSpace: 'pre',
};

const MD_COMPONENTS = {
  table: ({ children }: any) => (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: any) => <thead style={{ background: 'var(--snk)', borderBottom: '1.5px solid var(--bd)' }}>{children}</thead>,
  tbody: ({ children }: any) => <tbody>{children}</tbody>,
  tr:    ({ children }: any) => <tr style={{ borderBottom: '0.5px solid var(--bs)' }}>{children}</tr>,
  th:    ({ children }: any) => (
    <th style={{
      padding: '5px 12px', textAlign: 'left', fontWeight: 600,
      color: 'var(--f3)', fontFamily: 'var(--mono)', fontSize: 10,
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
      borderRight: '0.5px solid var(--bs)',
    }}>
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td style={{
      padding: '6px 12px', color: 'var(--f1)',
      verticalAlign: 'top', lineHeight: '18px',
      borderRight: '0.5px solid var(--bs)',
    }}>
      {children}
    </td>
  ),
  pre: ({ children }: any) => (
    <BlockCodeCtx.Provider value={true}>
      <pre style={PRE_S}>{children}</pre>
    </BlockCodeCtx.Provider>
  ),
  code: MdCode,
  h1: ({ children }: any) => <div style={{ fontWeight: 700, fontSize: 15, margin: '12px 0 5px', color: 'var(--f1)', lineHeight: 1.3 }}>{children}</div>,
  h2: ({ children }: any) => <div style={{ fontWeight: 600, fontSize: 13, margin: '10px 0 4px', color: 'var(--f1)', borderBottom: '0.5px solid var(--bs)', paddingBottom: 4 }}>{children}</div>,
  h3: ({ children }: any) => <div style={{ fontWeight: 600, fontSize: 12, margin: '8px 0 2px', color: 'var(--f2)' }}>{children}</div>,
  ul: ({ children }: any) => <ul style={{ paddingLeft: 18, margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ paddingLeft: 18, margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</ol>,
  li: ({ children }: any) => <li style={{ lineHeight: '20px', color: 'var(--f1)' }}>{children}</li>,
  p:  ({ children }: any) => <p style={{ margin: '4px 0', lineHeight: '20px' }}>{children}</p>,
  blockquote: ({ children }: any) => (
    <blockquote style={{
      borderLeft: '3px solid var(--hs)', paddingLeft: 12,
      margin: '6px 0', color: 'var(--f2)', fontStyle: 'italic',
    }}>
      {children}
    </blockquote>
  ),
  hr:     () => <hr style={{ border: 'none', borderTop: '0.5px solid var(--bs)', margin: '10px 0' }} />,
  strong: ({ children }: any) => <strong style={{ fontWeight: 600, color: 'var(--f1)' }}>{children}</strong>,
  em:     ({ children }: any) => <em style={{ fontStyle: 'italic', color: 'var(--f2)' }}>{children}</em>,
  del:    ({ children }: any) => <del style={{ opacity: 0.5 }}>{children}</del>,
  a:      ({ children, href }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ color: 'var(--hs)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
      {children}
    </a>
  ),
};

const TOOL_ICON: Record<string, string> = { query_db: '🔍', web_search: '🌐', navigate: '📍' };

const BETA_S: React.CSSProperties = {
  fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
  padding: '1px 5px', borderRadius: 3,
  background: 'var(--hs-soft)', color: 'var(--hs)',
  border: '0.5px solid var(--hs)', lineHeight: 1.6,
};

// ── Quota 상태 타입 ───────────────────────────────────────────────────────────
interface QuotaState {
  is_blocked:    boolean;
  limit_monthly: number | null;
  limit_daily:   number | null;
  used_monthly:  number;
  used_today:    number;
  note:          string | null;
}

// ── AiPanel ───────────────────────────────────────────────────────────────────
interface AiPanelProps { open: boolean; onToggle: () => void; context: string[]; route: string }

export default function AiPanel({ open, onToggle, context, route }: AiPanelProps) {
  const [messages,     setMessages]     = React.useState<Message[]>([]);
  const [input,        setInput]        = React.useState('');
  const [thinking,     setThinking]     = React.useState(false);
  const [fullscreen,   setFullscreen]   = React.useState(false);
  const [sessionId,    setSessionId]    = React.useState<string>(() => crypto.randomUUID());
  const [showHistory,  setShowHistory]  = React.useState(false);
  const [sessions,     setSessions]     = React.useState<AiSession[]>([]);
  const [histLoading,  setHistLoading]  = React.useState(false);
  const [quota,        setQuota]        = React.useState<QuotaState | null>(null);
  const [models,       setModels]       = React.useState<AllowedModel[]>([]);
  const [currentModel, setCurrentModel] = React.useState<string | null>(null);
  const bodyRef     = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const abortRef    = React.useRef<AbortController | null>(null);
  const router   = useRouter();

  const fetchQuota = React.useCallback(async () => {
    try {
      const res  = await fetch('/api/ai/quota');
      if (!res.ok) return;
      const data = await res.json() as {
        quota: { monthly_token_limit: number | null; daily_token_limit: number | null; is_blocked: boolean; note: string | null };
        usage: { used_today: number; used_monthly: number };
      };
      setQuota({
        is_blocked:    data.quota.is_blocked,
        limit_monthly: data.quota.monthly_token_limit,
        limit_daily:   data.quota.daily_token_limit,
        used_monthly:  data.usage.used_monthly,
        used_today:    data.usage.used_today,
        note:          data.quota.note,
      });
    } catch {
      // quota 조회 실패는 무시 — AI 사용은 계속 허용
    }
  }, []);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, thinking]);

  // textarea 자동 높이 — 최대 8줄
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxH = 19 * 8;
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }, [input]);

  // 패널 열릴 때 quota + 모델 목록 조회
  React.useEffect(() => {
    if (!open) return;
    fetchQuota();
    fetchAllowedModels().then(({ models: ms, current }) => {
      setModels(ms);
      setCurrentModel(current);
    });
  }, [open, fetchQuota]);

  // 라우트 변경 시 히스토리 드로어만 닫기 (대화는 유지)
  React.useEffect(() => {
    setShowHistory(false);
  }, [route]);

  // Escape 키 → 히스토리 먼저 닫고, 그 다음 전체화면
  React.useEffect(() => {
    document.documentElement.classList.toggle('aip-fs', fullscreen);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showHistory) { setShowHistory(false); return; }
      if (fullscreen)  { setFullscreen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (!fullscreen) document.documentElement.classList.remove('aip-fs');
    };
  }, [fullscreen, showHistory]);

  // ── 히스토리 드로어 ───────────────────────────────────────────────────────
  const openHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    setHistLoading(true);
    try {
      const res = await fetch('/api/ai/sessions');
      const data = await res.json() as { sessions: AiSession[] };
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setHistLoading(false);
    }
  };

  const loadSession = async (session: AiSession) => {
    if (thinking) return;
    setShowHistory(false);
    try {
      const res = await fetch(`/api/ai/messages?sessionId=${session.id}`);
      const data = await res.json() as { messages: Array<{ role: string; content: string; tool_calls?: ToolCall[] }> };
      const msgs: Message[] = (data.messages ?? []).map(m => ({
        role:      m.role === 'assistant' ? 'ai' : 'user',
        text:      m.content ?? '',
        toolCalls: m.tool_calls ?? undefined,
      }));
      setMessages(msgs);
      setSessionId(session.id);
    } catch {}
  };

  const newSession = () => {
    setMessages([]);
    setSessionId(crypto.randomUUID());
    setShowHistory(false);
  };

  const handleModelChange = async (model_id: string) => {
    setCurrentModel(model_id);
    await updatePreferredModel(model_id);
  };

  // ── 메시지 스트리밍 ───────────────────────────────────────────────────────
  const appendAiDelta = (text: string) =>
    setMessages(prev => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'ai') next[next.length - 1] = { ...last, text: last.text + text };
      return next;
    });

  const appendToolCall = (tc: ToolCall) =>
    setMessages(prev => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'ai') {
        next[next.length - 1] = { ...last, toolCalls: [...(last.toolCalls ?? []), tc] };
      }
      return next;
    });

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || thinking) return;

    const userMsg: Message = { role: 'user', text: t };
    const history = [...messages, userMsg];
    setMessages([...history, { role: 'ai', text: '' }]);
    setInput('');
    setThinking(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, text: m.text })),
          context,
          route,
          sessionId,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          const ev: SseEvent = JSON.parse(part.slice(6));
          if (ev.type === 'delta')     { appendAiDelta(ev.text); }
          if (ev.type === 'tool_call') { appendToolCall({ name: ev.name, label: ev.label }); }
          if (ev.type === 'navigate')  { router.push(ev.path); }
          if (ev.type === 'error') {
            setMessages(prev => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'ai') next[next.length - 1] = { ...last, text: last.text || `오류: ${ev.message}`, error: true };
              return next;
            });
          }
          if (ev.type === 'done') break;
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'ai' && !last.text) {
          next[next.length - 1] = { ...last, text: '응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.', error: true };
        }
        return next;
      });
    } finally {
      setThinking(false);
      abortRef.current = null;
      fetchQuota();
    }
  };

  // ── 닫힌 상태 ────────────────────────────────────────────────────────────────
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

  const quickPrompts = QUICK_PROMPTS_BY_ROUTE[route] ?? QUICK_PROMPTS_BY_ROUTE['/'];

  const fsStyle: React.CSSProperties = fullscreen ? {
    position: 'fixed',
    top: 0, bottom: 0,
    left: 'var(--sb-w)', right: 0,
    zIndex: 100,
    width: 'auto', maxWidth: 'none', borderLeft: '0.5px solid var(--bs)',
  } : {};

  return (
    <aside className={`aip${fullscreen ? ' fullscreen' : ''}`} style={fsStyle}>

      {/* 헤더 */}
      <div className="aip-head">
        <div className="title">
          <span style={{ color: 'var(--hs)' }}><IcSpark /></span>
          <span className="name">UTTU AI</span>
          <span style={BETA_S}>BETA</span>
          {models.length > 1 ? (
            <select
              value={currentModel ?? ''}
              onChange={e => handleModelChange(e.target.value)}
              disabled={thinking}
              style={{
                fontSize: 10, padding: '2px 5px',
                background: 'var(--snk)', border: '0.5px solid var(--bd)',
                borderRadius: 3, color: 'var(--f3)', fontFamily: 'var(--mono)',
                cursor: thinking ? 'not-allowed' : 'pointer', maxWidth: 120,
              }}
            >
              {models.map(m => (
                <option key={m.id} value={m.model_id}>{m.display_name}</option>
              ))}
            </select>
          ) : (
            <span className="sub">with {models[0]?.display_name ?? 'claude'}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className={`toggle${showHistory ? ' active' : ''}`}
            onClick={openHistory}
            title="이전 대화"
          >
            <IcClock />
          </button>
          <button
            className="toggle"
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? '기본 보기 (Esc)' : '전체화면'}
          >
            {fullscreen ? <IcContract /> : <IcExpand />}
          </button>
          <button className="toggle" onClick={() => { setFullscreen(false); onToggle(); }} title="닫기">
            <IcChevR />
          </button>
        </div>
      </div>

      {/* 대화 기록 드로어 */}
      <div className={`aip-hist${showHistory ? ' open' : ''}`}>
        <div className="aip-hist-head">
          <span className="aip-hist-title">이전 대화</span>
          <button className="btn sm" onClick={newSession}>+ 새 대화</button>
        </div>
        <div className="aip-hist-body">
          {histLoading ? (
            <div className="aip-hist-empty">불러오는 중…</div>
          ) : sessions.length === 0 ? (
            <div className="aip-hist-empty">저장된 대화가 없어요</div>
          ) : sessions.map(s => {
            const routePath  = s.route.split('?')[0];
            const routeLabel = ROUTE_LABEL[routePath] ?? routePath;
            const turnCount  = s.message_count ? Math.floor(s.message_count / 2) : 0;
            return (
              <button
                key={s.id}
                className={`aip-hist-item${s.id === sessionId ? ' active' : ''}`}
                onClick={() => loadSession(s)}
              >
                <div className="aip-hist-item-title">{s.title ?? '(제목 없음)'}</div>
                <div className="aip-hist-item-meta">
                  <span className="chip">{routeLabel}</span>
                  {turnCount > 0 && <span>{turnCount}번 대화</span>}
                  <span style={{ marginLeft: 'auto' }}>{fmtDate(s.started_at)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 컨텍스트 칩 */}
      <div className="aip-context">
        <span className="lbl">context</span>
        <div className="ctx">
          {context.map((c, i) => <span key={i} className="chip">{c}</span>)}
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="aip-body" ref={bodyRef}>
        {messages.length === 0 && (
          <>
            <div className="aip-msg ai aip-centered">
              <span className="role">UTTU</span>
              <div className="bubble">
                안녕하세요. <span className="hs" style={{ fontWeight: 500 }}>{context[0]}</span> 화면에서 무엇이든 물어보세요. 데이터 조회, 분석, 페이지 이동 모두 가능합니다.
              </div>
            </div>
            <div className="aip-quick aip-centered">
              {quickPrompts.map((q, i) => (
                <button key={i} className="q" onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          </>
        )}

        {messages.map((m, i) => {
          const isLastAi = thinking && i === messages.length - 1 && m.role === 'ai' && m.text !== '';
          return (
            <div key={i} className={`aip-msg ${m.role} aip-centered`}>
              <span className="role">{m.role === 'user' ? '나' : 'UTTU'}</span>
              <div className="bubble" style={m.error ? { color: 'var(--shf)' } : {}}>
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {m.toolCalls.map((tc, j) => (
                      <div key={j} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 11, color: 'var(--f3)', marginBottom: 3,
                      }}>
                        <span>{TOOL_ICON[tc.name] ?? '⚡'}</span>
                        <span className="mono">{tc.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {m.role === 'user' ? (
                  m.text
                ) : (
                  <>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS as any}>
                      {m.text}
                    </ReactMarkdown>
                    {isLastAi && <span className="aip-cursor" />}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {thinking && messages[messages.length - 1]?.text === '' && (
          <div className="aip-think aip-centered">
            <span className="dot" />
            <span>생각하는 중…</span>
          </div>
        )}
      </div>

      {/* 입력창 */}
      <div className="aip-foot">
        {thinking && <div className="aip-progress"><div className="aip-progress-bar" /></div>}
        <div className="aip-centered" style={{ paddingTop: 10 }}>
          {/* quota 바 */}
          {quota && quota.limit_monthly != null && (
            <div style={{ marginBottom: 6 }}>
              {(() => {
                const pct = Math.min(100, (quota.used_monthly / quota.limit_monthly) * 100);
                const bar = pct >= 95 ? 'var(--shf)' : pct >= 80 ? 'var(--smf)' : 'var(--hs)';
                const fmtK = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
                return (
                  <>
                    <div className="row-flex between" style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 3 }}>
                      <span>이번달 {fmtK(quota.used_monthly)} / {fmtK(quota.limit_monthly)}</span>
                      <span>{pct.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: 2, background: 'var(--snk)', borderRadius: 1, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: bar, transition: 'width 0.4s' }} />
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* 차단 / 한도 초과 상태 */}
          {quota?.is_blocked ? (
            <div style={{
              padding: '10px 12px', borderRadius: 4, fontSize: 12,
              background: 'var(--shb)', color: 'var(--shf)',
              fontFamily: 'var(--mono)', textAlign: 'center',
            }}>
              AI 접근이 차단된 계정입니다{quota.note ? ` — ${quota.note}` : '.'}
            </div>
          ) : quota?.limit_monthly != null && quota.used_monthly >= quota.limit_monthly ? (
            <div style={{
              padding: '10px 12px', borderRadius: 4, fontSize: 12,
              background: 'var(--shb)', color: 'var(--shf)',
              fontFamily: 'var(--mono)', textAlign: 'center',
            }}>
              이번달 AI 사용 한도에 도달했습니다.
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); send(input); }} style={{ margin: 0 }}>
              <div className="aip-input">
                <span className="arrow">↑</span>
                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={1}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="질문하세요 (데이터 조회, 분석, 페이지 이동)"
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--f1)',
                    letterSpacing: '-0.012em', resize: 'none', lineHeight: '19px',
                    padding: 0, margin: 0, overflowY: 'hidden',
                  }}
                  disabled={thinking}
                />
                {thinking ? (
                  <button
                    type="button"
                    className="aip-stop"
                    title="중단 (Esc)"
                    onClick={() => abortRef.current?.abort()}
                  >
                    ■
                  </button>
                ) : (
                  <span className="kbd" style={{ alignSelf: 'flex-end' }}>⌘ ↵</span>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

    </aside>
  );
}
