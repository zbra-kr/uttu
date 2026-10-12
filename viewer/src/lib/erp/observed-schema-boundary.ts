import { validCSDate } from '../cs-daily-review-check';
// Observed shape from recorded read-only 2026-10-12 metadata/aggregate results.
// Full query provenance/coverage and user business-scope authorization are not established.
// No connection settings, credentials, business rows or rounding rules here.
export const SCHEMA_REASONS = {
  TYPE_METADATA_UNVERIFIED: '원천 타입 메타데이터 형식·범위 확인 필요',
  SOURCE_DATE_INVALID: '원천 날짜의 형식·달력 유효성 확인 필요',
  CENTRAL_GRAIN_UNVERIFIED: '중앙 매출은 상품·매장·일자 집계입니다 — 색상·사이즈 투영 확인 필요',
  YEAR_CENTURY_UNVERIFIED: '2자리 YEARCD의 세기·시즌 연도 변환 규칙 확인 필요',
  SIGN_RULE_UNVERIFIED: '입고 음수 관측 — 반품·취소·순입고 정의 확인 필요',
  BRAND_JOIN_UNVERIFIED: '브랜드 없는 원천의 상품 마스터 조인·키 충돌 검증 필요',
  FLOAT_PRECISION_UNVERIFIED: 'FLOAT 원천의 정밀도·반올림·정수 변환 계약 확인 필요',
  SNAPSHOT_TIME_UNVERIFIED: '재고 기준일 증빙 필요 — 거래일·INSERTDT는 ETL 갱신 시각이 아닙니다',
} as const;
export type SchemaReason = keyof typeof SCHEMA_REASONS;
function object(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
const sources = new Set(['VW_SALES_VAT','SW_STYLEINFO_DETAIL','SW_WHININFO','SW_SHOPINV','SW_WHINV']);
// Explicit descriptor grammar; classification is not a decimal conversion proof.
// Nullable suffixes mirror the recorded metadata, not arbitrary substring matches.
export function classifyOriginType(value: unknown): 'approximate' | 'exact' | 'other' | 'unknown' {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) return 'unknown';
  const descriptor = value.trim().toUpperCase().replace(/\s+/g,' ');
  const type = descriptor.replace(/ (?:NULLABLE|NOT NULL)$/,'');
  if (/^(?:FLOAT|FLOAT4|FLOAT8|REAL|DOUBLE|DOUBLE PRECISION)$/.test(type)) return 'approximate';
  const float = /^FLOAT\(\s*(\d+)\s*\)$/.exec(type);
  if (float) return Number(float[1]) >= 1 && Number(float[1]) <= 53 ? 'approximate' : 'unknown';
  if (/^(?:NUMBER|DECIMAL|NUMERIC|INT|INTEGER|BIGINT|SMALLINT)$/.test(type)) return 'exact';
  const decimal = /^(?:NUMBER|DECIMAL|NUMERIC)\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(type);
  if (decimal) {
    const precision = Number(decimal[1]), scale = Number(decimal[2] ?? 0);
    return precision >= 1 && precision <= 38 && scale >= 0 && scale <= precision ? 'exact' : 'unknown';
  }
  if (/^(?:TEXT|VARCHAR|BOOLEAN|DATE|TIMESTAMP|TIMESTAMP_NTZ|TIMESTAMP_LTZ|TIMESTAMP_TZ)$/.test(type)) return 'other';
  const timestamp = /^TIMESTAMP(?:_NTZ|_LTZ|_TZ)?\(\s*(\d+)\s*\)$/.exec(type);
  if (timestamp) return Number(timestamp[1]) <= 9 ? 'other' : 'unknown';
  const varchar = /^VARCHAR\(\s*(\d+)\s*\)$/.exec(type);
  if (varchar) return Number(varchar[1]) >= 1 && Number(varchar[1]) <= 16777216 ? 'other' : 'unknown';
  return 'unknown';
}
export function observedSchemaIssues(partition: unknown): SchemaReason[] {
  if (!object(partition)) return [];
  const issues = new Set<SchemaReason>();
  const source = partition.upstreamSource ?? partition.source;
  if (Object.hasOwn(partition,'columnTypes')) {
    if (!object(partition.columnTypes) || Object.keys(partition.columnTypes).length === 0) issues.add('TYPE_METADATA_UNVERIFIED');
    else for (const [column,descriptor] of Object.entries(partition.columnTypes)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(column)) issues.add('TYPE_METADATA_UNVERIFIED');
      const kind = classifyOriginType(descriptor);
      if (kind === 'approximate') issues.add('FLOAT_PRECISION_UNVERIFIED');
      else if (kind === 'unknown') issues.add('TYPE_METADATA_UNVERIFIED');
    }
  }
  if (typeof source === 'string' && sources.has(source)) {
    // Raw source names cannot assert that business normalization was performed.
    // A reviewed provider must expose an explicit canonical projection contract.
    if (source === 'VW_SALES_VAT') issues.add('CENTRAL_GRAIN_UNVERIFIED');
    if (source !== 'SW_WHINV') issues.add('FLOAT_PRECISION_UNVERIFIED');
    if (['SW_WHININFO','SW_SHOPINV','SW_WHINV'].includes(source)) issues.add('BRAND_JOIN_UNVERIFIED');
    if (['SW_SHOPINV','SW_WHINV'].includes(source)) issues.add('SNAPSHOT_TIME_UNVERIFIED');
  }
  if (Array.isArray(partition.rows)) for (const row of partition.rows) {
    if (!object(row)) continue;
    for (const key of ['SALEDT','ORDDT','WHINDT']) if (Object.hasOwn(row,key) && normalizeErpDate(row[key]).date === null) issues.add('SOURCE_DATE_INVALID');
    if (typeof row.YEARCD === 'string' && /^\d{2}$/.test(row.YEARCD)) issues.add('YEAR_CENTURY_UNVERIFIED');
    if ((typeof row.INQTY === 'number' && row.INQTY < 0) || (typeof row.INQTY === 'string' && /^-\d+(?:\.\d+)?$/.test(row.INQTY))) issues.add('SIGN_RULE_UNVERIFIED');
    if (['SALEAMT_VAT_EX','SALEQTY','ORDQTY','INQTY','INVQTY','AVAILQTY','ONLINEQTY','OFFLINEQTY'].some(k => typeof row[k] === 'number')) issues.add('FLOAT_PRECISION_UNVERIFIED');
  }
  return [...issues];
}

// Pure utility for a future trusted projection. Never infer a century by prefix.
// The map is supplied by reviewed server configuration, not raw provider rows.
export function normalizeSeasonYear(code: unknown, mapping: Readonly<Record<string,string>> | null) {
  if (typeof code !== 'string') return {year:null, reason:'YEAR_CENTURY_UNVERIFIED' as const};
  if (/^20\d{2}$/.test(code)) return {year:code, reason:null};
  const year = mapping && Object.hasOwn(mapping,code) ? mapping[code] : null;
  if (/^\d{2}$/.test(code) && typeof year === 'string' && /^20\d{2}$/.test(year) && year.slice(2) === code) return {year,reason:null};
  return {year:null,reason:'YEAR_CENTURY_UNVERIFIED' as const};
}

export function normalizeErpDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return {date:null,reason:'SOURCE_DATE_INVALID' as const};
  const date = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}`;
  return validCSDate(date) ? {date,reason:null} : {date:null,reason:'SOURCE_DATE_INVALID' as const};
}
