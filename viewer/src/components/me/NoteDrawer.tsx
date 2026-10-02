'use client';
import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { RankingSourceContext } from '@/lib/notes/ranking-context';
import {
  EntityType, MyNote, MentionCandidate,
  fetchNotesForEntity, fetchNoteForEntity, createNote, updateNote, deleteNote,
} from '@/lib/queries-me';
import { supabaseBrowser } from '@/lib/supabase/client';
import MentionAutocomplete from './MentionAutocomplete';
import { IcX } from '../ui/icons';
import { fmtDateTime } from '@/lib/format';
import { moveMentionRanges, selectedMentionIds, type SelectedMention } from '@/lib/teams/mentions';
import type { TeamsConnectionState } from './TeamsConnection';

function renderBody(text: string): React.ReactNode[] {
  const parts = text.split(/(@\S+|#\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@') && part.length > 1) {
      return (
        <span key={i} style={{
          color: 'var(--hs)',
          background: 'var(--hs-soft)',
          borderRadius: 3,
          padding: '0 3px',
          fontWeight: 500,
        }}>{part}</span>
      );
    }
    if (part.startsWith('#') && part.length > 1) {
      return (
        <span key={i} style={{
          color: 'var(--slf)',
          background: 'color-mix(in srgb, var(--slf) 12%, transparent)',
          borderRadius: 3,
          padding: '0 3px',
          fontWeight: 500,
        }}>{part}</span>
      );
    }
    return part;
  });
}

/** Source URLs control the initial target and remain compatible with client navigation. */
export function useSourceNoteDrawer(entityId: string) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = params.toString();
  const [noteDrawerOpen, setOpen] = React.useState(() =>
    !!entityId && (params.get('notes') === 'open' || !!params.get('note')));

  React.useEffect(() => {
    const source = new URLSearchParams(search);
    setOpen(!!entityId && (source.get('notes') === 'open' || !!source.get('note')));
  }, [entityId, search]);

  const setNoteDrawerOpen = React.useCallback((value: boolean) => {
    setOpen(value);
    if (!value) {
      const source = new URLSearchParams(search);
      if (source.has('notes') || source.has('note')) {
        source.delete('notes');
        source.delete('note');
        const query = source.toString();
        router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
      }
    }
  }, [search, pathname, router]);

  return { noteDrawerOpen, setNoteDrawerOpen };
}

export function SourceNoteFallback() {
  const params = useSearchParams();
  const id = params.get('note');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return <a href={`/me/notes/${id}?view=memo`} style={{ display: 'block', padding: 16, textAlign: 'center', color: 'var(--hs)' }}>연결된 메모 보기</a>;
}

interface Props {
  entity_type: EntityType;
  entity_id: string;
  entity_label?: string;
  open: boolean;
  onClose: () => void;
  onCountChange?: (n: number) => void;
  sourceContext?: RankingSourceContext | null;
  saveBlockedReason?: string;
}

