import { createMcpHandler } from 'mcp-handler';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { runInferenceLoop } from '@/lib/ai/pipeline';

// ─── Supabase 클라이언트 팩토리 ────────────────────────────────────────────
let _sb: ReturnType<typeof createClient> | null = null;
function sb() {
  if (!_sb) {
    _sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _sb;
}

// ask_uttu 전용: service_role 클라이언트 (exec_ai_query RPC + mcp_usage_daily 접근)
let _sbSvc: ReturnType<typeof createClient> | null = null;
function sbSvc() {
  if (!_sbSvc) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_KEY 미설정');
    _sbSvc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
  }
  return _sbSvc;
}

// MCP 서비스 계정 일일 토큰 한도 체크 (mcp_usage_daily 테이블 의존)
async function checkMcpQuota(): Promise<{ allowed: boolean; limit: number }> {
  const limitStr = process.env.MCP_ASK_DAILY_TOKEN_LIMIT;
  if (!limitStr) return { allowed: true, limit: Infinity };
  const limit = parseInt(limitStr, 10);
  if (isNaN(limit) || limit <= 0) return { allowed: true, limit: Infinity };
  try {
    const dateStr = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const { data } = await (sbSvc() as any)
      .from('mcp_usage_daily')
      .select('input_tokens, output_tokens')
      .eq('usage_date', dateStr)
      .maybeSingle();
    const row = data as { input_tokens: number; output_tokens: number } | null;
    const used = (row?.input_tokens ?? 0) + (row?.output_tokens ?? 0);
    return { allowed: used < limit, limit };
  } catch {
    return { allowed: true, limit };
  }
}

// MCP 일일 사용량 누적 (fire-and-forget)
async function accumulateMcpUsage(inputTokens: number, outputTokens: number): Promise<void> {
  if (!inputTokens && !outputTokens) return;
  try {
    const dateStr = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const { data: existing } = await (sbSvc() as any)
      .from('mcp_usage_daily')
      .select('input_tokens, output_tokens, call_count')
      .eq('usage_date', dateStr)
      .maybeSingle();
    const ex = existing as { input_tokens: number; output_tokens: number; call_count: number } | null;
    await (sbSvc() as any).from('mcp_usage_daily').upsert({
      usage_date:    dateStr,
      input_tokens:  (ex?.input_tokens  ?? 0) + inputTokens,
      output_tokens: (ex?.output_tokens ?? 0) + outputTokens,
      call_count:    (ex?.call_count    ?? 0) + 1,
    }, { onConflict: 'usage_date' });
  } catch {
    // 사용량 저장 실패는 무시
  }
}

const LIMIT = 50;

