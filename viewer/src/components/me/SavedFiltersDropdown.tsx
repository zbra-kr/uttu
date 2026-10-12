'use client';
import React from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  SavedFilter,
  fetchSavedFilters,
  saveFilter,
  deleteSavedFilter,
  overwriteFilter,
} from '@/lib/queries-me';

interface Props {
  page: string;
  currentFilter: unknown;
  onLoad: (filter: unknown) => void;
}

// A scope change remounts the controls, including pending mutation callbacks.
export default function SavedFiltersDropdown(props: Props) {
  const [identity, setIdentity] = React.useState<{ id: string | null | undefined; version: number }>({ id: undefined, version: 0 });
  React.useEffect(() => {
    const { data: { subscription } } = supabaseBrowser().auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      setIdentity(previous => previous.id === id ? previous : { id, version: previous.version + 1 });
    });
    return () => subscription.unsubscribe();
  }, []);
  return <SavedFiltersControls key={JSON.stringify([props.page, identity.version])} {...props} signedOut={identity.id === null} />;
}

function SavedFiltersControls({ page, currentFilter, onLoad, signedOut }: Props & { signedOut: boolean }) {
  const [filters, setFilters] = React.useState<SavedFilter[]>([]);
  const [readStatus, setReadStatus] = React.useState<'loading' | 'ready' | 'error' | 'signed-out'>(signedOut ? 'signed-out' : 'loading');
  const readRef = React.useRef<AbortController | null>(null);
  const readUpdates = React.useRef<Array<(rows: SavedFilter[]) => SavedFilter[]>>([]);
  const updateFilters = (update: (rows: SavedFilter[]) => SavedFilter[]) => {
    if (readRef.current) readUpdates.current.push(update);
    setFilters(update);
  };
  const [loadOpen, setLoadOpen] = React.useState(false);
  const [saveMode, setSaveMode] = React.useState<'idle' | 'input' | 'overwrite'>('idle');
  const [saveName, setSaveName] = React.useState('');
  const [overwriteTarget, setOverwriteTarget] = React.useState<SavedFilter | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const dropRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const readFilters = React.useCallback(() => {
    if (signedOut || readRef.current) return;
    const controller = new AbortController();
    readRef.current = controller;
    readUpdates.current = [];
    setReadStatus('loading');
    fetchSavedFilters(page, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setFilters(result.status === 'ready'
        ? readUpdates.current.reduce((rows, update) => update(rows), result.filters)
        : []);
      setReadStatus(result.status);
    }).catch(() => {
      if (!controller.signal.aborted) { setFilters([]); setReadStatus('error'); }
    }).finally(() => {
      if (readRef.current === controller) readRef.current = null;
    });
  }, [page, signedOut]);

  React.useEffect(() => {
    readFilters();
    return () => { readRef.current?.abort(); readRef.current = null; };
  }, [readFilters]);

  React.useEffect(() => {
    if (!loadOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setLoadOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [loadOpen]);

  React.useEffect(() => {
    if (saveMode === 'input') inputRef.current?.focus();
  }, [saveMode]);

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    setErr(null);
    const { data, error } = await saveFilter(page, name, currentFilter);
    setSaving(false);
    if (error) {
      if (error === '같은 이름의 필터가 이미 있습니다.') {
        const existing = filters.find(f => f.name === name);
        if (existing) { setOverwriteTarget(existing); setSaveMode('overwrite'); }
        else setErr(error);
      } else {
        setErr(error);
      }
      return;
    }
    if (data) updateFilters(prev => [data, ...prev.filter(f => f.id !== data.id)]);
    setSaveMode('idle');
    setSaveName('');
  };

  const handleOverwrite = async () => {
    if (!overwriteTarget) return;
    setSaving(true);
    setErr(null);
    const { error } = await overwriteFilter(overwriteTarget.id, currentFilter);
    setSaving(false);
    if (error) { setErr(error); return; }
    const targetId = overwriteTarget.id;
    updateFilters(prev => prev.map(f =>
      f.id === targetId ? { ...f, filter_data: currentFilter } : f,
    ));
    setSaveMode('idle');
    setSaveName('');
    setOverwriteTarget(null);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await deleteSavedFilter(id);
    if (!error) updateFilters(prev => prev.filter(f => f.id !== id));
  };

  const cancelSave = () => { setSaveMode('idle'); setSaveName(''); setErr(null); setOverwriteTarget(null); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {/* 불러오기 dropdown */}
        <div ref={dropRef} style={{ position: 'relative' }}>
          <button
            className="btn sm"
            onClick={() => { setLoadOpen(o => !o); setSaveMode('idle'); setErr(null); }}
          >
            불러오기 {loadOpen ? '▴' : '▾'}
          </button>
          {loadOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              minWidth: 160, background: 'var(--sur)', border: '1px solid var(--bd)',
              borderRadius: 5, boxShadow: '0 4px 12px rgba(0,0,0,.18)', zIndex: 100,
              overflow: 'hidden',
            }}>
              {readStatus === 'loading' ? (
                <div role="status" style={{ padding: '10px 12px', fontSize: 12, color: 'var(--f4)' }}>저장된 필터 불러오는 중…</div>
              ) : readStatus === 'error' ? (
                <div style={{ padding: '10px 12px', fontSize: 12 }}>
                  <div role="alert" style={{ color: 'var(--shf)', marginBottom: 6 }}>저장된 필터를 불러오지 못했습니다.</div>
                  <button className="btn sm" onClick={readFilters}>다시 시도</button>
                </div>
              ) : readStatus === 'signed-out' ? (
                <div role="status" style={{ padding: '10px 12px', fontSize: 12, color: 'var(--f4)' }}>로그인이 필요합니다.</div>
              ) : filters.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--f4)' }}>저장된 필터 없음</div>
              ) : filters.map((f, i) => (
                <div
                  key={f.id}
                  onClick={() => { onLoad(f.filter_data); setLoadOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--f1)',
                    borderBottom: i < filters.length - 1 ? '0.5px solid var(--bs)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--snk)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{f.name}</span>
                  <button
                    onClick={e => handleDelete(f.id, e)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '0 0 0 8px', color: 'var(--f4)', fontSize: 14, lineHeight: 1,
                      flexShrink: 0,
                    }}
                    title="삭제"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 저장 — idle */}
        {saveMode === 'idle' && (
          <button
            className="btn sm"
            onClick={() => { setSaveMode('input'); setLoadOpen(false); setSaveName(''); setErr(null); }}
          >
            저장
          </button>
        )}

        {/* 저장 — 이름 입력 */}
        {saveMode === 'input' && (
          <>
            <input
              ref={inputRef}
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') cancelSave();
              }}
              placeholder="필터 이름"
              style={{
                padding: '4px 8px', background: 'var(--snk)',
                border: '0.5px solid var(--bs)', borderRadius: 5,
                fontSize: 12, color: 'var(--f1)', outline: 'none',
                width: 100,
              }}
            />
            <button className="btn sm" onClick={handleSave} disabled={saving || !saveName.trim()}>확인</button>
            <button className="btn sm" onClick={cancelSave}>취소</button>
          </>
        )}

        {/* 저장 — 덮어쓰기 확인 */}
        {saveMode === 'overwrite' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--f3)' }}>"{overwriteTarget?.name}" 덮어쓸까요?</span>
            <button className="btn sm" onClick={handleOverwrite} disabled={saving}>덮어쓰기</button>
            <button className="btn sm" onClick={cancelSave}>취소</button>
          </>
        )}
      </div>

      {err && (
        <span style={{ fontSize: 11, color: 'var(--shf)', paddingLeft: 2 }}>{err}</span>
      )}
    </div>
  );
}