export default function NoteDrawer({
  entity_type, entity_id, entity_label, open, onClose, onCountChange, sourceContext, saveBlockedReason,
}: Props) {
  const params = useSearchParams();
  const targetNoteId = params.get('note')?.toLowerCase() ?? null;
  const [targetMessage, setTargetMessage] = React.useState<string | null>(null);
  const targetElementRef = React.useRef<HTMLDivElement>(null);
  const focusedTargetRef = React.useRef<string | null>(null);
  const [notes, setNotes] = React.useState<MyNote[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);

  React.useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  // New note form
  const [body, setBody] = React.useState('');
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagInput, setTagInput] = React.useState('');
  const [selectedMentions, setSelectedMentions] = React.useState<SelectedMention[]>([]);
  const mentionedIds = selectedMentionIds(selectedMentions, currentUserId);
  const [teams, setTeams] = React.useState<TeamsConnectionState | null>(null);
  const [sendTeams, setSendTeams] = React.useState(true);
  const teamsReady = !!teams?.available && !!teams.connected;
  const [sendStatus, setSendStatus] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Mention autocomplete
  const [showMention, setShowMention] = React.useState(false);
  const [mentionQuery, setMentionQuery] = React.useState('');
  const [mentionAtIdx, setMentionAtIdx] = React.useState<number | null>(null);
  const [mentionRect, setMentionRect] = React.useState<DOMRect | undefined>(undefined);

  // Inline edit
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editBody, setEditBody] = React.useState('');
  const [editTags, setEditTags] = React.useState<string[]>([]);
  const [editTagInput, setEditTagInput] = React.useState('');
  const [editSaving, setEditSaving] = React.useState(false);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const mentionJustSelectedRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const submissionRef = React.useRef<{ id: string; snapshot: string } | null>(null);

  React.useEffect(() => {
    focusedTargetRef.current = null;
    if (!open || !entity_id) return;
    let active = true;
    const controller = new AbortController();
    setTeams(null);
    fetch('/api/me/teams/connection', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (active) setTeams(value); }).catch(() => {});
    setLoading(true);
    setNotes([]);
    setTargetMessage(null);
    (async () => {
      const latest = await fetchNotesForEntity(entity_type, entity_id);
      if (!active) return;
      const data = latest.filter(note => note.entity_type === entity_type && note.entity_id === entity_id);
      if (targetNoteId && !data.some(note => note.id.toLowerCase() === targetNoteId)) {
        const target = await fetchNoteForEntity(targetNoteId, entity_type, entity_id);
        if (!active) return;
        if (target) data.push(target);
        else setTargetMessage('연결된 메모를 열 수 없습니다. 삭제되었거나 열람 권한이 없을 수 있습니다.');
      }
      setNotes(data);
      onCountChange?.(data.length);
    })().catch(() => {
      if (active) setTargetMessage('메모를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  // onCountChange prop 함수 제외 — 부모 재렌더링 시 무한 루프 방지
  }, [open, entity_type, entity_id, targetNoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!open || loading || !targetNoteId || !targetElementRef.current
      || !notes.some(note => note.id.toLowerCase() === targetNoteId
        && note.entity_type === entity_type && note.entity_id === entity_id)) return;
    const key = `${entity_type}:${entity_id}:${targetNoteId}`;
    if (focusedTargetRef.current === key) return;
    focusedTargetRef.current = key;
    targetElementRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
    targetElementRef.current.focus({ preventScroll: true });
  }, [open, loading, notes, entity_type, entity_id, targetNoteId]);

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (savingRef.current) return;
    const val = e.target.value;
    setSelectedMentions(previous => moveMentionRanges(body, val, previous));
    setBody(val);
    // 멘션 선택 직후 IME 커밋으로 인한 onChange는 드롭다운 재오픈 무시
    if (mentionJustSelectedRef.current) return;
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const m = before.match(/@([^@\s]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionAtIdx(cursor - m[0].length);
      setMentionRect(e.currentTarget.getBoundingClientRect());
      setShowMention(true);
    } else {
      setShowMention(false);
      setMentionQuery('');
      setMentionAtIdx(null);
    }
  };

  const handleMentionSelect = (candidate: MentionCandidate) => {
    if (savingRef.current) return;
    const ta = textareaRef.current;
    if (!ta || mentionAtIdx === null) return;
    const name = candidate.display_name ?? candidate.full_name ?? candidate.id;
    const atIdx = mentionAtIdx; // 비동기 전에 캡처

    // 드롭다운 즉시 닫기
    mentionJustSelectedRef.current = true;
    setShowMention(false);
    setMentionQuery('');
    setMentionAtIdx(null);

    // IME 조합 커밋 이벤트(compositionend → input)가 모두 처리된 다음 턴에 치환
    setTimeout(() => {
      mentionJustSelectedRef.current = false;
      const currentVal = ta.value; // IME 커밋 완료 후 실제 DOM 값
      const afterAt = currentVal.slice(atIdx + 1);
      const tokenLen = (afterAt.match(/^([^@\s]*)/) ?? ['', ''])[1].length;
      const endIdx = atIdx + 1 + tokenLen;
      const newBody = currentVal.slice(0, atIdx) + `@${name} ` + currentVal.slice(endIdx);
      setSelectedMentions(previous => [
        ...moveMentionRanges(currentVal, newBody, previous),
        { key: candidate.id, label: name, userIds: candidate.type === 'team' ? (candidate.member_ids ?? []) : [candidate.id],
          start: atIdx, end: atIdx + name.length + 1 },
      ]);
      ta.value = newBody;
      setBody(newBody);
      const newPos = atIdx + name.length + 2;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleSave = async () => {
    if (!body.trim() || savingRef.current || saveBlockedReason) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSendStatus(null);
    const snapshot = JSON.stringify([body.trim(), tags, mentionedIds, entity_type, entity_id, sourceContext ?? null]);
    if (!submissionRef.current || submissionRef.current.snapshot !== snapshot) {
      submissionRef.current = { id: crypto.randomUUID(), snapshot };
    }
    let result: Awaited<ReturnType<typeof createNote>>;
    try {
      result = await createNote({
      body: body.trim(), entity_type, entity_id, tags, mentioned_user_ids: mentionedIds,
      send_teams: teamsReady && sendTeams && selectedMentions.every(mention => !mention.key.startsWith('team:')),
      submission_id: submissionRef.current.id,
      source_context: sourceContext ?? null,
      });
    } catch {
      result = { data: null, error: '저장 결과를 확인하지 못했습니다. 같은 메모로 다시 시도하면 중복 전송을 방지합니다.' };
    }
    const { data, error, notification_status } = result;
    if (error) { setSaveError(error); setSaving(false); savingRef.current = false; return; }
    if (data) {
      let profile = null;
      try {
        const { data: profiles } = await supabaseBrowser()
          .from('profiles_public').select('id, display_name, full_name').eq('id', data.user_id).single();
        profile = profiles;
      } catch { /* A display-name read cannot undo a successful note save. */ }
      const next = [{ ...data, author: profile }, ...notes.filter(note => note.id !== data.id)];
      setNotes(next);
      onCountChange?.(next.length);
    }
    if (notification_status) setSendStatus(notification_status);
    submissionRef.current = null;
    setBody(''); setTags([]); setTagInput(''); setSelectedMentions([]);
    setSaving(false); savingRef.current = false;
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('메모를 삭제할까요?')) return;
    const { error } = await deleteNote(id);
    if (!error) {
      const next = notes.filter(n => n.id !== id);
      setNotes(next);
      onCountChange?.(next.length);
    }
  };

  const startEdit = (note: MyNote) => {
    setEditingId(note.id);
    setEditBody(note.body);
    setEditTags(note.tags ?? []);
    setEditTagInput('');
  };

  const handleEditSave = async (id: string) => {
    if (!editBody.trim()) return;
    setEditSaving(true);
    const { error } = await updateNote(id, { body: editBody.trim(), tags: editTags });
    setEditSaving(false);
    if (!error) {
      setNotes(prev => prev.map(n => n.id === id ? { ...n, body: editBody.trim(), tags: editTags } : n));
      setEditingId(null);
    }
  };

  return (
    <>
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 299 }}
          onClick={onClose}
        />
      )}
      <div role="dialog" aria-modal={open ? true : undefined} aria-label={`${entity_label ?? entity_type} 메모`}
        aria-hidden={!open} style={{
        visibility: open ? 'visible' : 'hidden',
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: 'min(400px, 100vw)',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 240ms ease',
        background: 'var(--sur)',
        borderLeft: '0.5px solid var(--bd)',
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px 10px',
          borderBottom: '0.5px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--f1)' }}>
              {entity_label ?? entity_type} 메모
            </div>
            <div style={{ fontSize: 11, color: 'var(--f4)', marginTop: 2 }}>
              {loading ? '…' : `${notes.length}개`}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="닫기"><IcX /></button>
        </div>

        {/* Note list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {targetMessage && <div role="status" style={{ padding: '12px 0', fontSize: 12, color: 'var(--f3)' }}>{targetMessage}</div>}
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--f4)', padding: '32px 0', textAlign: 'center' }}>불러오는 중…</div>
          ) : notes.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--f4)', padding: '40px 0', textAlign: 'center' }}>
              아직 메모가 없습니다.<br />
              <span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>아래에서 첫 메모를 작성해보세요.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.map(note => (
                <div
                  key={note.id}
                  ref={note.id.toLowerCase() === targetNoteId ? targetElementRef : undefined}
                  tabIndex={note.id.toLowerCase() === targetNoteId ? -1 : undefined}
                  data-note-id={note.id}
                  data-note-target={note.id.toLowerCase() === targetNoteId ? 'true' : undefined}
                  aria-label={note.id.toLowerCase() === targetNoteId ? '연결된 메모' : undefined}
                  onMouseEnter={() => setHoveredId(note.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    background: note.id.toLowerCase() === targetNoteId ? 'var(--hs-soft)' : hoveredId === note.id && editingId !== note.id ? 'var(--snk)' : 'var(--rai)',
                    border: note.id.toLowerCase() === targetNoteId ? '2px solid var(--hs)' : '0.5px solid var(--bs)',
                    scrollMarginBlock: 16,
                    borderRadius: 5,
                    padding: 12,
                    transition: 'background 100ms',
                  }}
                >
                  {editingId === note.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <textarea
                        value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                        rows={3}
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          background: 'var(--bg)', border: '0.5px solid var(--bd)',
                          borderRadius: 5, padding: 8, fontSize: 12,
                          color: 'var(--f1)', resize: 'vertical', outline: 'none',
                          fontFamily: 'var(--sans)',
                        }}
                      />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', minHeight: 22 }}>
                        {editTags.map((t, i) => (
                          <span key={i} className="chip" style={{ cursor: 'pointer', fontSize: 10 }}
                            onClick={() => setEditTags(ts => ts.filter((_, j) => j !== i))}>
                            {t} ×
                          </span>
                        ))}
                        <input
                          value={editTagInput}
                          onChange={e => setEditTagInput(e.target.value)}
                          onKeyDown={e => {
                            if ((e.key === ' ' || e.key === 'Enter') && editTagInput.trim()) {
                              e.preventDefault();
                              setEditTags(ts => [...ts, editTagInput.trim()]);
                              setEditTagInput('');
                            }
                          }}
                          placeholder={editTags.length === 0 ? '태그' : ''}
                          style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11, minWidth: 50, color: 'var(--f2)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn sm" onClick={() => setEditingId(null)}>취소</button>
                        <button className="btn sm active" onClick={() => handleEditSave(note.id)}
                          disabled={editSaving || !editBody.trim()}>
                          {editSaving ? '저장 중…' : '저장'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {note.user_id !== currentUserId && note.author && (
                        <div style={{
                          fontSize: 10, fontWeight: 500,
                          color: 'var(--hs)', marginBottom: 4,
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          <span style={{
                            display: 'inline-block', width: 5, height: 5,
                            borderRadius: '50%', background: 'var(--hs)', flexShrink: 0,
                          }} />
                          {note.author.display_name ?? note.author.full_name ?? '알 수 없음'}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--f1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {renderBody(note.body)}
                      </div>
                      {note.tags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                          {note.tags.map((t, i) => (
                            <span key={i} className="chip" style={{ fontSize: 10 }}>{t}</span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
                        <span className="mono" style={{ fontSize: 10, color: 'var(--f4)', flex: 1 }}>
                          {fmtDateTime(note.created_at)}
                          {note.updated_at > note.created_at && ' (수정됨)'}
                        </span>
                        {hoveredId === note.id && note.user_id === currentUserId && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn sm" style={{ fontSize: 10 }} onClick={() => startEdit(note)}>수정</button>
                            <button className="btn sm" style={{ fontSize: 10, color: 'var(--shf)' }}
                              onClick={() => handleDelete(note.id)}>삭제</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New note form */}
        <div style={{
          padding: 12, borderTop: '0.5px solid var(--bd)', flexShrink: 0,
          background: 'var(--sur)', position: 'relative',
        }}>
          {showMention && (
            <MentionAutocomplete
              query={mentionQuery}
              onSelect={handleMentionSelect}
              onClose={() => setShowMention(false)}
              anchorRect={mentionRect}
            />
          )}
          <textarea
            ref={textareaRef}
            readOnly={saving}
            value={body}
            onChange={handleBodyChange}
            onKeyDown={e => {
              if (showMention) {
                if (['Enter', 'ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
                  e.preventDefault();
                }
                return;
              }
              if (e.key === 'Escape') setShowMention(false);
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave(); }
            }}
            rows={3}
            placeholder="메모 입력… (@로 멘션)"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg)', border: '0.5px solid var(--bd)',
              borderRadius: 5, padding: 8, fontSize: 12,
              color: 'var(--f1)', resize: 'vertical', outline: 'none',
              fontFamily: 'var(--sans)',
            }}
          />
          {/* Tags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', minHeight: 24, marginTop: 6 }}>
            {tags.map((t, i) => (
              <span key={i} className="chip" style={{ cursor: 'pointer', fontSize: 10 }}
                onClick={() => { if (!savingRef.current) setTags(ts => ts.filter((_, j) => j !== i)); }}>
                {t} ×
              </span>
            ))}
            <input
              value={tagInput}
              disabled={saving}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if ((e.key === ' ' || e.key === 'Enter') && tagInput.trim()) {
                  e.preventDefault();
                  setTags(ts => [...ts, tagInput.trim()]);
                  setTagInput('');
                }
                if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                  setTags(ts => ts.slice(0, -1));
                }
              }}
              placeholder={tags.length === 0 ? '태그 (스페이스로 추가)' : ''}
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 11, minWidth: 80, color: 'var(--f2)' }}
            />
          </div>
          {mentionedIds.length > 0 && <div style={{ fontSize: 11, color: 'var(--f3)', marginTop: 8 }}>
            <div>받는 사람: {selectedMentions.map(mention => mention.label).join(', ')}</div>
            {selectedMentions.some(mention => mention.key.startsWith('team:'))
              ? <div>팀 전체 멘션은 UTTU 알림으로만 전달됩니다. Teams DM은 사람을 개별 선택해 주세요.</div>
              : teamsReady
                ? <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 6 }}>
                    <input type="checkbox" checked={sendTeams} disabled={saving} onChange={event => setSendTeams(event.target.checked)} />
                    <span>내 계정 명의로 Teams DM 보내기 (메모 내용과 링크)</span>
                  </label>
                : <div>Teams DM을 보내려면 <a href="/me">내 프로필</a>에서 Teams를 연결해 주세요.</div>}
          </div>}
          {sendStatus && <div role="status" style={{ fontSize: 11, marginTop: 8, color: 'var(--f3)' }}>{sendStatus}</div>}
          {saveBlockedReason && <div role="status" style={{ fontSize: 11, marginTop: 8, color: 'var(--f3)' }}>{saveBlockedReason}</div>}
          {/* Action row */}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 8, gap: 8 }}>
            <span style={{ flex: 1, fontSize: 11 }}>
              {saveError
                ? <span style={{ color: 'var(--shf)' }}>{saveError}</span>
                : mentionedIds.length > 0
                  ? <span style={{ color: 'var(--f4)' }}>@멘션 {mentionedIds.length}명</span>
                  : null}
            </span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--f4)' }}>⌘↵ 저장</span>
            <button className="btn sm active" onClick={handleSave} disabled={saving || !body.trim() || !!saveBlockedReason}>
              {saving ? '저장 중…' : teamsReady && sendTeams && mentionedIds.length > 0
                && selectedMentions.every(mention => !mention.key.startsWith('team:')) ? '저장 및 Teams DM' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
