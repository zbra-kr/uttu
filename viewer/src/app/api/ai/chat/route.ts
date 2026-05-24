import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { DB_SCHEMA } from '@/lib/ai-schema';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_db',
    description:
      'UTTU 데이터베이스에 SELECT 쿼리를 실행합니다. ' +
      '반드시 적절한 WHERE / GROUP BY / LIMIT 포함, 전체 raw 조회 금지, 500행 하드캡 자동 적용.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sql:   { type: 'string', description: 'PostgreSQL SELECT 쿼리' },
        label: { type: 'string', description: '사용자에게 표시할 짧은 설명 (예: "오늘 이상탐지 HIGH 조회")' },
      },
      required: ['sql', 'label'],
    },
  },
  {
    name: 'navigate',
    description: '사용자 브라우저를 특정 페이지로 이동합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path:   { type: 'string', description: '이동할 경로 (예: /ranking, /brand?id=uuid, /company?id=uuid)' },
        reason: { type: 'string', description: '이동 이유 (사용자에게 표시)' },
      },
      required: ['path', 'reason'],
    },
  },
  {
    name: 'web_search',
    description:
      '외부 웹을 검색합니다. 회사 최신 뉴스, 타 채널 상품 가격, 패션 트렌드 등 DB에 없는 정보에 활용.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '검색어 (한국어 또는 영어)' },
        label: { type: 'string', description: '사용자에게 표시할 짧은 설명 (예: "나이키 최근 뉴스")' },
      },
      required: ['query', 'label'],
    },
  },
];

function buildSystem(context: string[], route: string, today: string): string {
  return `당신은 B.CAVE의 UTTU AI 어시스턴트입니다. 무신사 수집 데이터를 분석하고 비즈니스 인사이트를 제공합니다.

오늘: ${today} | 현재 화면: ${route} — ${context.join(' · ')}

## 행동 규칙
- 응답은 한국어, 간결하고 명확하게 (마크다운 사용 가능)
- 금액 컬럼(revenue, operating_income, net_income, total_assets, total_liabilities)은 원(KRW) 단위 → 표시 시 억원으로 변환 (÷100,000,000)
- SQL: SELECT만 허용, 반드시 WHERE/GROUP BY/LIMIT 포함, 전체 raw 조회 절대 금지, 500행 하드캡 자동 적용
- information_schema · pg_catalog 조회 금지 — 스키마 정보는 이미 아래 DB_SCHEMA에 있음
- 개인정보(리뷰 닉네임·사용자ID) 절대 조회·언급 금지
- 자사 브랜드: brands.is_own = true (B.CAVE CO/LE/WA 라인)
- 페이지 이동이 도움이 된다면 navigate 도구를 사용해 안내

## 실행 규칙 — 반드시 준수
- **"X를 조회할게요", "Y를 가져올게요"** 등 계획 문장을 쓰고 멈추지 마 — 선언하면 즉시 tool call로 실행해
- 분석이 완전히 끝나고 최종 인사이트를 도출하기 전까지 절대 응답을 종료하지 마
- 필요한 쿼리를 모두 실행한 뒤 한 번에 완성된 분석 결과를 출력해
- 중간 진행 상황을 알리려면 tool call label에 담고, 텍스트 응답은 최종 결과만 출력해

${DB_SCHEMA}`;
}

async function execQueryDb(
  supabase: any,
  sql: string,
): Promise<string> {
  if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE)\b/i.test(sql)) {
    return 'Error: SELECT 쿼리만 허용됩니다.';
  }
  try {
    const { data, error } = await supabase.rpc('exec_ai_query', { query: sql });
    if (error) return `DB 오류: ${error.message}`;
    const rows = data as unknown[];
    if (!rows || rows.length === 0) return '결과: 0행 (조건에 맞는 데이터 없음)';
    return `${rows.length}행 반환:\n${JSON.stringify(rows, null, 2).slice(0, 10000)}`;
  } catch (e) {
    return `오류: ${e instanceof Error ? e.message : '알 수 없는 오류'}`;
  }
}

async function execWebSearch(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return '웹 검색 미설정 (TAVILY_API_KEY 없음)';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });
    const data = await res.json() as {
      answer?: string;
      results?: Array<{ title: string; content: string; url: string }>;
    };
    const sources = (data.results ?? [])
      .map(r => `[${r.title}]\n${r.content?.slice(0, 300)}\n${r.url}`)
      .join('\n\n');
    return data.answer ? `요약: ${data.answer}\n\n출처:\n${sources}` : sources || '검색 결과 없음';
  } catch (e) {
    return `검색 오류: ${e instanceof Error ? e.message : '알 수 없는 오류'}`;
  }
}

// KST 기준 YYYY-MM-DD
function todayKST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

