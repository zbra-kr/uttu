'use client';
import { useState, useEffect } from 'react';
import { fetchAllLlmModels, type LlmModel } from '@/lib/queries-admin';
import MobileEmptyState from '@/components/mobile/MobileEmptyState';

export default function MobileAdminLLMView() {
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllLlmModels()
      .then(data => { setModels(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--f4)', fontSize: 13 }}>불러오는 중...</div>;
  if (models.length === 0) return <MobileEmptyState icon="🤖" title="LLM 모델이 없습니다" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 12px 20px' }}>
      {models.map(m => (
        <div key={m.id} style={{ padding: '12px 13px', background: 'var(--sur)', border: '1px solid var(--bd)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--f1)' }}>{m.model_id}</div>
              <div style={{ fontSize: 11, color: 'var(--f3)', marginTop: 2 }}>{m.provider}</div>
            </div>
            <span style={{
              fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)',
              color: m.is_active ? 'var(--slf)' : 'var(--f4)',
              background: m.is_active ? 'var(--slb)' : 'var(--snk)',
              padding: '2px 6px', borderRadius: 4,
            }}>
              {m.is_active ? '활성' : '비활성'}
            </span>
          </div>
          {m.max_tokens && (
            <div style={{ fontSize: 10, color: 'var(--f4)', fontFamily: 'var(--mono)', marginTop: 4 }}>
              max_tokens {m.max_tokens.toLocaleString()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
