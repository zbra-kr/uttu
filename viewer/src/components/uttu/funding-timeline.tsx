import React from 'react';
import { type FundingRound } from '@/lib/queries-funding';

interface Props {
  rounds: FundingRound[];
}

// ── 금액 포맷 ─────────────────────────────────────────────────────────

function formatAmount(v: number | null): string {
  if (v == null) return '비공개';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `₩ ${(v / 1_000_000_000_000).toFixed(1)}조`;
  if (abs >= 100_000_000)       return `₩ ${Math.round(v / 100_000_000)}억`;
  if (abs >= 10_000)            return `₩ ${Math.round(v / 10_000).toLocaleString()}만`;
  return `₩ ${v.toLocaleString()}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '날짜 미상';
  return iso.slice(0, 10).replace(/-/g, '.');
}

// ── 출처 뱃지 ─────────────────────────────────────────────────────────

interface BadgeProps { sourceType: string; confidence: number | null }

function SourceBadge({ sourceType, confidence }: BadgeProps) {
  const isDart = sourceType.startsWith('dart_') || sourceType.startsWith('datago_');
  const isUnverified = !isDart && sourceType === 'news' && confidence != null && confidence < 1.0;
  const isVerifiedNews = !isDart && sourceType === 'news' && confidence === 1.0;

  if (isDart) {
    return (
      <span className="chip" style={{
        fontSize: 9,
        background: 'var(--slb)',
        color: 'var(--slf)',
        borderColor: 'var(--slf)',
      }}>
        공시
      </span>
    );
  }
  if (isUnverified) {
    return (
      <span className="chip" style={{
        fontSize: 9,
        background: 'var(--smb)',
        color: 'var(--smf)',
        borderColor: 'var(--smf)',
      }}>
        미검증
      </span>
    );
  }
  if (isVerifiedNews) {
    return (
      <span className="chip" style={{
        fontSize: 9,
        background: 'var(--snk)',
        color: 'var(--f3)',
        borderColor: 'var(--bd)',
      }}>
        뉴스
      </span>
    );
  }
  // fallback
  return (
    <span className="chip" style={{
      fontSize: 9,
      background: 'var(--snk)',
      color: 'var(--f4)',
      borderColor: 'var(--bd)',
    }}>
      {sourceType}
    </span>
  );
}

// ── 타임라인 아이템 ───────────────────────────────────────────────────

function RoundItem({ round }: { round: FundingRound }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '100px 1fr',
      gap: '0 16px',
      padding: '12px 0',
      borderBottom: '0.5px solid var(--snk)',
    }}>
      {/* 왼쪽: 날짜 + 라운드 타입 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>
          {formatDate(round.announced_date)}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--f1)' }}>
          {round.round_type ?? '—'}
        </span>
      </div>

      {/* 오른쪽: 금액 + 투자자 + 출처 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* 금액 */}
        <span className="mono" style={{
          fontSize: 14,
          fontWeight: 700,
          color: round.amount_krw != null ? 'var(--f1)' : 'var(--f4)',
        }}>
          {formatAmount(round.amount_krw)}
        </span>

        {/* 투자자 chips */}
        {round.investors.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {round.investors.map((inv, i) => (
              <span key={i} style={{
                fontSize: 10,
                padding: '2px 6px',
                background: 'var(--snk)',
                border: '0.5px solid var(--bd)',
                borderRadius: 'var(--r-1)',
                color: 'var(--f2)',
              }}>
                {inv}
              </span>
            ))}
          </div>
        )}

        {/* 출처 행 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SourceBadge sourceType={round.source_type} confidence={round.confidence} />
          {round.source_url && (
            <a
              href={round.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 10, color: 'var(--hs)', textDecoration: 'none' }}
            >
              원문 ↗
            </a>
          )}
          {round.confidence != null && round.confidence < 1.0 && (
            <span className="mono" style={{ fontSize: 9, color: 'var(--f4)' }}>
              신뢰도 {(round.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────

export function FundingTimeline({ rounds }: Props) {
  if (rounds.length === 0) {
    return (
      <div style={{
        padding: '40px 0',
        textAlign: 'center',
        color: 'var(--f4)',
        fontSize: 12,
      }}>
        수집된 투자정보가 없습니다. [투자정보 수집] 버튼을 눌러 수집하세요.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--f4)', marginBottom: 8 }}>
        비상장 제3자배정 사모 라운드는 공시 면제로 뉴스에만 의존합니다 · 미검증 뱃지는 NLP 추출 데이터
      </div>
      {rounds.map((r) => (
        <RoundItem key={r.id} round={r} />
      ))}
    </div>
  );
}
