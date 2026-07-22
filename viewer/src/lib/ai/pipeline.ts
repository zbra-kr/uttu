import Anthropic from '@anthropic-ai/sdk';
import { DB_SCHEMA } from '@/lib/ai-schema';

// 사용자 개인정보·운영 테이블 — AI 쿼리 완전 차단
// DB 레벨: uttu_ai_readonly 역할(01408)이 1차 차단
// TS 레벨: 에러 메시지 노출 전 조기 차단 (다층 방어)
export const AI_QUERY_BLOCKED_TABLES = [
  'ai_messages', 'ai_sessions', 'ai_user_quotas', 'ai_usage_daily', 'ai_allowed_models',
  'profiles', 'user_notes', 'user_bookmarks', 'user_view_history', 'user_saved_filters',
  'user_notification_subscriptions', 'user_notifications',
  'user_subscriptions', 'user_mention_configs',
  'anomaly_notes', 'detector_rules',
  'auth\\.users', 'auth\\.sessions', 'auth\\.audit_log_entries',
];

export async function execQueryDb(
  supabase: any,
  sql: string,
): Promise<string> {
  if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE)\b/i.test(sql)) {
    return 'Error: SELECT 쿼리만 허용됩니다.';
  }
  const sqlLower = sql.toLowerCase().replace(/\s+/g, ' ');
  for (const tbl of AI_QUERY_BLOCKED_TABLES) {
    if (new RegExp(`\\b${tbl}\\b`).test(sqlLower)) {
      return `Error: '${tbl}' 테이블은 AI 쿼리 접근이 금지되어 있습니다. 이 데이터는 조회할 수 없습니다.`;
    }
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

// MCP 전용 시스템 프롬프트 — navigate·web_search 없음
function buildMcpSystem(today: string): string {
  return `당신은 B.CAVE UTTU 데이터 분석 어시스턴트입니다. 무신사 수집 데이터를 SQL로 조회해 비즈니스 인사이트를 제공합니다.

오늘: ${today}

## 데이터 경계 — 절대 준수
- **아래 DB_SCHEMA에 있는 테이블과 컬럼만 존재한다.** 그 외 데이터는 UTTU에서 수집하지 않는다.
- UTTU가 수집하지 않는 것: 글로벌 랭킹, 해외 판매량, SNS 지표, 오프라인 매장 매출, 실시간 재고, 무신사 외 플랫폼 데이터, 사용자 개인정보
- **데이터가 없으면 없다고 명확히 답해야 한다**: "UTTU에서 수집하지 않는 지표입니다"라고 말하라.
- **실제 query_db 결과 없이 수치·순위·통계를 생성하거나 추정하지 마라.**
- **query_db에서 0행이 반환되면**: "해당 조건의 데이터가 없습니다"라고 그대로 전달하라.

## 쿼리 금지 테이블
다음 테이블은 query_db로 절대 조회하지 마라 (시스템이 자동 차단):
ai_messages, ai_sessions, ai_user_quotas, ai_usage_daily, profiles, user_notes, user_subscriptions, auth.users

## 행동 규칙
- 응답은 한국어, 간결하고 명확하게 (마크다운 사용 가능)
- 금액 컬럼(revenue, operating_income, net_income, total_assets, total_liabilities)은 원(KRW) 단위 → 표시 시 억원으로 변환 (÷100,000,000)
- SQL: SELECT만 허용, 반드시 WHERE/GROUP BY/LIMIT 포함, 전체 raw 조회 절대 금지, 500행 하드캡 자동 적용
- information_schema · pg_catalog 조회 금지 — 스키마 정보는 이미 아래 DB_SCHEMA에 있음
- 개인정보(리뷰 닉네임·사용자ID) 절대 조회·언급 금지
- 자사 브랜드: brands.is_own = true (B.CAVE CO/LE/WA 라인)
- 분석이 완전히 끝난 뒤 최종 인사이트를 한 번에 출력해

${DB_SCHEMA}`;
}

const MCP_QUERY_TOOL: Anthropic.Tool = {
  name: 'query_db',
  description:
    'UTTU 데이터베이스에 SELECT 쿼리를 실행합니다. ' +
    '반드시 적절한 WHERE / GROUP BY / LIMIT 포함, 전체 raw 조회 금지, 500행 하드캡 자동 적용.',
  input_schema: {
    type: 'object' as const,
    properties: {
      sql:   { type: 'string', description: 'PostgreSQL SELECT 쿼리' },
      label: { type: 'string', description: '짧은 쿼리 설명' },
    },
    required: ['sql', 'label'],
  },
};

export interface InferenceResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// 비스트리밍 Anthropic 추론 루프 — MCP ask_uttu 전용
// query_db 도구만 허용 (navigate·web_search 없음)
// AbortSignal로 25초 타임아웃 지원
export async function runInferenceLoop(opts: {
  question: string;
  supabase: any;
  model?: string;
  maxTurns?: number;
  signal?: AbortSignal;
}): Promise<InferenceResult> {
  const {
    question,
    supabase,
    model = process.env.MCP_ASK_MODEL ?? 'claude-haiku-4-5-20251001',
    maxTurns = 3,
    signal,
  } = opts;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const system = buildMcpSystem(today);

  let msgs: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for (let i = 0; i < maxTurns; i++) {
    const resp = await anthropic.messages.create(
      {
        model,
        max_tokens: 4096,
        system,
        tools: [MCP_QUERY_TOOL],
        messages: msgs,
      },
      { signal },
    );

    inputTokens  += resp.usage?.input_tokens  ?? 0;
    outputTokens += resp.usage?.output_tokens ?? 0;

    const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    text = textBlocks.map(b => b.text).join('');

    if (resp.stop_reason === 'end_turn') break;

    const toolCalls = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (!toolCalls.length) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tc of toolCalls) {
      const inp = tc.input as Record<string, string>;
      const result = await execQueryDb(supabase, inp.sql);
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
    }

    msgs = [
      ...msgs,
      { role: 'assistant', content: resp.content },
      { role: 'user',      content: toolResults },
    ];
  }

  return { text, inputTokens, outputTokens };
}
