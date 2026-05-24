# UTTU AI 세션 저장 + 토큰 추적 — 구현 지시 프롬프트

> 이 문서는 프론트엔드/백엔드 AI 어시스턴트에게 전달하는 구현 명세입니다.
> 아래 내용을 그대로 지시 프롬프트로 사용하세요.

---

## 배경 및 목적

UTTU AI 채팅 기능(viewer)에 두 가지 기능을 추가한다:

1. **대화 세션 저장** — 모든 대화를 DB에 기록해 나중에 분석
2. **토큰 사용량 추적 + 제한 체크** — 사용자별 일별 토큰 한도 초과 시 차단

DB 마이그레이션(`00309_ai_sessions.sql`)은 이미 적용되어 있다.
4개 테이블이 존재한다: `ai_sessions`, `ai_messages`, `ai_user_quotas`, `ai_usage_daily`.

---

## 수정 대상 파일 2개

### A. `viewer/src/app/api/ai/chat/route.ts`

현재 이 파일은 Claude API에 SSE 스트리밍 요청을 보내고, tool_call(query_db/navigate/web_search)을 실행한 뒤 결과를 클라이언트로 흘려보내는 역할을 한다.

**추가할 로직:**

#### 1. 요청 바디에 `sessionId` 추가 수신

```typescript
const { messages, context, route, sessionId } = await req.json() as {
  messages: Array<{ role: string; text?: string; content?: string }>;
  context: string[];
  route: string;
  sessionId: string;  // 클라이언트가 생성한 UUID
};
```

#### 2. Supabase 인증으로 user_id 추출

요청 헤더의 쿠키에서 Supabase 세션을 읽어 user_id를 추출한다. 비인증이면 null.

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// ... POST 함수 내부
const cookieStore = cookies();
const supabaseAuth = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { cookies: { get: (name) => cookieStore.get(name)?.value } }
);
const { data: { user } } = await supabaseAuth.auth.getUser();
const userId = user?.id ?? null;
```

> 주의: DB 쿼리용 `supabase`(service_role)와 인증 확인용 `supabaseAuth`(anon key)는 별도 클라이언트.

#### 3. 세션 upsert (첫 메시지 시)

agentic 루프 시작 전, ai_sessions 테이블에 upsert:

```typescript
await supabase.from('ai_sessions').upsert({
  id: sessionId,
  user_id: userId,
  route,
  context: context ?? [],
  started_at: new Date().toISOString(),
}, { onConflict: 'id', ignoreDuplicates: true });
```

#### 4. 토큰 quota 체크 (루프 시작 전)

userId가 있을 때만 체크:

```typescript
if (userId) {
  // is_blocked 체크
  const { data: quota } = await supabase
    .from('ai_user_quotas')
    .select('is_blocked, daily_token_limit')
    .eq('user_id', userId)
    .maybeSingle();

  if (quota?.is_blocked) {
    emit({ type: 'error', message: 'AI 기능 사용이 제한된 계정입니다.' });
    emit({ type: 'done' });
    controller.close();
    return;
  }

  // 일별 사용량 체크
  if (quota?.daily_token_limit != null) {
    const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
      .replace(/\. /g, '-').replace('.', '');  // YYYY-MM-DD 형식
    const { data: usage } = await supabase
      .from('ai_usage_daily')
      .select('input_tokens, output_tokens')
      .eq('user_id', userId)
      .eq('usage_date', today)
      .maybeSingle();

    const usedToday = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
    if (usedToday >= quota.daily_token_limit) {
      emit({ type: 'error', message: `오늘 AI 사용 한도(${quota.daily_token_limit.toLocaleString()} 토큰)에 도달했습니다.` });
      emit({ type: 'done' });
      controller.close();
      return;
    }
  }
}
```

#### 5. 토큰 누적 집계

루프 내에서 각 iteration의 `finalMsg.usage`를 누적:

```typescript
let totalInputTokens  = 0;
let totalOutputTokens = 0;
let totalToolCalls    = 0;

// 루프 내부 finalMsg 직후:
totalInputTokens  += finalMsg.usage?.input_tokens  ?? 0;
totalOutputTokens += finalMsg.usage?.output_tokens ?? 0;
totalToolCalls    += toolCalls.length;
```

#### 6. 사용자 메시지 저장

루프 시작 전 (user 메시지만):

```typescript
const userMsg = messages[messages.length - 1];  // 마지막이 이번 사용자 메시지
const userSequence = messages.length;  // 1-based