function kstToday() {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 순수 MCP 프로토콜 핸들러 팩토리.
 * 인증 로직 없음 — 호출 측 라우트에서 인증 후 호출할 것.
 *
 * @param endpoint  Streamable HTTP 세션 재연결 경로 (예: '/api/mcp', '/api/mcp/SECRET')
 */
export function createUttuMcpHandler(endpoint: string) {
  return createMcpHandler(
    (server) => {

      // 1. get_today_briefing ───────────────────────────────────────────────
      server.registerTool(
        'get_today_briefing',
        {
          title: '오늘의 데일리 브리핑',
          description:
            '경영진(executive)·임직원(staff)·CS 세 페르소나의 데일리 브리핑을 반환합니다. ' +
            '헤드라인·핵심 3줄·인사이트 포함.',
          inputSchema: {
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
              .describe('조회 날짜 YYYY-MM-DD. 미지정 시 KST 오늘'),
          },
        },
        async ({ date }) => {
          const target = date ?? kstToday();
          const { data, error } = await sb()
            .from('daily_briefings')
            .select('briefing_date,audience,headline,daily_brief,weekly_brief,card_comments,insights,news_picks,generated_at,model')
            .eq('briefing_date', target)
            .limit(3);
          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          if (!data?.length) {
            return {
              content: [{
                type: 'text' as const,
                text: `${target} 브리핑 없음. (daily_briefings anon 정책 미적용 시 마이그레이션 01410 적용 필요)`,
              }],
            };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
      );

      // 2. get_ranking ──────────────────────────────────────────────────────
      server.registerTool(
        'get_ranking',
        {
          title: '무신사 상품 랭킹',
          description: '오늘의 무신사 상품 순위를 반환합니다. rank_position 오름차순.',
          inputSchema: {
            limit: z.number().int().min(1).max(LIMIT).default(20)
              .describe('반환 행 수 (최대 50)'),
            category_code: z.string().default('000')
              .describe('카테고리 코드 (000=전체 001=상의 002=아우터 003=바지 103=신발 등)'),
            gender_filter: z.enum(['A', 'M', 'F']).default('A')
              .describe('A=전체 M=남성 F=여성'),
          },
        },
        async ({ limit, category_code, gender_filter }) => {
          const { data: ld } = await sb()
            .from('ranking_snapshots')
            .select('snapshot_date')
            .eq('category_code', category_code)
            .eq('gender_filter', gender_filter)
            .eq('age_filter', 'AGE_BAND_ALL')
            .order('snapshot_date', { ascending: false })
            .limit(1);
          const latestDate = (ld as any[])?.[0]?.snapshot_date;
          if (!latestDate) return { content: [{ type: 'text' as const, text: '랭킹 데이터 없음' }] };

          const { data, error } = await sb()
            .from('ranking_snapshots')
            .select('rank_position,musinsa_no,product_name,brand_name,final_price,discount_rate,is_sold_out,review_count,review_score,snapshot_date')
            .eq('category_code', category_code)
            .eq('gender_filter', gender_filter)
            .eq('age_filter', 'AGE_BAND_ALL')
            .eq('snapshot_date', latestDate)
            .order('rank_position', { ascending: true })
            .limit(limit);
          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
      );

      // 3. get_brand_ranking ────────────────────────────────────────────────
      server.registerTool(
        'get_brand_ranking',
        {
          title: '무신사 브랜드 랭킹',
          description: '오늘의 무신사 브랜드 순위를 반환합니다.',
          inputSchema: {
            limit: z.number().int().min(1).max(LIMIT).default(20)
              .describe('반환 행 수 (최대 50)'),
            gender_filter: z.enum(['A', 'M', 'F']).default('A')
              .describe('A=전체 M=남성 F=여성'),
          },
        },
        async ({ limit, gender_filter }) => {
          const { data: ld } = await sb()
            .from('brand_ranking_snapshots')
            .select('snapshot_date')
            .eq('category_code', '000')
            .eq('gender_filter', gender_filter)
            .eq('age_filter', 'AGE_BAND_ALL')
            .order('snapshot_date', { ascending: false })
            .limit(1);
          const latestDate = (ld as any[])?.[0]?.snapshot_date;
          if (!latestDate) return { content: [{ type: 'text' as const, text: '브랜드 랭킹 데이터 없음' }] };

          const { data, error } = await sb()
            .from('brand_ranking_snapshots')
            .select('rank_position,brand_name,musinsa_brand_slug,snapshot_date')
            .eq('category_code', '000')
            .eq('gender_filter', gender_filter)
            .eq('age_filter', 'AGE_BAND_ALL')
            .eq('snapshot_date', latestDate)
            .order('rank_position', { ascending: true })
            .limit(limit);
          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
      );

      // 4. get_brand_trend ──────────────────────────────────────────────────
      server.registerTool(
        'get_brand_trend',
        {
          title: '브랜드 순위 추이',
          description:
            '특정 브랜드의 일자별 평균 순위·SKU 수·TOP100 진입 수 추이를 반환합니다. ' +
            '최근 50일치.',
          inputSchema: {
            brand_name: z.string().min(1)
              .describe('브랜드명 (예: 커버낫, 디스이즈네버댓)'),
          },
        },
        async ({ brand_name }) => {
          const { data, error } = await sb()
            .from('ranking_snapshots')
            .select('snapshot_date,rank_position')
            .eq('brand_name', brand_name)
            .eq('category_code', '000')
            .eq('gender_filter', 'A')
            .eq('age_filter', 'AGE_BAND_ALL')
            .order('snapshot_date', { ascending: true })
            .limit(3000);
          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          const byDate = new Map<string, number[]>();
          for (const r of (data ?? []) as any[]) {
            const arr = byDate.get(r.snapshot_date) ?? [];
            arr.push(r.rank_position);
            byDate.set(r.snapshot_date, arr);
          }
          const trend = [...byDate.entries()].map(([date, ranks]) => ({
            date: date.slice(5),
            avg_rank: Math.round(ranks.reduce((s, r) => s + r, 0) / ranks.length),
            sku_count: ranks.length,
            top100_count: ranks.filter(r => r <= 100).length,
          })).slice(-LIMIT);
          if (!trend.length) return { content: [{ type: 'text' as const, text: `브랜드 "${brand_name}" 랭킹 데이터 없음` }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(trend, null, 2) }] };
        },
      );

      // 5. get_today_magazine ───────────────────────────────────────────────
      server.registerTool(
        'get_today_magazine',
        {
          title: '무신사 매거진 최신 기사',
          description: '최신 무신사 매거진 기사 목록을 반환합니다. published_at 내림차순.',
          inputSchema: {
            limit: z.number().int().min(1).max(LIMIT).default(20)
              .describe('반환 행 수 (최대 50)'),
            category: z.string().optional()
              .describe('카테고리 필터 (예: 스타일, 뷰티, 아이템)'),
            keyword: z.string().optional()
              .describe('제목 검색 키워드'),
          },
        },
        async ({ limit, category, keyword }) => {
          let q = sb()
            .from('magazine_articles')
            .select('id,article_id,title,category,sub_category,brand_names,view_count,comment_count,published_at,summary,landing_url')
            .order('published_at', { ascending: false })
            .limit(limit);
          if (category && category !== 'all') q = q.eq('category', category);
          if (keyword) q = q.ilike('title', `%${keyword}%`);
          const { data, error } = await q;
          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
      );

      // 6. get_promotions ───────────────────────────────────────────────────
      server.registerTool(
        'get_promotions',
        {
          title: '진행 중인 프로모션',
          description: '현재 활성(end_at null 또는 미래) 프로모션 목록을 반환합니다.',
          inputSchema: {
            limit: z.number().int().min(1).max(LIMIT).default(20)
              .describe('반환 행 수 (최대 50)'),
          },
        },
        async ({ limit }) => {
          const now = new Date().toISOString();
          const { data, error } = await sb()
            .from('promotions')
            .select('id,title,promotion_type,items_count,end_at,snapshot_date')
            .or(`end_at.is.null,end_at.gte.${now}`)
            .order('snapshot_date', { ascending: false })
            .limit(limit);
          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
      );

      // 7. get_review_summary ───────────────────────────────────────────────
      server.registerTool(
        'get_review_summary',
        {
          title: '리뷰 요약',
          description:
            '자사 상품 최근 리뷰 목록과 별점 분포 통계를 반환합니다. ' +
            'own_sales_daily·own_inventory는 포함되지 않습니다.',
          inputSchema: {
            days: z.number().int().min(1).max(180).default(30)
              .describe('최근 N일 리뷰'),
            rating_min: z.number().int().min(1).max(5).default(1)
              .describe('최소 별점'),
            limit: z.number().int().min(1).max(LIMIT).default(20)
              .describe('리뷰 행 수 (최대 50)'),
            keyword: z.string().optional()
              .describe('리뷰 텍스트 키워드'),
          },
        },
        async ({ days, rating_min, limit, keyword }) => {
          const dateFrom = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
          let q = (sb()
            .from('reviews')
            .select('rating,review_text,review_date,helpful_count,member_gender,products!inner(name,is_own,brands(name))')
            .gte('rating', rating_min)
            .gte('review_date', dateFrom)
            .eq('products.is_own' as any, true)
            .order('review_date', { ascending: false })
            .limit(limit));
          if (keyword) q = q.ilike('review_text', `%${keyword}%`);
          const { data: rows, error } = await q;

          const distPromises = [5, 4, 3, 2, 1].map(star =>
            sb().from('reviews').select('*', { count: 'exact', head: true })
              .gte('review_date', dateFrom).eq('rating', star)
              .then(r => ({ star, count: r.count ?? 0 }))
          );
          const dist = await Promise.all(distPromises);
          const total = dist.reduce((s, d) => s + d.count, 0);

          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          const result = {
            stats: {
              total,
              rating_dist: Object.fromEntries(dist.map(d => [d.star, d.count])),
            },
            reviews: (rows ?? []).map((r: any) => ({
              rating: r.rating,
              review_text: r.review_text,
              review_date: r.review_date,
              product_name: r.products?.name,
              brand_name: r.products?.brands?.name,
              member_gender: r.member_gender,
            })),
          };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // 8. get_snap_highlights ──────────────────────────────────────────────
      server.registerTool(
        'get_snap_highlights',
        {
          title: '무신사 스냅 하이라이트',
          description: '최신 무신사 스냅(스타일 피드) 목록을 반환합니다. published_at 내림차순.',
          inputSchema: {
            limit: z.number().int().min(1).max(LIMIT).default(20)
              .describe('반환 행 수 (최대 50)'),
            gender: z.enum(['ALL', 'M', 'F']).default('ALL')
              .describe('모델 성별 필터'),
          },
        },
        async ({ limit, gender }) => {
          let q = sb()
            .from('snaps')
            .select('snap_id,content_type,published_at,like_count,view_count,comment_count,model_gender,model_height,model_weight,thumbnail_url')
            .order('published_at', { ascending: false })
            .limit(limit);
          if (gender !== 'ALL') q = q.eq('model_gender', gender);
          const { data, error } = await q;
          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
      );

      // 9. get_anomalies ────────────────────────────────────────────────────
      server.registerTool(
        'get_anomalies',
        {
          title: '이상 신호 감지',
          description:
            '최근 N일간 감지된 순위·리뷰·프로모션 이상 신호를 반환합니다. ' +
            'severity: high(긴급)·medium·low.',
          inputSchema: {
            days: z.number().int().min(1).max(30).default(7)
              .describe('최근 N일'),
            severity: z.enum(['high', 'medium', 'low', 'all']).default('all')
              .describe('심각도 필터'),
          },
        },
        async ({ days, severity }) => {
          const from = new Date(Date.now() + 9 * 3_600_000);
          from.setDate(from.getDate() - (days - 1));
          const fromStr = from.toISOString().slice(0, 10);
          let q = sb()
            .from('anomalies')
            .select('id,detection_date,severity,anomaly_type,entity_name,description,meta')
            .gte('detection_date', fromStr)
            .order('detected_at', { ascending: false })
            .limit(LIMIT);
          if (severity !== 'all') q = q.eq('severity', severity);
          const { data, error } = await q;
          if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
      );

      // 10. get_brand_info ──────────────────────────────────────────────────
      server.registerTool(
        'get_brand_info',
        {
          title: '브랜드 정보 조회',
          description:
            '브랜드명으로 기본 정보(소속 회사·국가·설립연도)와 현재 랭킹 통계를 반환합니다. ' +
            'profiles·user_*·ai_* 등 개인정보 테이블은 포함되지 않습니다.',
          inputSchema: {
            brand_name: z.string().min(1)
              .describe('브랜드명 (한글 또는 영문, 부분 일치 검색)'),
          },
        },
        async ({ brand_name }) => {
          const { data: brandRows } = await sb()
            .from('brands')
            .select('id,name,slug,is_own,nation_name,since_year,introduction,company_id,companies(corp_name)')
            .ilike('name', `%${brand_name}%`)
            .limit(3);
          if (!brandRows?.length) {
            return { content: [{ type: 'text' as const, text: `브랜드 "${brand_name}" 검색 결과 없음` }] };
          }
          const brand = (brandRows as any[])[0];

          const { data: ldRows } = await sb()
            .from('ranking_snapshots')
            .select('snapshot_date')
            .eq('brand_name', brand.name)
            .order('snapshot_date', { ascending: false })
            .limit(1);
          const latestDate = (ldRows as any[])?.[0]?.snapshot_date;

          let rankingStats = null;
          if (latestDate) {
            const { data: rankRows } = await sb()
              .from('ranking_snapshots')
              .select('rank_position')
              .eq('brand_name', brand.name)
              .eq('snapshot_date', latestDate)
              .eq('category_code', '000')
              .eq('gender_filter', 'A')
              .eq('age_filter', 'AGE_BAND_ALL');
            const ranks = ((rankRows ?? []) as any[]).map((r: any) => r.rank_position);
            rankingStats = {
              snapshot_date: latestDate,
              sku_count: ranks.length,
              top100_count: ranks.filter(r => r <= 100).length,
              avg_rank: ranks.length
                ? Math.round(ranks.reduce((s, r) => s + r, 0) / ranks.length)
                : null,
            };
          }

          const result = {
            brand: {
              id: brand.id,
              name: brand.name,
              slug: brand.slug,
              is_own: brand.is_own,
              nation_name: brand.nation_name,
              since_year: brand.since_year,
              introduction: brand.introduction,
              company_name: brand.companies?.corp_name ?? null,
            },
            ranking_stats: rankingStats,
            other_matches: (brandRows as any[]).slice(1).map((b: any) => ({ id: b.id, name: b.name })),
          };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
      );

      // 11. ask_uttu ────────────────────────────────────────────────────────
      server.registerTool(
        'ask_uttu',
        {
          title: 'UTTU 복합 분석 질문',
          description:
            '다른 UTTU 도구로 답할 수 없는 복합 분석 질문에만 사용하세요. ' +
            '단순 조회(오늘 랭킹·매거진·프로모션·이상탐지 등)는 반드시 전용 도구를 사용하세요. ' +
            '임의 기간 집계, 복수 테이블 조인, 상품별·브랜드별 비교 분석 등이 필요한 질문에 적합합니다. ' +
            '후속 질문은 이전 맥락을 포함한 완결된 한 문장으로 변환해 전달하세요.',
          inputSchema: {
            question: z.string().min(1).max(500)
              .describe('분석 질문 (최대 500자). 후속 질문은 이전 맥락을 포함해 완결된 문장으로 작성.'),
          },
        },
        async ({ question }) => {
          const { allowed, limit } = await checkMcpQuota();
          if (!allowed) {
            return {
              content: [{
                type: 'text' as const,
                text: `UTTU AI 서비스 계정의 오늘 분석 한도(${limit.toLocaleString()} 토큰)에 도달했습니다. ` +
                      '내일 자정(KST) 이후 다시 시도해 주세요.',
              }],
            };
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 25_000);

          let inferenceResult: Awaited<ReturnType<typeof runInferenceLoop>>;
          try {
            inferenceResult = await runInferenceLoop({
              question,
              supabase: sbSvc(),
              maxTurns: 3,
              signal: controller.signal,
            });
          } catch (e) {
            clearTimeout(timer);
            if (controller.signal.aborted) {
              return {
                content: [{
                  type: 'text' as const,
                  text: '분석 시간 초과(25초)입니다. 질문을 더 구체적으로 바꾸거나 나누어 시도해 주세요.',
                }],
              };
            }
            return {
              content: [{
                type: 'text' as const,
                text: `분석 오류: ${e instanceof Error ? e.message : '알 수 없는 오류'}`,
              }],
            };
          }
          clearTimeout(timer);

          accumulateMcpUsage(inferenceResult.inputTokens, inferenceResult.outputTokens).catch(() => {});

          return {
            content: [{
              type: 'text' as const,
              text: inferenceResult.text ||
                    '분석 결과를 생성하지 못했습니다. 질문을 더 구체적으로 바꾸어 시도해 주세요.',
            }],
          };
        },
      );
    },
    { serverInfo: { name: 'uttu', version: '1.0.0' } },
    { streamableHttpEndpoint: endpoint, maxDuration: 60 },
  );
}
