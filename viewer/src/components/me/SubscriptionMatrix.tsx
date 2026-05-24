'use client';
import React from 'react';
import {
  NotificationEvent,
  NotificationChannel,
  fetchMySubscriptions,
  toggleSubscription,
} from '@/lib/queries-me';

const EVENT_LABELS: Record<NotificationEvent, string> = {
  daily_summary:          '일간 요약',
  anomaly_high:           '이상탐지 HIGH',
  anomaly_med:            '이상탐지 MED',
  mention:                '언급',
  dart_new_disclosure:    '신규 공시',
  review_low_rating:      '저평점 리뷰',
  rank_change_bookmarked: '랭킹 변동',
};

const EVENTS = Object.keys(EVENT_LABELS) as NotificationEvent[];

interface Props {
  isAdmin: boolean;
}

export default function SubscriptionMatrix({ isAdmin }: Props) {
  const [subs, setSubs] = React.useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchMySubscriptions().then(rows => {
      const m = new Map<string, boolean>();
      for (const r of rows) m.set(`${r.event_type}:${r.channel}`, r.enabled);
      setSubs(m);
      setLoading(false);
    });
  }, []);

  const handleToggle = async (event_type: NotificationEvent, channel: NotificationChannel) => {
    const key = `${event_type}:${channel}`;
    const current = subs.get(key) ?? false;
    const next = !current;
    setSubs(prev => new Map(prev).set(key, next));
    const { error } = await toggleSubscription(event_type, channel, next);
    if (error) setSubs(prev => new Map(prev).set(key, current));
  };

  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--f4)', padding: '8px 0' }}>불러오는 중…</div>;
  }

  const channels: NotificationChannel[] = isAdmin ? ['teams', 'telegram'] : ['teams'];

  return (
    <div>
      <div className="row-flex center" style={{ paddingBottom: 6, borderBottom: '0.5px solid var(--bs)', marginBottom: 2 }}>
        <span style={{ flex: 1 }} />
        {channels.map(ch => (
          <span key={ch} className="mono dim" style={{ width: 54, textAlign: 'center', fontSize: 10 }}>
            {ch === 'teams' ? 'Teams' : 'TG'}
          </span>
        ))}
      </div>
      {EVENTS.map((ev, i) => (
        <div
          key={ev}
          className="row-flex center"
          style={{ padding: '7px 0', borderBottom: i < EVENTS.length - 1 ? '0.5px dashed var(--bs)' : 'none' }}
        >
          <span style={{ flex: 1, fontSize: 12, color: 'var(--f2)' }}>{EVENT_LABELS[ev]}</span>
          {channels.map(ch => {
            const on = subs.get(`${ev}:${ch}`) ?? false;
            return (
              <div key={ch} style={{ width: 54, display: 'flex', justifyContent: 'center' }}>
                <div className={`toggle ${on ? 'on' : ''}`} onClick={() => handleToggle(ev, ch)}>
                  <div className="thumb" />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