await supabase.from('ai_messages').insert({
  session_id:  sessionId,
  sequence_no: userSequence,
  role:        'user',
  content:     userMsg.text ?? userMsg.content ?? '',
});
```

#### 7. assistant 메시지 + 토큰 저장 (루프 종료 후 finally)

```typescript
// finally 블록 내:
const assistantText = /* agentic 루프에서 누적한 전체 응답 텍스트 */;
const assistantSequence = (messages.length) + 1;

await Promise.all([
  // assistant 메시지 저장
  supabase.from('ai_messages').insert({
    session_id:   sessionId,
    sequence_no:  assistantSequence,
    role:         'assistant',
    content:      assistantText,
    tool_calls:   collectedToolCalls.length > 0 ? collectedToolCalls : null,
    input_tokens:  totalInputTokens,
    output_tokens: totalOutputTokens,
  }),

  // 세션 통계 갱신
  supabase.from('ai_sessions').update({
    ended_at:       new Date().toISOString(),
    message_count:  assistantSequence,
    input_tokens:   supabase.rpc('increment_col', ...),  // 단순 update로 처리
    output_tokens:  totalOutputTokens,
    tool_call_count: totalToolCalls,
  }).eq('id', sessionId),
]);

// ai_sessions 누적 업데이트 — RPC 없이 처리하는 방법:
// 기존 값을 먼저 읽어서 더하거나, 세션당 1번만 업데이트(덮어쓰기)로 설계해도 무방
// 세션은 하나의 API 요청 = 1 assistant turn이므로 덮어쓰기가 안전

// 일별 사용량 upsert (userId 있을 때만)
if (userId) {
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
    .replace(/\. /g, '-').replace('.', '');
  await supabase.rpc('upsert_ai_usage_daily', {
    p_user_id:      userId,
    p_date:         today,
    p_input:        totalInputTokens,
    p_output:       totalOutputTokens,
    p_sessions:     1,
    p_messages:     2,  // user + assistant
  });
  // 위 RPC가 없으면 아래로 대체:
  // INSERT INTO ai_usage_daily ... ON CONFLICT (user_id, usage_date) DO UPDATE SET ...
  // service_role이므로 supabase.rpc('exec_ai_query', ...) 대신 직접 SQL 실행 가능
}
```

> **ai_usage_daily 누적 upsert**는 SQL로 직접 처리하는 게 더 안전하다.
> `supabase.rpc('exec_ai_query', ...)` 대신 아래 패턴:

```typescript
await supabase.from('ai_usage_daily').upsert({
  user_id:       userId,
  usage_date:    today,
  input_tokens:  totalInputTokens,
  output_tokens: totalOutputTokens,
  session_count: 1,
  message_count: 2,
}, {
  onConflict: 'user_id,usage_date',
  // Supabase JS는 upsert increment를 지원 안 하므로
  // ignoreDuplicates: false 로 덮어쓰기 대신 raw SQL 사용 권장
});
// 실제로는 exec_ai_query 함수를 통한 raw SQL이 더 정확:
await supabase.rpc('exec_ai_query', {
  query: `
    INSERT INTO ai_usage_daily (user_id, usage_date, input_tokens, output_tokens, session_count, message_count)
    VALUES ('${userId}', '${today}', ${totalInputTokens}, ${totalOutputTokens}, 1, 2)
    ON CONFLICT (user_id, usage_date) DO UPDATE SET
      input_tokens  = ai_usage_daily.input_tokens  + EXCLUDED.input_tokens,
      output_tokens = ai_usage_daily.output_tokens + EXCLUDED.output_tokens,
      session_count = ai_usage_daily.session_count + 1,
      message_count = ai_usage_daily.message_count + 2
  `
});
// ⚠️ exec_ai_query는 SELECT 전용 — 위 패턴은 사용 불가. service_role이면 직접 write 가능.
// supabase (service_role) 클라이언트로 직접 SQL 실행:
```

**실제 권장 패턴** — service_role 클라이언트로 PostgreSQL 함수 없이 처리:

```typescript
// ai_sessions 토큰 업데이트 (이번 요청 누적값으로 SET — 세션당 단일 대화라 안전)
await supabase
  .from('ai_sessions')
  .update({
    ended_at:        new Date().toISOString(),
    message_count:   assistantSequence,
    input_tokens:    totalInputTokens,
    output_tokens:   totalOutputTokens,
    tool_call_count: totalToolCalls,
  })
  .eq('id', sessionId);

