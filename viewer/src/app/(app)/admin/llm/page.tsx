'use client';
import React from 'react';
import { IcSpark } from '@/components/ui/icons';
import {
  fetchLlmProviders, fetchAllLlmModels,
  createLlmModel, updateLlmModel, deleteLlmModel,
  type LlmModel, type LlmProviders,
} from '@/lib/queries-admin';
import { useIsMobile } from '@/hooks/useViewport';
import MobileAdminLLMView from './MobileAdminLLMView';

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Claude',
  openai:    'OpenAI',
  google:    'Gemini',
};

const PROVIDER_COLOR: Record<string, string> = {
  anthropic: 'var(--hs)',
  openai:    'var(--slf)',
  google:    'var(--smf)',
};

const QUICK_MODELS: Record<string, Array<{ model_id: string; display_name: string }>> = {
  anthropic: [
    { model_id: 'claude-sonnet-4-6',        display_name: 'Claude Sonnet 4.6'  },
    { model_id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5'  },
    { model_id: 'claude-opus-4-7',          display_name: 'Claude Opus 4.7'   },
  ],
  openai: [
    { model_id: 'gpt-4o',       display_name: 'GPT-4o'       },
    { model_id: 'gpt-4o-mini',  display_name: 'GPT-4o mini'  },
    { model_id: 'gpt-4-turbo',  display_name: 'GPT-4 Turbo'  },
    { model_id: 'o1-mini',      display_name: 'o1-mini'       },
  ],
  google: [
    { model_id: 'gemini-2.0-flash-exp', display_name: 'Gemini 2.0 Flash Exp' },
    { model_id: 'gemini-1.5-pro',       display_name: 'Gemini 1.5 Pro'        },
    { model_id: 'gemini-1.5-flash',     display_name: 'Gemini 1.5 Flash'      },
  ],
};

const INITIAL_FORM = {
  provider: 'anthropic',
  model_id: '',
  display_name: '',
  is_default: false,
  is_active: true,
  max_tokens: '' as string,
};

export default function AdminLlmPage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileAdminLLMView />;
  return <AdminLlmDesktopView />;
}

