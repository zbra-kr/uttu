'use client';
import React from 'react';
import { IcX } from '@/components/ui/icons';
import type { CollectionJob } from '@/lib/queries-admin';
import { fmtDuration, fmtDateTime } from '@/lib/format';

const STATUS_COLOR: Record<string, string> = {
  done:    'var(--slf)',
  error:   'var(--shf)',
  running: 'var(--smf)',
};
const STATUS_LABEL: Record<string, string> = {
  done:    '완료',
  error:   '오류',
  running: '실행 중',
};

interface Props {
  job: CollectionJob;
  onClose: () => void;
}

export default function JobDetailModal({ job, onClose }: Props) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg)', border: '0.5px solid var(--bd)',
        borderRadius: 8, width: '100%', maxWidth: 560,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '0.5px solid var(--bs)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
              background: `color-mix(in srgb, ${STATUS_COLOR[job.status]} 15%, transparent)`,
              color: STATUS_COLOR[job.status],
              border: `0.5px solid ${STATUS_COLOR[job.status]}`,
              fontFamily: 'var(--mono)',
            }}>
              {STATUS_LABEL[job.status] ?? job.status}
            </span>
            <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--f1)' }}>
              {job.label ?? job.script}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--f3)', padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center',
            }}
            title="닫기 (Esc)"
          >
            <IcX size={16} />
          </button>
        </div>

        {/* 본문 */}
        <div style={{ padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 메타 그리드 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['script',    job.script                                      ],
              ['시작',      fmtDateTime(job.started_at)                     ],
              ['완료',      fmtDateTime(job.finished_at)                    ],
              ['소요 시간', fmtDuration(job.started_at, job.finished_at)   ],
              ['진행',      job.target
                              ? `${job.rows_done.toLocaleString()} / ${job.target.toLocaleString()}`
                              : `${job.rows_done.toLocaleString()} 행`        ],
              ['ID',        String(job.id)                                  ],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.04em' }}>{k}</span>
                <span style={{ fontSize: 12, color: 'var(--f1)', fontFamily: k === 'script' || k === 'ID' ? 'var(--mono)' : undefined }}>
                  {v}
                </span>
              </div>
            ))}
          </div>

          {/* error_msg */}
          {job.error_msg && (
            <div>
              <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.04em', marginBottom: 6 }}>
                오류 메시지
              </div>
              <pre style={{
                background: 'var(--snk)', border: '0.5px solid var(--shf)',
                borderRadius: 4, padding: '10px 12px',
                fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.6,
                color: 'var(--shf)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 260, overflowY: 'auto', margin: 0,
              }}>
                {job.error_msg}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
