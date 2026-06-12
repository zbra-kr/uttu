'use client';
import React from 'react';
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

export default function SavedFiltersDropdown({ page, currentFilter, onLoad }: Props) {
  const [filters, setFilters] = React.useState<SavedFilter[]>([]);
  const [loadOpen, setLoadOpen] = React.useState(false);
  const [saveMode, setSaveMode] = React.useState<'idle' | 'input' | 'overwrite'>('idle');
  const [saveName, setSaveName] = React.useState('');
  const [overwriteTarget, setOverwriteTarget] = React.useState<SavedFilter | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const dropRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetchSavedFilters(page).then(setFilters);
  }, [page]);

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
    if (data) setFilters(prev => [data, ...prev]);
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
    setFilters(prev => prev.map(f =>
      f.id === overwriteTarget.id ? { ...f, filter_data: currentFilter } : f,
    ));
    setSaveMode('idle');
    setSaveName('');
    setOverwriteTarget(null);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await deleteSavedFilter(id);
    if (!error) setFilters(prev => prev.filter(f => f.id !== id));
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
              {filters.length === 0 ? (
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