function AdminLlmDesktopView() {
  const [models,    setModels]    = React.useState<LlmModel[]>([]);
  const [providers, setProviders] = React.useState<LlmProviders | null>(null);
  const [loading,   setLoading]   = React.useState(true);
  const [showForm,  setShowForm]  = React.useState(false);
  const [form,      setForm]      = React.useState(INITIAL_FORM);
  const [saving,    setSaving]    = React.useState(false);
  const [formErr,   setFormErr]   = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [m, p] = await Promise.all([fetchAllLlmModels(), fetchLlmProviders()]);
    setModels(m);
    setProviders(p);
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const activeCount  = models.filter(m => m.is_active).length;
  const keyOkCount   = providers ? [providers.claude, providers.openai, providers.gemini].filter(Boolean).length : 0;
  const defaultModel = models.find(m => m.is_default);

  const handleToggle = async (m: LlmModel) => {
    const next = !m.is_active;
    if (next && !providerKeyOk(m.provider)) {
      alert(`${PROVIDER_LABEL[m.provider] ?? m.provider} API key 미설정 — 활성화 불가`);
      return;
    }
    const { error } = await updateLlmModel(m.id, { is_active: next });
    if (error) alert(error);
    else setModels(prev => prev.map(x => x.id === m.id ? { ...x, is_active: next } : x));
  };

  const handleSetDefault = async (m: LlmModel) => {
    if (m.is_default) return;
    const { error } = await updateLlmModel(m.id, { is_default: true });
    if (error) alert(error);
    else setModels(prev => prev.map(x => ({ ...x, is_default: x.id === m.id })));
  };

  const handleDelete = async (m: LlmModel) => {
    if (m.is_default) { alert('기본 모델은 삭제 불가 — 다른 모델을 기본으로 지정 후 삭제해 주세요'); return; }
    if (!confirm(`"${m.display_name}" 모델을 삭제할까요?`)) return;
    const { error } = await deleteLlmModel(m.id);
    if (error) alert(error);
    else setModels(prev => prev.filter(x => x.id !== m.id));
  };

  const providerKeyOk = (provider: string) => {
    if (!providers) return false;
    return provider === 'anthropic' ? providers.claude
         : provider === 'openai'    ? providers.openai
         : provider === 'google'    ? providers.gemini
         : false;
  };

  const handleQuickModel = (preset: { model_id: string; display_name: string }) => {
    setForm(f => ({ ...f, model_id: preset.model_id, display_name: preset.display_name }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    if (!form.model_id.trim() || !form.display_name.trim()) {
      setFormErr('model_id와 display_name 필수');
      return;
    }
    setSaving(true);
    const { error } = await createLlmModel({
      provider:     form.provider,
      model_id:     form.model_id.trim(),
      display_name: form.display_name.trim(),
      is_default:   form.is_default,
      is_active:    form.is_active,
      max_tokens:   form.max_tokens ? Number(form.max_tokens) : null,
    });
    setSaving(false);
    if (error) { setFormErr(error); return; }
    setForm(INITIAL_FORM);
    setShowForm(false);
    load();
  };

  return (
    <>
      <div className="page-title">
        <IcSpark size={18} style={{ color: 'var(--hs)' }} />
        <h1>LLM 관리</h1>
        <span className="chip" style={{ background: 'var(--shb)', color: 'var(--shf)', borderColor: 'var(--shf)' }}>admin</span>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-3 gap-14" style={{ marginBottom: 24 }}>
        <section className="panel">
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.06em', marginBottom: 6 }}>활성 모델</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--f1)' }}>{loading ? '—' : activeCount}</div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>of {models.length} 등록</div>
        </section>
        <section className="panel">
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.06em', marginBottom: 6 }}>API Key</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: keyOkCount > 0 ? 'var(--slf)' : 'var(--shf)' }}>
            {loading ? '—' : `${keyOkCount} / 3`}
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>provider 설정됨</div>
        </section>
        <section className="panel">
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.06em', marginBottom: 6 }}>기본 모델</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--f1)', marginTop: 8, wordBreak: 'break-all' }}>
            {loading ? '—' : (defaultModel?.display_name ?? '없음')}
          </div>
          {defaultModel && (
            <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>{defaultModel.model_id}</div>
          )}
        </section>
      </div>

      {/* Provider API Key 상태 */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 500, fontSize: 12, color: 'var(--f2)', marginBottom: 12 }}>API Key 상태</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(
            [
              { key: 'claude',  provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY' },
              { key: 'openai',  provider: 'openai',    envVar: 'OPENAI_API_KEY'    },
              { key: 'gemini',  provider: 'google',    envVar: 'GEMINI_API_KEY'    },
            ] as const
          ).map(({ key, provider, envVar }) => {
            const ok = providers?.[key] ?? false;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px',
                  borderRadius: 3, background: `color-mix(in srgb, ${PROVIDER_COLOR[provider]} 15%, transparent)`,
                  color: PROVIDER_COLOR[provider], border: `0.5px solid ${PROVIDER_COLOR[provider]}`,
                  fontFamily: 'var(--mono)', width: 58, textAlign: 'center', flexShrink: 0,
                }}>
                  {PROVIDER_LABEL[provider]}
                </span>
                {ok ? (
                  <span style={{ fontSize: 12, color: 'var(--slf)' }}>✅ 설정됨</span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--smf)' }}>
                    ⚠️ {envVar} 미설정 — Vercel 환경변수 추가 필요
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 모델 리스트 */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="row-flex between center" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--f1)' }}>모델 목록</div>
          <button className="btn sm" onClick={() => { setShowForm(f => !f); setFormErr(null); }}>
            {showForm ? '취소' : '+ 모델 추가'}
          </button>
        </div>

        {/* 추가 폼 */}
        {showForm && (
          <form onSubmit={handleSubmit} style={{
            background: 'var(--snk)', border: '0.5px solid var(--bd)', borderRadius: 5,
            padding: '14px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {/* Provider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
                <label className="mono dim" style={{ fontSize: 10 }}>Provider</label>
                <select
                  value={form.provider}
                  onChange={e => setForm(f => ({ ...f, provider: e.target.value, model_id: '', display_name: '' }))}
                  style={{ background: 'var(--sur)', border: '0.5px solid var(--bd)', borderRadius: 5, padding: '4px 8px', fontSize: 12, color: 'var(--f1)' }}
                >
                  {(['anthropic', 'openai', 'google'] as const).map(p => (
                    <option key={p} value={p} disabled={!providerKeyOk(p)}>
                      {PROVIDER_LABEL[p]}{!providerKeyOk(p) ? ' (key 미설정)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* 빠른 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
                <label className="mono dim" style={{ fontSize: 10 }}>빠른 선택</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(QUICK_MODELS[form.provider] ?? []).map(preset => (
                    <button
                      key={preset.model_id}
                      type="button"
                      className="btn sm"
                      style={form.model_id === preset.model_id
                        ? { background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }
                        : {}}
                      onClick={() => handleQuickModel(preset)}
                    >
                      {preset.display_name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 180 }}>
                <label className="mono dim" style={{ fontSize: 10 }}>model_id</label>
                <input
                  value={form.model_id}
                  onChange={e => setForm(f => ({ ...f, model_id: e.target.value }))}
                  placeholder="gpt-4o"
                  style={{ background: 'var(--sur)', border: '0.5px solid var(--bd)', borderRadius: 5, padding: '4px 8px', fontSize: 12, color: 'var(--f1)', fontFamily: 'var(--mono)' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 180 }}>
                <label className="mono dim" style={{ fontSize: 10 }}>표시 이름</label>
                <input
                  value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="GPT-4o"
                  style={{ background: 'var(--sur)', border: '0.5px solid var(--bd)', borderRadius: 5, padding: '4px 8px', fontSize: 12, color: 'var(--f1)' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 90 }}>
                <label className="mono dim" style={{ fontSize: 10 }}>max_tokens</label>
                <input
                  value={form.max_tokens}
                  onChange={e => setForm(f => ({ ...f, max_tokens: e.target.value }))}
                  placeholder="8192"
                  type="number"
                  style={{ background: 'var(--sur)', border: '0.5px solid var(--bd)', borderRadius: 5, padding: '4px 8px', fontSize: 12, color: 'var(--f1)', fontFamily: 'var(--mono)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--f2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                활성화
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--f2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
                기본 모델로 설정
              </label>
            </div>

            {formErr && (
              <div style={{ fontSize: 12, color: 'var(--shf)', fontFamily: 'var(--mono)' }}>{formErr}</div>
            )}

            <div>
              <button type="submit" className="btn sm" disabled={saving} style={{ background: 'var(--hs-soft)', color: 'var(--hs)', borderColor: 'var(--hs)' }}>
                {saving ? '저장 중…' : '추가'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="mono dim" style={{ fontSize: 12, padding: 12 }}>불러오는 중…</div>
        ) : models.length === 0 ? (
          <div className="mono dim" style={{ fontSize: 12, padding: 12 }}>등록된 모델이 없습니다</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid var(--bd)' }}>
                {['Provider', 'model_id', '표시 이름', '활성', '기본', ''].map((h, i) => (
                  <th key={i} style={{
                    padding: '6px 10px', textAlign: 'left', fontWeight: 600,
                    color: 'var(--f3)', fontFamily: 'var(--mono)', fontSize: 10,
                    letterSpacing: '0.04em', whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr key={m.id} style={{ borderBottom: '0.5px solid var(--bs)' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
                      background: `color-mix(in srgb, ${PROVIDER_COLOR[m.provider] ?? 'var(--f4)'} 15%, transparent)`,
                      color: PROVIDER_COLOR[m.provider] ?? 'var(--f4)',
                      border: `0.5px solid ${PROVIDER_COLOR[m.provider] ?? 'var(--bd)'}`,
                      fontFamily: 'var(--mono)',
                    }}>
                      {PROVIDER_LABEL[m.provider] ?? m.provider}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', color: 'var(--f2)', fontSize: 11 }}>{m.model_id}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--f1)' }}>{m.display_name}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <button
                      onClick={() => handleToggle(m)}
                      style={{
                        width: 34, height: 18, borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: m.is_active ? 'var(--hs)' : 'var(--bd)',
                        position: 'relative', transition: 'background 0.15s',
                      }}
                      title={m.is_active ? '비활성화' : '활성화'}
                    >
                      <span style={{
                        position: 'absolute', top: 2,
                        left: m.is_active ? 18 : 2,
                        width: 14, height: 14, borderRadius: '50%',
                        background: 'white', transition: 'left 0.15s',
                      }} />
                    </button>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <input
                      type="radio"
                      checked={m.is_default}
                      onChange={() => handleSetDefault(m)}
                      style={{ cursor: 'pointer', accentColor: 'var(--hs)' }}
                      title="기본 모델로 설정"
                    />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <button
                      className="btn sm"
                      style={{ color: 'var(--shf)', borderColor: 'var(--shf)' }}
                      onClick={() => handleDelete(m)}
                      disabled={m.is_default}
                      title={m.is_default ? '기본 모델은 삭제 불가' : '삭제'}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