// ai_usage_daily — Supabase JS가 increment를 직접 지원하지 않으므로
// 현재 값 읽기 → 더하기 → 업데이트 패턴:
if (userId) {
  const todayStr = new Date()
    .toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\. /g, '-').replace(/\.$/, '');

  const { data: existing } = await supabase
    .from('ai_usage_daily')
    .select('input_tokens, output_tokens, session_count, message_count')
    .eq('user_id', userId)
    .eq('usage_date', todayStr)
    .maybeSingle();

  await supabase.from('ai_usage_daily').upsert({
    user_id:       userId,
    usage_date:    todayStr,
    input_tokens:  (existing?.input_tokens  ?? 0) + totalInputTokens,
    output_tokens: (existing?.output_tokens ?? 0) + totalOutputTokens,
    session_count: (existing?.session_count ?? 0) + 1,
    message_count: (existing?.message_count ?? 0) + 2,
  }, { onConflict: 'user_id,usage_date' });
}
```

---

### B. `viewer/src/components/shell/AiPanel.tsx`

현재 이 파일은 fetch('/api/ai/chat')로 SSE 스트리밍을 받아 메시지를 표시한다.

**추가할 로직:**

#### 1. sessionId 상태 관리

```typescript
const [sessionId, setSessionId] = React.useState<string>(() => crypto.randomUUID());

// 라우트 변경 시 새 세션 시작 (메시지 초기화와 동시에)
React.useEffect(() => {
  setMessages([]);
  setSessionId(crypto.randomUUID());
}, [route]);
```

#### 2. fetch 요청에 sessionId 포함

```typescript
body: JSON.stringify({
  messages: history.map(m => ({ role: m.role, text: m.text })),
  context,
  route,
  sessionId,  // 추가
}),
```

---

## 구현 시 주의사항

1. **`exec_ai_query`는 SELECT 전용** — `ai_usage_daily` 누적 업데이트는 service_role 클라이언트로 직접 처리
2. **`@supabase/ssr` 패키지** — `createServerClient`로 cookies에서 user 읽기 (`next/headers`의 `cookies()` 사용)
3. **비인증 사용자** — userId = null이면 quota 체크·usage 저장 스킵, 세션은 저장 (분석용)
4. **오류 무시** — DB 저장 실패가 AI 응답을 막아서는 안 됨. try/catch로 감싸되 응답은 계속 진행
5. **응답 텍스트 누적** — 현재 `stream.on('text', ...)` 이벤트로 클라이언트에 emit만 함. 저장용으로 서버 사이드에서도 따로 누적 필요:
   ```typescript
   let accumulatedText = '';
   stream.on('text', text => {
     accumulatedText += text;
     emit({ type: 'delta', text });
   });
   ```

---

## 테이블 스키마 요약

```
ai_sessions         — 세션(대화 1회)
  id uuid PK        — 클라이언트 생성 UUID
  user_id uuid      — auth.users.id (NULL 가능)
  route text        — 진입 경로
  context text[]    — context chip 배열
  started_at        — 세션 시작
  ended_at          — 마지막 응답 완료 후 갱신
  message_count int — user+assistant 총 메시지 수
  input_tokens int  — 세션 전체 Claude 입력 토큰
  output_tokens int — 세션 전체 Claude 출력 토큰
  tool_call_count   — tool_use 호출 수

ai_messages         — 세션 내 개별 메시지
  id uuid PK
  session_id uuid FK ai_sessions
  sequence_no       — 1부터 시작 순번
  role              — 'user' | 'assistant'
  content           — 전체 텍스트
  tool_calls jsonb  — [{name, label}] (assistant only)
  input_tokens      — 해당 턴 Claude 입력 토큰 (assistant only)
  output_tokens     — 해당 턴 Claude 출력 토큰 (assistant only)

ai_user_quotas      — 사용자별 한도 설정 (관리자 관리)
  user_id uuid PK FK auth.users
  daily_token_limit — NULL=무제한
  monthly_token_limit
  is_blocked bool   — true면 즉시 차단
  note              — 관리자 메모

ai_usage_daily      — 일별 집계 (quota 체크 + 분석)
  user_id uuid FK
  usage_date date
  input_tokens int
  output_tokens int
  session_count int
  message_count int
  UNIQUE (user_id, usage_date)
```

---

## 구현하지 않아도 되는 것 (추후 마이페이지에서)

- 사용자가 자신의 usage를 보는 UI
- 관리자가 quota를 설정하는 UI
- 월별 한도 체크 (daily_token_limit만 우선 구현)
- 이메일 알림 (한도 80% 도달 등)
