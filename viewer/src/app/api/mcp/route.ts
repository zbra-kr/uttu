import { timingSafeEqual } from 'crypto';
import { NextRequest } from 'next/server';
import { createMcpHandler } from 'mcp-handler';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ─── Bearer 인증 (기존 로직 유지) ──────────────────────────────────────────
function verifyBearer(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.UTTU_MCP_TOKEN ?? '';
  if (!incoming || !expected) return false;
  const a = Buffer.from(incoming, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─── Supabase anon 클라이언트 팩토리 ───────────────────────────────────────
// 요청마다 생성하지 않도록 모듈 스코프에서 싱글턴 유지
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

const LIMIT = 50;

// ─── KST 오늘 날짜 ─────────────────────────────────────────────────────────
function kstToday() {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// ─── MCP 핸들러 ────────────────────────────────────────────────────────────
const mcpHandler = createMcpHandler(
  (server) => {

    // 1. get_today_briefing ─────────────────────────────────────────────────
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

    // 2. get_ranking ────────────────────────────────────────────────────────
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

    // 3. get_brand_ranking ──────────────────────────────────────────────────
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

    // 4. get_brand_trend ────────────────────────────────────────────────────
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

    // 5. get_today_magazine ─────────────────────────────────────────────────
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

    // 6. get_promotions ─────────────────────────────────────────────────────
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

    // 7. get_review_summary ─────────────────────────────────────────────────
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

    // 8. get_snap_highlights ────────────────────────────────────────────────
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

    // 9. get_anomalies ──────────────────────────────────────────────────────
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

    // 10. get_brand_info ────────────────────────────────────────────────────
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

        // 현재 랭킹 통계
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
  },
  { serverInfo: { name: 'uttu', version: '1.0.0' } },
  {
    streamableHttpEndpoint: '/api/mcp',
    maxDuration: 60,
  },
);

// ─── 라우트 핸들러 ──────────────────────────────────────────────────────────
async function handler(req: NextRequest): Promise<Response> {
  if (!verifyBearer(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return mcpHandler(req);
}

export { handler as GET, handler as POST };
