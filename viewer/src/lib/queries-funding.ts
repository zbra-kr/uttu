'use client';
import { supabaseBrowser } from './supabase/client';

// ── 타입 정의 ──────────────────────────────────────────────────────────

export interface FundingRound {
  id: string;
  company_id: string;
  round_type: string | null;
  amount_krw: number | null;
  announced_date: string | null;
  investors: string[];
  source_type: string;
  source_url: string | null;
  source_ref: string | null;
  confidence: number | null;
  created_at: string;
}

export interface FundingJob {
  id: string;
  company_id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  requested_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  rounds_found: number;
  error: string | null;
  created_at: string;
}

// ── 쿼리 함수 ──────────────────────────────────────────────────────────

/** 회사의 투자 라운드 목록 (announced_date DESC) */
export async function getFundingRounds(
  companyId: string,
  limit = 50,
): Promise<FundingRound[]> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from('funding_rounds')
    .select(
      'id, company_id, round_type, amount_krw, announced_date, investors, source_type, source_url, source_ref, confidence, created_at',
    )
    .eq('company_id', companyId)
    .order('announced_date', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error('[getFundingRounds] failed', error);
    return [];
  }
  return (data ?? []) as FundingRound[];
}

/** 회사의 최신 수집 잡 1건 */
export async function getLatestFundingJob(
  companyId: string,
): Promise<FundingJob | null> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from('funding_collection_jobs')
    .select(
      'id, company_id, status, requested_by, started_at, finished_at, rounds_found, error, created_at',
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getLatestFundingJob] failed', error);
    return null;
  }
  return data as FundingJob | null;
}

/** pollFundingJob — 4초마다 호출하는 상태 조회 */
export async function pollFundingJob(
  companyId: string,
): Promise<FundingJob | null> {
  return getLatestFundingJob(companyId);
}

// ── createFundingJob ───────────────────────────────────────────────────

export type CreateFundingJobResult =
  | { type: 'cached'; collectedAt: string }
  | { type: 'created'; job: FundingJob }
  | { type: 'error'; message: string };

/**
 * 투자정보 수집 잡 생성.
 * - companies.funding_last_collected_at 이 7일 이내이면 cached 반환
 * - 그 외: INSERT {company_id, status:'pending'} 후 created 반환
 *
 * companies 캐시 컬럼 확인은 client-side에서 직접 supabase.from('companies') 조회.
 * anon 권한으로 companies SELECT가 가능한 경우에만 캐시 체크가 동작.
 */
export async function createFundingJob(
  companyId: string,
): Promise<CreateFundingJobResult> {
  const supabase = supabaseBrowser();

  // 1) 캐시 확인
  const { data: companyRow, error: companyError } = await supabase
    .from('companies')
    .select('funding_last_collected_at')
    .eq('id', companyId)
    .limit(1)
    .maybeSingle();

  if (companyError) {
    console.error('[createFundingJob] companies query failed', companyError);
    // 캐시 확인 실패 시 그냥 잡 생성 시도
  } else if (companyRow?.funding_last_collected_at) {
    const lastAt = new Date(companyRow.funding_last_collected_at);
    const diffMs = Date.now() - lastAt.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (diffMs < sevenDaysMs) {
      return { type: 'cached', collectedAt: companyRow.funding_last_collected_at };
    }
  }

  // 2) 잡 INSERT
  const { data: jobData, error: insertError } = await supabase
    .from('funding_collection_jobs')
    .insert({ company_id: companyId, status: 'pending' })
    .select(
      'id, company_id, status, requested_by, started_at, finished_at, rounds_found, error, created_at',
    )
    .limit(1)
    .maybeSingle();

  if (insertError) {
    console.error('[createFundingJob] insert failed', insertError);
    return { type: 'error', message: insertError.message };
  }
  if (!jobData) {
    return { type: 'error', message: '잡 생성 결과 없음' };
  }
  return { type: 'created', job: jobData as FundingJob };
}
