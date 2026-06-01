'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import {
  fetchCompanyInfo, fetchCompanyFinancials, fetchCompanyBrands, fetchCompanyDisclosures,
  type CompanyInfo, type DartFinancial, type CompanyBrand, type DartDisclosure,
} from '@/lib/queries';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

function fmtB(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  if (abs >= 100_000_000)       return `${Math.round(v / 100_000_000).toLocaleString()}억`;
  if (abs >= 10_000)            return `${Math.round(v / 10_000).toLocaleString()}만`;
  return v.toLocaleString();
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function opMargin(fin: DartFinancial): number | null {
  if (!fin.revenue || !fin.operating_income) return null;
  return (fin.operating_income / fin.revenue) * 100;
}

function debtRatio(fin: DartFinancial): number | null {
  if (!fin.total_assets || !fin.total_liabilities) return null;
  const equity = fin.total_assets - fin.total_liabilities;
  if (equity <= 0) return null;
  return (fin.total_liabilities / equity) * 100;
}

export default function MobileCompanyDetailView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const companyId = searchParams.get('id') ?? '';

  const [info, setInfo] = useState<CompanyInfo | null>(null);
  const [financials, setFinancials] = useState<DartFinancial[]>([]);
  const [brands, setBrands] = useState<CompanyBrand[]>([]);
  const [disclosures, setDisclosures] = useState<DartDisclosure[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      fetchCompanyInfo(companyId),
      fetchCompanyFinancials(companyId),
      fetchCompanyBrands(companyId),
      fetchCompanyDisclosures(companyId, 10),
    ]).then(([inf, fins, brds, discs]) => {
      setInfo(inf);
      setFinancials(fins.slice(0, 5));
      setBrands(brds);
      setDisclosures(discs);
      setLoading(false);
    });
  }, [companyId]);

  if (!companyId) return <MobileEmptyState icon="🔍" title="회사 ID가 없습니다" />;
  if (loading) return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;
  if (!info) return <MobileEmptyState icon="🏢" title="회사 정보를 찾을 수 없습니다" />;

  const latestFin = financials[0] ?? null;
  const chartData = [...financials].reverse().map(f => ({
    year: String(f.fiscal_year),
    revenue: f.revenue ? Math.round(f.revenue / 100_000_000) : null,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 12px 20px' , width: '100%', minWidth: 0 }}>
      {/* 헤더 */}
      <div style={{ padding: '14px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--f1)' }}>{info.corp_name}</span>
              {info.is_listed && (
                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--slf)', background: 'var(--slb)', padding: '1px 5px', borderRadius: 4 }}>
                  상장
                </span>
              )}
              {info.corp_code && (
                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--hs)', background: 'var(--hs-soft)', padding: '1px 5px', borderRadius: 4 }}>
                  DART ✓
                </span>
              )}
            </div>
            {info.stock_code && (
              <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>종목코드 {info.stock_code}</div>
            )}
          </div>
        </div>

        {/* 재무 KPI 4개 */}
        {latestFin && (
          <div style={{ marginTop: 12, display: 'flex', gap: 0, borderTop: '1px solid var(--bd)', paddingTop: 10, flexWrap: 'wrap' }}>
            {[
              { label: '매출', value: fmtB(latestFin.revenue) },
              { label: '영업이익', value: fmtB(latestFin.operating_income) },
              { label: '이익률', value: fmtPct(opMargin(latestFin)) },
              { label: '부채비율', value: debtRatio(latestFin) != null ? `${Math.round(debtRatio(latestFin)!)}%` : '—' },
            ].map(kpi => (
              <div key={kpi.label} style={{ flex: '1 1 50%', textAlign: 'center', padding: '4px 0' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--f1)', fontFamily: 'var(--mono)' }}>{kpi.value}</div>
                <div style={{ fontSize: 10, color: 'var(--f4)', marginTop: 1 }}>{kpi.label} ({latestFin.fiscal_year})</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 매출 추이 */}
      {chartData.length >= 2 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>매출 추이 (억원)</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} width={40} />
              <Tooltip formatter={(v: unknown) => [`${v as number}억`, '매출']} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" fill="var(--hs)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 보유 브랜드 */}
      {brands.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>보유 브랜드 {brands.length}개</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {brands.map(b => (
              <span
                key={b.id}
                onClick={() => router.push(`/brand?id=${b.id}`)}
                style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 12,
                  background: b.is_own ? 'var(--hs-soft)' : 'var(--snk)',
                  color: b.is_own ? 'var(--hs)' : 'var(--f2)',
                  border: `1px solid ${b.is_own ? 'var(--hs)' : 'var(--bd)'}`,
                  cursor: 'pointer',
                }}
              >
                {b.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 최근 공시 */}
      {disclosures.length > 0 && (
        <div style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--f4)', fontFamily: 'var(--mono)', marginBottom: 8 }}>최근 공시</div>
          {disclosures.map((d, i) => (
            <div key={d.id} style={{ paddingTop: i > 0 ? 8 : 0, marginTop: i > 0 ? 8 : 0, borderTop: i > 0 ? '1px solid var(--bd)' : 'none' }}>
              <div style={{ fontSize: 12, color: 'var(--f1)' }}>{d.report_nm}</div>
              <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                {d.rcept_dt.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')}
                {d.flr_nm && ` · ${d.flr_nm}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