// KST 기준 이번달 1일 (ai_usage_daily gte 필터용)
function monthStartKST(): string {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-01`;
}

// 첫 번째 대화 교환 후 Haiku로 세션 제목 자동 생성 (fire-and-forget)
async function generateSessionTitle(userMsg: string, assistantMsg: string): Promise<string> {
  const res = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 30,
    messages: [{
      role:    'user',
      content: `아래 대화의 제목을 한국어 10자 이내 명사형으로 지어라. 부가 설명 없이 제목만 출력.
사용자: ${userMsg.slice(0, 300)}
AI: ${assistantMsg.slice(0, 300)}`,
    }],
  });
  return ((res.content[0] as Anthropic.TextBlock).text ?? '').trim().slice(0, 30);
}

export async function POST(req: NextRequest) {
  const { messages, context, route, sessionId } = await req.json() as {
    messages: Array<{ role: string; text?: string; content?: string }>;
    context: string[];
    route: string;
    sessionId: string;
  };

  // 쿠키에서 인증 user_id 추출 (비인증이면 null)
  let userId: string | null = null;
  try {
    const cookieStore = cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name) => cookieStore.get(name)?.value } },
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // 인증 실패해도 AI 기능은 계속
  }

  const enc = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const emit = (obj: object) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
      if (!serviceKey) {
        emit({ type: 'error', message: 'SUPABASE_SERVICE_KEY 미설정' });
        emit({ type: 'done' });
        controller.close();
        return;
      }
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

      const today = new Date().toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      });
      const system = buildSystem(context ?? [], route ?? '/', today);

      // ── 모델 선택: preferred_model → default → hardcoded fallback ──
      let aiProvider = 'anthropic';
      let aiModelId  = 'claude-sonnet-4-6';
      try {
        const { data: prof } = await supabase
          .from('profiles').select('preferred_model').eq('id', userId ?? '').maybeSingle();
        const pref = prof?.preferred_model ?? null;
        if (pref) {
          const { data: m } = await supabase
            .from('ai_allowed_models').select('provider, model_id')
            .eq('model_id', pref).eq('is_active', true).maybeSingle();
          if (m) { aiProvider = m.provider; aiModelId = m.model_id; }
          else {
            // preferred inactive — fall back to default
            const { data: def } = await supabase
              .from('ai_allowed_models').select('provider, model_id')
              .eq('is_default', true).eq('is_active', true).maybeSingle();
            if (def) { aiProvider = def.provider; aiModelId = def.model_id; }
          }
        } else {
          const { data: def } = await supabase
            .from('ai_allowed_models').select('provider, model_id')
            .eq('is_default', true).eq('is_active', true).maybeSingle();
          if (def) { aiProvider = def.provider; aiModelId = def.model_id; }
        }
      } catch {
        // DB 조회 실패 — hardcoded fallback 유지
      }

      // ── 세션 upsert (await — user 메시지 FK 제약 충족 보장) ────────
      if (sessionId) {
        const { error: sessErr } = await supabase.from('ai_sessions').upsert({
          id:          sessionId,
          user_id:     userId,
          route:       route ?? '/',
          context:     context ?? [],
          started_at:  new Date().toISOString(),
          ai_provider: aiProvider,
          ai_model:    aiModelId,
        }, { onConflict: 'id', ignoreDuplicates: true });
        if (sessErr) console.error('[ai_sessions upsert]', sessErr.message, sessErr.details);
      }

      // ── quota 체크 ───────────────────────────────────────────────
      if (userId) {
        try {
          const { data: quota } = await supabase
            .from('ai_user_quotas')
            .select('is_blocked, daily_token_limit, monthly_token_limit')
            .eq('user_id', userId)
            .maybeSingle();

          if (quota?.is_blocked) {
            emit({ type: 'error', message: 'AI 기능 사용이 제한된 계정입니다.' });
            emit({ type: 'done' });
            controller.close();
            return;
          }

          if (quota?.monthly_token_limit != null) {
            const { data: monthlyRows } = await supabase
              .from('ai_usage_daily')
              .select('input_tokens, output_tokens')
              .eq('user_id', userId)
              .gte('usage_date', monthStartKST());

            const usedMonthly = (monthlyRows ?? []).reduce(
              (s: number, r: { input_tokens: number; output_tokens: number }) =>
                s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0,
            );
            if (usedMonthly >= quota.monthly_token_limit) {
              emit({ type: 'error', message: `이번달 AI 사용 한도(${quota.monthly_token_limit.toLocaleString()} 토큰)에 도달했습니다.` });
              emit({ type: 'done' });
              controller.close();
              return;
            }
          }

          if (quota?.daily_token_limit != null) {
            const { data: usage } = await supabase
              .from('ai_usage_daily')
              .select('input_tokens, output_tokens')
              .eq('user_id', userId)
              .eq('usage_date', todayKST())
              .maybeSingle();

            const usedToday = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
            if (usedToday >= quota.daily_token_limit) {
              emit({ type: 'error', message: `오늘 AI 사용 한도(${quota.daily_token_limit.toLocaleString()} 토큰)에 도달했습니다.` });
              emit({ type: 'done' });
              controller.close();
              return;
            }
          }
        } catch {
          // quota 체크 실패 시 차단하지 않고 계속
        }
      }

      // ── 사용자 메시지 저장 (세션 upsert 완료 후) ─────────────────
      const userText = messages[messages.length - 1]?.text ?? messages[messages.length - 1]?.content ?? '';
      const userSeq  = messages.length;
      if (sessionId) {
        const { error: umErr } = await supabase.from('ai_messages').insert({
          session_id:  sessionId,
          sequence_no: userSeq,
          role:        'user',
          content:     userText,
        });
        if (umErr) console.error('[ai_messages user insert]', umErr.message, umErr.details);
      }

      const rawMsgs = (messages ?? []).map(m => ({
        role:    (m.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: (m.content ?? m.text ?? '') as string,
      }));

      let totalInputTokens  = 0;
      let totalOutputTokens = 0;
      let totalToolCalls    = 0;
      let accumulatedText   = '';
      const collectedToolCalls: { name: string; label: string }[] = [];

      // ── 공통 tool 실행 헬퍼 ───────────────────────────────────────
      async function execTool(name: string, inp: Record<string, string>): Promise<string> {
        if (name === 'query_db') {
          return execQueryDb(supabase, inp.sql);
        } else if (name === 'navigate') {
          emit({ type: 'navigate', path: inp.path, reason: inp.reason });
          return `페이지 이동 요청: ${inp.path}`;
        } else if (name === 'web_search') {
          return execWebSearch(inp.query);
        }
        return '알 수 없는 도구';
      }

      try {
        // ── Anthropic (Claude) ───────────────────────────────────────
        if (aiProvider === 'anthropic') {
          let msgs: Anthropic.MessageParam[] = rawMsgs;

          for (let iter = 0; iter < 15; iter++) {
            const stream = anthropic.messages.stream({
              model: aiModelId,
              max_tokens: 8192,
              system,
              tools: TOOLS,
              messages: msgs,
            });

            stream.on('text', text => {
              accumulatedText += text;
              emit({ type: 'delta', text });
            });

            const finalMsg = await stream.finalMessage();
            totalInputTokens  += finalMsg.usage?.input_tokens  ?? 0;
            totalOutputTokens += finalMsg.usage?.output_tokens ?? 0;

            if (finalMsg.stop_reason === 'end_turn') break;

            const toolCalls = finalMsg.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
            );
            if (toolCalls.length === 0) break;

            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const tc of toolCalls) {
              const inp = tc.input as Record<string, string>;
              const label = inp.label ?? inp.query ?? tc.name;
              emit({ type: 'tool_call', name: tc.name, label });
              collectedToolCalls.push({ name: tc.name, label });
              totalToolCalls++;
              const result = await execTool(tc.name, inp);
              toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
            }

            msgs = [
              ...msgs,
              { role: 'assistant', content: finalMsg.content },
              { role: 'user',      content: toolResults },
            ];
          }

        // ── OpenAI ────────────────────────────────────────────────────
        } else if (aiProvider === 'openai') {
          if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 환경변수 미설정');
          const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

          const openaiTools: OpenAI.ChatCompletionTool[] = TOOLS.map(t => ({
            type:     'function' as const,
            function: { name: t.name, description: t.description, parameters: t.input_schema as Record<string, unknown> },
          }));

          const apiMsgs: OpenAI.ChatCompletionMessageParam[] = [
            { role: 'system', content: system },
            ...rawMsgs.map(m => ({ role: m.role, content: m.content } as OpenAI.ChatCompletionMessageParam)),
          ];

          for (let iter = 0; iter < 15; iter++) {
            const resp = await oai.chat.completions.create({
              model:       aiModelId,
              messages:    apiMsgs,
              tools:       openaiTools,
              max_tokens:  8192,
              tool_choice: 'auto',
            });

            totalInputTokens  += resp.usage?.prompt_tokens     ?? 0;
            totalOutputTokens += resp.usage?.completion_tokens ?? 0;
            const msg = resp.choices[0].message;

            if (!msg.tool_calls || msg.tool_calls.length === 0) {
              const text = msg.content ?? '';
              accumulatedText += text;
              emit({ type: 'delta', text });
              break;
            }

            apiMsgs.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });

            for (const tc of msg.tool_calls) {
              if (tc.type !== 'function') continue;
              let inp: Record<string, string> = {};
              try { inp = JSON.parse(tc.function.arguments); } catch {}
              const label = inp.label ?? inp.query ?? tc.function.name;
              emit({ type: 'tool_call', name: tc.function.name, label });
              collectedToolCalls.push({ name: tc.function.name, label });
              totalToolCalls++;
              const result = await execTool(tc.function.name, inp);
              apiMsgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
            }
          }

        // ── Google Gemini ─────────────────────────────────────────────
        } else if (aiProvider === 'google') {
          if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 환경변수 미설정');
          const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
          const gemModel = genAI.getGenerativeModel({
            model: aiModelId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [{ functionDeclarations: TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema as any })) }],
            systemInstruction: system,
          });

          const gemHistory = rawMsgs.slice(0, -1).map(m => ({
            role:  m.role === 'assistant' ? 'model' as const : 'user' as const,
            parts: [{ text: m.content }],
          }));
          const lastUserContent = rawMsgs[rawMsgs.length - 1]?.content ?? '';
          const chat = gemModel.startChat({ history: gemHistory });

          let gemResult = await chat.sendMessage(lastUserContent);
          totalInputTokens  += gemResult.response.usageMetadata?.promptTokenCount     ?? 0;
          totalOutputTokens += gemResult.response.usageMetadata?.candidatesTokenCount ?? 0;

          for (let iter = 0; iter < 15; iter++) {
            const calls = gemResult.response.functionCalls?.() ?? [];
            if (!calls || calls.length === 0) {
              const text = gemResult.response.text();
              accumulatedText += text;
              emit({ type: 'delta', text });
              break;
            }

            const responseParts: Array<{ functionResponse: { name: string; response: { content: string } } }> = [];
            for (const fc of calls) {
              const inp = (fc.args ?? {}) as Record<string, string>;
              const label = inp.label ?? inp.query ?? fc.name;
              emit({ type: 'tool_call', name: fc.name, label });
              collectedToolCalls.push({ name: fc.name, label });
              totalToolCalls++;
              const result = await execTool(fc.name, inp);
              responseParts.push({ functionResponse: { name: fc.name, response: { content: result } } });
            }

            gemResult = await chat.sendMessage(responseParts as Parameters<typeof chat.sendMessage>[0]);
            totalInputTokens  += gemResult.response.usageMetadata?.promptTokenCount     ?? 0;
            totalOutputTokens += gemResult.response.usageMetadata?.candidatesTokenCount ?? 0;
          }
        }
      } catch (e) {
        emit({ type: 'error', message: e instanceof Error ? e.message : '알 수 없는 오류' });
      } finally {
        // ── DB 저장: controller.close() 이전에 완료해야 serverless에서 보장됨 ──
        if (sessionId) {
          const assistantSeq = userSeq + 1;
          const isFirstTurn  = userSeq === 1;

          // 첫 번째 대화에서만 Haiku로 제목 생성
          let title: string | undefined;
          if (isFirstTurn && accumulatedText) {
            try {
              title = await generateSessionTitle(userText, accumulatedText);
            } catch {
              // 제목 생성 실패 시 무시
            }
          }

          await Promise.allSettled([
            supabase.from('ai_messages').insert({
              session_id:    sessionId,
              sequence_no:   assistantSeq,
              role:          'assistant',
              content:       accumulatedText,
              tool_calls:    collectedToolCalls.length > 0 ? collectedToolCalls : null,
              input_tokens:  totalInputTokens,
              output_tokens: totalOutputTokens,
            }),
            supabase.from('ai_sessions').update({
              ended_at:        new Date().toISOString(),
              message_count:   assistantSeq,
              input_tokens:    totalInputTokens,
              output_tokens:   totalOutputTokens,
              tool_call_count: totalToolCalls,
              ...(title ? { title } : {}),
            }).eq('id', sessionId),
          ]);
        }

        // 일별 사용량 누적 (userId 있을 때만)
        if (userId && (totalInputTokens > 0 || totalOutputTokens > 0)) {
          try {
            const dateStr = todayKST();
            const { data: existing } = await supabase
              .from('ai_usage_daily')
              .select('input_tokens, output_tokens, session_count, message_count')
              .eq('user_id', userId)
              .eq('usage_date', dateStr)
              .maybeSingle();

            await supabase.from('ai_usage_daily').upsert({
              user_id:       userId,
              usage_date:    dateStr,
              input_tokens:  (existing?.input_tokens  ?? 0) + totalInputTokens,
              output_tokens: (existing?.output_tokens ?? 0) + totalOutputTokens,
              session_count: (existing?.session_count ?? 0) + 1,
              message_count: (existing?.message_count ?? 0) + 2,
            }, { onConflict: 'user_id,usage_date' });
          } catch {
            // 사용량 저장 실패는 무시
          }
        }

        emit({ type: 'done' });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
