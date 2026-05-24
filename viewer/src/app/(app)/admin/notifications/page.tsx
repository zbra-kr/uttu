'use client';
import React from 'react';
import { IcBell } from '@/components/ui/icons';
import { HorizBars } from '@/components/ui/charts';
import {
  fetchNotificationsKpi, fetchRecentNotifications, fetchEventTypeDistribution, fetchUserWebhookStatus,
  type NotificationsKpi, type NotificationRow, type EventTypeDistribution, type UserWebhookStatus,
} from '@/lib/queries-admin';

// ── 포맷 헬퍼 ──────────────────────────────────────────────────────────────────
function fmtDatetime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const kst = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 16).replace('T', ' ');
}

function timeSince(iso: string | null): string {
  if (!iso) return '—';
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)   return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

const EVENT_LABEL: Record<string, string> = {
  daily_summary:        '일일 요약',
  anomaly_high:         '이상탐지 (심각)',
  anomaly_med:          '이상탐지 (보통)',
  mention:              '멘션',
  dart_new_disclosure:  'DART 공시',
  review_low_rating:    '저평점 리뷰',
  rank_change_bookmarked: '순위 변동',
};

// ── KPI 카드 ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, highlight }: {
  label: string; value: string | number; sub?: string; highlight?: boolean;
}) {
  return (
    <div style={{
      background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 130,
    }}>
      <span style={{ fontSize: 12, color: 'var(--f3)' }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: highlight ? 'var(--shf)' : 'var(--f1)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span style={{ fontSize: 11, color: 'var(--f4)' }}>{sub}</span>}
    </div>
  );
}

// ── 이벤트 타입 레이블 ──────────────────────────────────────────────────────────
function eventLabel(et: string): string {
  return EVENT_LABEL[et] ?? et;
}

export default function NotificationsAdminPage() {
  const [kpi, setKpi]           = React.useState<NotificationsKpi | null>(null);
  const [recents, setRecents]   = React.useState<NotificationRow[]>([]);
  const [dist, setDist]         = React.useState<EventTypeDistribution[]>([]);
  const [users, setUsers]       = React.useState<UserWebhookStatus[]>([]);
  const [loading, setLoading]   = React.useState(true);
  const [lastRefresh, setLastRefresh] = React.useState<Date | null>(null);

  const refresh = React.useCallback(async () => {
    const [k, r, d, u] = await Promise.all([
      fetchNotificationsKpi(),
      fetchRecentNotifications(50),
      fetchEventTypeDistribution(),
      fetchUserWebhookStatus(),
    ]);
    setKpi(k);
    setRecents(r);
    setDist(d);
    setUsers(u);
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  React.useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const horizData = dist.map(d => ({ name: eventLabel(d.event_type), value: d.count_7d }));

  const webhookRate = kpi && kpi.total_users > 0
    ? Math.round((kpi.webhook_set_users / kpi.total_users) * 100)
    : 0;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <IcBell size={20} style={{ color: 'var(--f2)' }} />
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>알림 모니터링</h1>
        {!loading && (
          <span style={{ fontSize: 11, color: 'var(--f4)', marginLeft: 8 }}>
            {lastRefresh ? `${timeSince(lastRefresh.toISOString())} 갱신 · 60초마다 자동 새로고침` : ''}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--f3)', fontSize: 14 }}>불러오는 중…</div>
      ) : (
        <>
          {/* KPI 카드 4개 */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <KpiCard label="24시간 발송" value={kpi?.total_24h ?? 0} sub="Teams 발송 완료" />
            <KpiCard label="7일 발송"    value={kpi?.total_7d ?? 0}  sub="누적 발송량" />
            <KpiCard label="미전송 대기" value={kpi?.pending ?? 0}   sub="sent_to_teams_at = NULL" highlight={(kpi?.pending ?? 0) > 0} />
            <KpiCard label="Stuck"       value={kpi?.stuck ?? 0}     sub="10분 이상 대기 + webhook 설정" highlight={(kpi?.stuck ?? 0) > 0} />
          </div>

          {/* 메타 행 */}
          <div style={{
            display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap',
            background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 8,
            padding: '10px 16px', marginBottom: 24, fontSize: 12, color: 'var(--f3)',
          }}>
            <span>마지막 발송: <strong style={{ color: 'var(--f1)' }}>{timeSince(kpi?.last_dispatch_at ?? null)}</strong></span>
            <span>Webhook 설정률: <strong style={{ color: 'var(--f1)' }}>{webhookRate}%</strong> ({kpi?.webhook_set_users ?? 0} / {kpi?.total_users ?? 0}명)</span>
            <span style={{ color: 'var(--f4)', fontSize: 11 }}>
              ※ 발송 성공/실패는 현재 구분되지 않습니다 (sent_at 마킹은 발송 시도 시각)
            </span>
          </div>

          {/* 2열 레이아웃: 이벤트 분포 + 사용자 webhook 현황 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            {/* 이벤트 타입 분포 (7일) */}
            <div style={{
              background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, padding: '16px 20px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--f2)' }}>
                이벤트 타입 분포 (7일)
              </div>
              {horizData.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--f4)' }}>데이터 없음</div>
              ) : (
                <HorizBars data={horizData} labelWidth={120} color="var(--hs)" />
              )}
              {dist.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {dist.map(d => (
                    <div key={d.event_type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--f3)' }}>
                      <span>{eventLabel(d.event_type)}</span>
                      <span style={{ fontFamily: 'var(--mono)' }}>
                        24h: {d.count_24h.toLocaleString()} &nbsp; 7d: {d.count_7d.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 사용자 Webhook 현황 */}
            <div style={{
              background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, padding: '16px 20px',
              overflow: 'hidden',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--f2)' }}>
                사용자 알림 채널 현황
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--bd)', color: 'var(--f3)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 500 }}>사용자</th>
                      <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 500 }}>Teams</th>
                      <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 500 }}>Telegram</th>
                      <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 500 }}>구독</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.user_id} style={{ borderBottom: '1px solid var(--snk)' }}>
                        <td style={{ padding: '5px 6px' }}>
                          <div style={{ fontWeight: 500, color: 'var(--f1)' }}>{u.display_name ?? '—'}</div>
                          <div style={{ fontSize: 10, color: 'var(--f4)' }}>{u.email}</div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 6px' }}>
                          <span style={{ color: u.has_teams_webhook ? 'var(--slf)' : 'var(--f4)' }}>
                            {u.has_teams_webhook ? '✓' : '—'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 6px' }}>
                          <span style={{ color: u.has_telegram_chat_id ? 'var(--slf)' : 'var(--f4)' }}>
                            {u.has_telegram_chat_id ? '✓' : '—'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', fontFamily: 'var(--mono)', color: 'var(--f2)' }}>
                          {u.active_subscriptions}
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 12, color: 'var(--f4)', textAlign: 'center' }}>데이터 없음</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 최근 알림 목록 */}
          <div style={{
            background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10, padding: '16px 20px',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--f2)' }}>
              최근 알림 50건
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bd)', color: 'var(--f3)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>생성 시각</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>사용자</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>이벤트</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500, maxWidth: 260 }}>제목</th>
                    <th style={{ textAlign: 'center', padding: '4px 8px', fontWeight: 500 }}>Teams</th>
                    <th style={{ textAlign: 'center', padding: '4px 8px', fontWeight: 500 }}>Telegram</th>
                  </tr>
                </thead>
                <tbody>
                  {recents.map(n => (
                    <tr key={n.id} style={{ borderBottom: '1px solid var(--snk)' }}>
                      <td style={{ padding: '5px 8px', fontFamily: 'var(--mono)', color: 'var(--f3)', whiteSpace: 'nowrap' }}>
                        {fmtDatetime(n.created_at)}
                      </td>
                      <td style={{ padding: '5px 8px', color: 'var(--f2)' }}>{n.user_label}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4,
                          background: 'var(--snk)', color: 'var(--f2)',
                        }}>
                          {eventLabel(n.event_type)}
                        </span>
                      </td>
                      <td style={{ padding: '5px 8px', color: 'var(--f1)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.title}
                      </td>
                      <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                        {n.sent_to_teams_at ? (
                          <span style={{ color: 'var(--slf)', fontSize: 11 }}>{fmtDatetime(n.sent_to_teams_at).slice(11)}</span>
                        ) : (
                          <span style={{ color: 'var(--f4)' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                        {n.sent_to_telegram_at ? (
                          <span style={{ color: 'var(--slf)', fontSize: 11 }}>{fmtDatetime(n.sent_to_telegram_at).slice(11)}</span>
                        ) : (
                          <span style={{ color: 'var(--f4)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recents.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 16, color: 'var(--f4)', textAlign: 'center' }}>알림 데이터 없음</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
