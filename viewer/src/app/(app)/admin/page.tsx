'use client';
import React from 'react';
import Link from 'next/link';
import {
  IcShield, IcUsers, IcSpark, IcCalendar, IcBell,
  IcMapping, IcFlag, IcUser, IcClock,
} from '@/components/ui/icons';
import {
  fetchDashboardKpi, fetchDashboardActivity,
  type DashboardKpi, type DashboardActivity,
} from '@/lib/queries-admin';
import { useIsMobile } from '@/hooks/useViewport';
import MobileAdminDashboardView from './MobileAdminDashboardView';

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────────────
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtDuration(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60)    return `${sec}초`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function timeSince(iso: string | null): string {
  if (!iso) return '—';
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)    return `${sec}초 전`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

function fmtDatetime(iso: string): string {
  const kst = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 16).replace('T', ' ');
}

// ── KPI 카드 ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, highlight, warn }: {
  label: string; value: string | number; sub?: string;
  highlight?: boolean; warn?: boolean;
}) {
  const color = highlight ? 'var(--shf)' : warn ? 'var(--smf)' : 'var(--f1)';
  return (
    <div style={{
      background: 'var(--sur)', border: `1px solid ${highlight ? 'var(--shd)' : 'var(--bd)'}`,
      borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ fontSize: 11, color: 'var(--f4)', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span style={{ fontSize: 10, color: 'var(--f4)' }}>{sub}</span>}
    </div>
  );
}

// ── 빠른 링크 카드 ─────────────────────────────────────────────────────────────
function QuickCard({ path, label, desc, Icon, kpiValue }: {
  path: string; label: string; desc: string;
  Icon: React.FC<{ size?: number; style?: React.CSSProperties }>; kpiValue?: string | number;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <Link href={path} style={{ textDecoration: 'none' }}>
      <div
        style={{
          background: 'var(--sur)', border: `1px solid ${hover ? 'var(--bst)' : 'var(--bd)'}`,
          borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
          transition: 'border-color 120ms',
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Icon size={16} style={{ color: 'var(--f3)' }} />
          {kpiValue !== undefined && (
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--f1)' }}>{kpiValue}</span>
          )}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--f4)', lineHeight: 1.5 }}>{desc}</div>
      </div>
    </Link>
  );
}

// ── 활동 타입 아이콘 / 레이블 ──────────────────────────────────────────────────
const ACTIVITY_META: Record<DashboardActivity['type'], { label: string; color: string }> = {
  anomaly:   { label: '이상탐지', color: 'var(--shf)' },
  signup:    { label: '신규 가입', color: 'var(--hs)'  },
  job_error: { label: '작업 오류', color: 'var(--smf)' },
};

export default function AdminDashboardPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileAdminDashboardView />;
  const [kpi, setKpi]         = React.useState<DashboardKpi | null>(null);
  const [activity, setActivity] = React.useState<DashboardActivity[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    const [k, a] = await Promise.all([fetchDashboardKpi(), fetchDashboardActivity()]);
    setKpi(k);
    setActivity(a);
    setLoading(false);
    setRefreshing(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const successRate = kpi
    ? kpi.jobs.total_today > 0
      ? Math.round((kpi.jobs.success_today / kpi.jobs.total_today) * 100)
      : null
    : null;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IcShield size={20} style={{ color: 'var(--hs)' }} />
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>관리 대시보드</h1>
          <span style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 4,
            background: 'var(--shb)', color: 'var(--shf)', border: '1px solid var(--shd)',
          }}>admin</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 6, border: '1px solid var(--bd)',
            background: 'var(--sur)', color: 'var(--f2)', cursor: 'pointer',
            fontSize: 12, opacity: refreshing ? 0.5 : 1,
          }}
        >
          <span style={{ display: 'inline-block', transform: refreshing ? 'rotate(360deg)' : 'none', transition: refreshing ? 'transform 0.6s linear' : 'none' }}>↻</span>
          새로고침
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--f3)', fontSize: 14 }}>불러오는 중…</div>
      ) : (
        <>
          {/* ── KPI 행 1: 사용자 ── */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--f4)', marginBottom: 8, letterSpacing: '0.06em' }}>사용자</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <KpiCard label="전체 사용자"        value={kpi?.users.total ?? 0} />
              <KpiCard label="7일 활성"           value={kpi?.users.active_7d ?? 0} sub="last_sign_in >= 7일" />
              <KpiCard label="차단됨"             value={kpi?.users.blocked ?? 0} highlight={(kpi?.users.blocked ?? 0) > 0} />
              <KpiCard label="이번달 AI 토큰"     value={fmtTokens(kpi?.users.ai_tokens_this_month ?? 0)} sub="input + output 합산" />
            </div>
          </div>

          {/* ── KPI 행 2: 작업 / 알림 ── */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--f4)', marginBottom: 8, marginTop: 16, letterSpacing: '0.06em' }}>수집 작업 &amp; 알림</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <KpiCard label="오늘 실행"       value={kpi?.jobs.total_today ?? 0} />
              <KpiCard label="성공률"          value={successRate !== null ? `${successRate}%` : '—'} sub={`성공 ${kpi?.jobs.success_today ?? 0} / 오류 ${kpi?.jobs.error_today ?? 0}`} warn={(kpi?.jobs.error_today ?? 0) > 0} />
              <KpiCard label="7일 평균 시간"   value={fmtDuration(kpi?.jobs.avg_duration_7d_sec ?? null)} />
              <KpiCard label="24h 알림 발송"   value={kpi?.notifications.total_24h ?? 0} sub={kpi?.notifications.pending ? `대기 ${kpi.notifications.pending}건` : '대기 없음'} />
            </div>
          </div>

          {/* ── KPI 행 3: 데이터 ── */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, color: 'var(--f4)', marginBottom: 8, marginTop: 16, letterSpacing: '0.06em' }}>데이터 현황</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <KpiCard label="회사 미매핑"       value={kpi?.data.unmapped_companies ?? 0} sub={`전체 ${kpi?.data.total_companies ?? 0}개 중`} warn={(kpi?.data.unmapped_companies ?? 0) > 0} />
              <KpiCard label="브랜드 수"         value={kpi?.data.total_brands ?? 0} />
              <KpiCard label="상품 수"           value={(kpi?.data.total_products ?? 0).toLocaleString()} />
              <KpiCard label="HIGH anomaly 미해소" value={kpi?.data.high_anomalies_unread ?? 0} highlight={(kpi?.data.high_anomalies_unread ?? 0) > 0} />
            </div>
          </div>

          {/* ── 2열: 빠른 링크 + 최근 활동 ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
            {/* 빠른 링크 */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--f4)', marginBottom: 10, letterSpacing: '0.06em' }}>빠른 이동</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <QuickCard
                  path="/admin/users" label="사용자 관리" desc="계정·역할·토큰 쿼터"
                  Icon={IcUsers} kpiValue={kpi?.users.total ?? 0}
                />
                <QuickCard
                  path="/admin/llm" label="LLM 관리" desc="모델 선택·API 키 상태"
                  Icon={IcSpark}
                />
                <QuickCard
                  path="/admin/jobs" label="수집 모니터링" desc="스케줄·실행 이력·에러"
                  Icon={IcCalendar} kpiValue={kpi?.jobs.error_today ? `오류 ${kpi.jobs.error_today}` : kpi?.jobs.total_today ?? 0}
                />
                <QuickCard
                  path="/admin/notifications" label="알림 모니터링" desc="채널별 발송 이력"
                  Icon={IcBell} kpiValue={kpi?.notifications.pending ? `대기 ${kpi.notifications.pending}` : undefined}
                />
                <QuickCard
                  path="/admin/mapping" label="DART 매핑" desc="회사 ↔ 브랜드 수동 매핑"
                  Icon={IcMapping} kpiValue={kpi?.data.unmapped_companies ? `미매핑 ${kpi.data.unmapped_companies}` : undefined}
                />
                <QuickCard
                  path="/admin/anomalies" label="이상탐지 룰" desc="탐지 규칙·임계값 관리"
                  Icon={IcFlag} kpiValue={kpi?.data.high_anomalies_unread || undefined}
                />
              </div>

              {/* 알림 상태 요약 */}
              {(kpi?.notifications.stuck ?? 0) > 0 && (
                <div style={{
                  marginTop: 12, padding: '10px 14px', borderRadius: 8,
                  background: 'var(--shb)', border: '1px solid var(--shd)',
                  fontSize: 12, color: 'var(--shf)',
                }}>
                  ⚠ Stuck 알림 {kpi!.notifications.stuck}건 — webhook 설정됐지만 10분 이상 미발송.
                  {' '}<Link href="/admin/notifications" style={{ color: 'var(--shf)', textDecoration: 'underline' }}>알림 모니터링 확인</Link>
                </div>
              )}
            </div>

            {/* 최근 활동 피드 */}
            <div style={{
              background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10,
              padding: '16px 18px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f2)', marginBottom: 12 }}>
                최근 24시간 활동
              </div>
              {activity.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--f4)', textAlign: 'center', padding: '20px 0' }}>
                  최근 24시간 활동 없음
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {activity.map((a, i) => {
                    const meta = ACTIVITY_META[a.type];
                    const inner = (
                      <div style={{
                        padding: '8px 10px', borderRadius: 6,
                        background: i % 2 === 0 ? 'var(--snk)' : 'transparent',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 3,
                            background: 'var(--bg)', color: meta.color, border: `1px solid ${meta.color}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {meta.label}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--f4)' }}>
                            {fmtDatetime(a.occurred_at)}
                          </span>
                        </div>
                        <div style={{
                          fontSize: 11, color: 'var(--f2)', lineHeight: 1.4,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {a.label}
                        </div>
                      </div>
                    );
                    return a.link ? (
                      <Link key={i} href={a.link} style={{ textDecoration: 'none' }}>{inner}</Link>
                    ) : (
                      <div key={i}>{inner}</div>
                    );
                  })}
                </div>
              )}

              {/* 마지막 발송 타임스탬프 */}
              {kpi?.notifications.last_dispatch_at && (
                <div style={{
                  marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--snk)',
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--f4)',
                }}>
                  <IcClock size={11} style={{ color: 'var(--f4)' }} />
                  마지막 알림 발송 {timeSince(kpi.notifications.last_dispatch_at)}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
