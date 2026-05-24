'use client';
import { supabaseBrowser } from './supabase/client';

const supabase = supabaseBrowser();

export interface MyProfile {
  id: string;
  email: string;
  full_name: string | null;
  display_name: string | null;
  role: 'admin' | 'viewer';
  team: string | null;
  teams_webhook_url: string | null;
  telegram_chat_id: string | null;
  avatar_url: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function fetchMyProfile(): Promise<MyProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, display_name, role, team, teams_webhook_url, telegram_chat_id, avatar_url, created_at')
    .eq('id', user.id)
    .single();
  if (error) {
    console.error('[fetchMyProfile]', error);
    return null;
  }
  return {
    ...data,
    email: user.email!,
    last_sign_in_at: user.last_sign_in_at ?? null,
  };
}

export async function updateMyProfile(patch: Partial<Pick<MyProfile,
  'full_name' | 'display_name' | 'team' | 'teams_webhook_url' | 'telegram_chat_id' | 'avatar_url'
>>): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '로그인 필요' };
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  return { error: error?.message ?? null };
}

export async function uploadAvatar(file: File, userId: string): Promise<{ url: string | null; error: string | null }> {
  const path = `${userId}/avatar`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { url: null, error: uploadError.message };

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = data.publicUrl;

  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);
  if (updateError) return { url: null, error: updateError.message };

  return { url, error: null };
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotificationEvent =
  | 'daily_summary'
  | 'anomaly_high'
  | 'anomaly_med'
  | 'mention'
  | 'dart_new_disclosure'
  | 'review_low_rating'
  | 'rank_change_bookmarked';

export type NotificationChannel = 'teams' | 'telegram';

export interface SubscriptionRow {
  event_type: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface NotificationInbox {
  id: string;
  event_type: NotificationEvent;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export async function fetchMySubscriptions(): Promise<SubscriptionRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('user_notification_subscriptions')
    .select('event_type, channel, enabled')
    .eq('user_id', user.id);
  return (data ?? []) as SubscriptionRow[];
}

export async function toggleSubscription(
  event_type: NotificationEvent,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '로그인 필요' };
  const { error } = await supabase
    .from('user_notification_subscriptions')
    .upsert(
      { user_id: user.id, event_type, channel, enabled },
      { onConflict: 'user_id,event_type,channel' },
    );
  return { error: error?.message ?? null };
}

export async function fetchInbox(limit = 30): Promise<NotificationInbox[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('user_notifications')
    .select('id, event_type, title, body, link, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as NotificationInbox[];
}

export async function fetchUnreadCount(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);
  return count ?? 0;
}

export async function markRead(id: string): Promise<void> {
  await supabase.from('user_notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
}

export async function markAllRead(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);
}

// ── Notes + @mention ──────────────────────────────────────────────────────────

export type EntityType = 'company' | 'brand' | 'product' | 'ranking_filter';

export interface MentionCandidate {
  id: string;
  display_name: string | null;
  full_name: string | null;
  team: string | null;
  type: 'user' | 'team';
  member_ids?: string[]; // team 타입일 때 해당 팀 전원 ID
}

export interface MyNote {
  id: string;
  user_id: string;
  body: string;
  entity_type: EntityType | null;
  entity_id: string | null;
  tags: string[];
  mentioned_user_ids: string[];
  created_at: string;
  updated_at: string;
  author?: { id: string; display_name: string | null; full_name: string | null } | null;
}

export async function searchMentionCandidates(query: string, limit = 8): Promise<MentionCandidate[]> {
  if (!query) return [];

  const [{ data: users }, { data: teamRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, full_name, team')
      .or(`display_name.ilike.%${query}%,full_name.ilike.%${query}%`)
      .limit(limit),
    supabase
      .from('profiles')
      .select('id, team')
      .ilike('team', `%${query}%`)
      .not('team', 'is', null),
  ]);

  // 팀별로 멤버 ID 그룹핑
  const teamMap = new Map<string, string[]>();
  for (const row of (teamRows ?? [])) {
    if (!row.team) continue;
    if (!teamMap.has(row.team)) teamMap.set(row.team, []);
    teamMap.get(row.team)!.push(row.id);
  }
  const teamCandidates: MentionCandidate[] = [...teamMap.entries()].map(([teamName, ids]) => ({
    id: `team:${teamName}`,
    display_name: teamName,
    full_name: null,
    team: null,
    type: 'team',
    member_ids: ids,
  }));

  const userCandidates: MentionCandidate[] = (users ?? []).map(u => ({ ...u, type: 'user' as const }));

  return [...teamCandidates, ...userCandidates].slice(0, limit);
}

export async function fetchNotesForEntity(
  entity_type: EntityType,
  entity_id: string,
): Promise<MyNote[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  // RLS already restricts to own notes or notes where user is mentioned
  const { data, error } = await supabase
    .from('user_notes')
    .select('*')
    .eq('entity_type', entity_type)
    .eq('entity_id', entity_id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('[fetchNotesForEntity]', error); return []; }
  const notes = (data ?? []) as MyNote[];
  if (notes.length === 0) return notes;

  const authorIds = [...new Set(notes.map(n => n.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, full_name')
    .in('id', authorIds);
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));
  return notes.map(n => ({ ...n, author: profileMap.get(n.user_id) ?? null }));
}

export async function createNote(input: {
  body: string;
  entity_type?: EntityType | null;
  entity_id?: string | null;
  tags?: string[];
  mentioned_user_ids?: string[];
}): Promise<{ data: MyNote | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: '로그인 필요' };
  const { data, error } = await supabase
    .from('user_notes')
    .insert({
      user_id: user.id,
      body: input.body,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      tags: input.tags ?? [],
      mentioned_user_ids: input.mentioned_user_ids ?? [],
    })
    .select('*')
    .single();
  if (error) return { data: null, error: error.message };
  if ((input.mentioned_user_ids ?? []).length > 0) {
    fetch('/api/me/notes/notify-mentions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: (data as MyNote).id }),
    }).catch(e => console.error('[notify-mentions]', e));
  }
  return { data: data as MyNote, error: null };
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<MyNote, 'body' | 'tags' | 'mentioned_user_ids'>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_notes')
    .update(patch)
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteNote(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_notes')
    .delete()
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function fetchMyRecentNotes(limit = 10): Promise<MyNote[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_notes')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as MyNote[];
}

export async function fetchMentionsForMe(limit = 20): Promise<MyNote[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_notes')
    .select('*')
    .contains('mentioned_user_ids', [user.id])
    .neq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  const notes = (data ?? []) as MyNote[];
  if (notes.length === 0) return notes;

  const authorIds = [...new Set(notes.map(n => n.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, full_name')
    .in('id', authorIds);
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));
  return notes.map(n => ({ ...n, author: profileMap.get(n.user_id) ?? null }));
}

export async function fetchNoteCountForEntity(
  entity_type: EntityType,
  entity_id: string,
): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('user_notes')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', entity_type)
    .eq('entity_id', entity_id);
  return count ?? 0;
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────

export interface Bookmark {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  label: string | null;
  created_at: string;
}

export async function fetchBookmarks(): Promise<Bookmark[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_bookmarks')
    .select('id, entity_type, entity_id, label, created_at')
    .order('created_at', { ascending: false });
  if (error) { console.error('[fetchBookmarks]', error); return []; }
  return (data ?? []) as Bookmark[];
}

export async function isBookmarked(entity_type: EntityType, entity_id: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { count } = await supabase
    .from('user_bookmarks')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', entity_type)
    .eq('entity_id', entity_id);
  return (count ?? 0) > 0;
}

export async function addBookmark(
  entity_type: EntityType,
  entity_id: string,
  label?: string,
): Promise<{ data: Bookmark | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: '로그인 필요' };
  const { data, error } = await supabase
    .from('user_bookmarks')
    .insert({ user_id: user.id, entity_type, entity_id, label: label ?? null })
    .select('id, entity_type, entity_id, label, created_at')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as Bookmark, error: null };
}

export async function removeBookmark(entity_type: EntityType, entity_id: string): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '로그인 필요' };
  const { error } = await supabase
    .from('user_bookmarks')
    .delete()
    .eq('entity_type', entity_type)
    .eq('entity_id', entity_id);
  return { error: error?.message ?? null };
}

// ── Saved Filters ─────────────────────────────────────────────────────────────

export interface SavedFilter {
  id: string;
  page: string;
  name: string;
  filter_data: unknown;
  created_at: string;
}

export async function fetchSavedFilters(page: string): Promise<SavedFilter[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_saved_filters')
    .select('id, page, name, filter_data, created_at')
    .eq('user_id', user.id)
    .eq('page', page)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { console.error('[fetchSavedFilters]', error); return []; }
  return (data ?? []) as SavedFilter[];
}

export async function fetchAllSavedFilters(): Promise<SavedFilter[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('user_saved_filters')
    .select('id, page, name, filter_data, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) { console.error('[fetchAllSavedFilters]', error); return []; }
  return (data ?? []) as SavedFilter[];
}

export async function saveFilter(
  page: string,
  name: string,
  filter_data: unknown,
): Promise<{ data: SavedFilter | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: '로그인 필요' };
  const { data, error } = await supabase
    .from('user_saved_filters')
    .insert({ user_id: user.id, page, name, filter_data })
    .select('id, page, name, filter_data, created_at')
    .single();
  if (error) {
    if (error.code === '23505') return { data: null, error: '같은 이름의 필터가 이미 있습니다.' };
    return { data: null, error: error.message };
  }
  return { data: data as SavedFilter, error: null };
}

export async function deleteSavedFilter(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_saved_filters')
    .delete()
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function overwriteFilter(
  id: string,
  filter_data: unknown,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_saved_filters')
    .update({ filter_data })
    .eq('id', id);
  return { error: error?.message ?? null };
}

// ── View History ──────────────────────────────────────────────────────────────

export interface ViewHistoryRow {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  label: string | null;
  viewed_at: string;
}

export async function logView(
  entity_type: EntityType,
  entity_id: string,
  label?: string,
): Promise<void> {
  const { error } = await supabase.rpc('upsert_view_history', {
    p_entity_type: entity_type,
    p_entity_id:   entity_id,
    p_label:       label ?? null,
  });
  if (error) console.error('[logView]', error.message);
}

export async function fetchViewHistory(limit = 8): Promise<ViewHistoryRow[]> {
  const { data, error } = await supabase
    .from('user_view_history')
    .select('id, entity_type, entity_id, label, viewed_at')
    .order('viewed_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[fetchViewHistory]', error); return []; }
  return (data ?? []) as ViewHistoryRow[];
}

// ── My Stats ──────────────────────────────────────────────────────────────────

export interface MyStats {
  bookmarks: number;
  bookmarks_recent_7d: number;
  notes: number;
  notes_recent_7d: number;
  view_history: number;
  view_history_recent_7d: number;
  saved_filters: number;
  active_subscriptions: number;
  active_subscription_events: number;
  mentions_received_30d: number;
}

export async function fetchMyStats(): Promise<MyStats | null> {
  try {
    const res = await fetch('/api/me/stats');
    if (!res.ok) return null;
    return await res.json() as MyStats;
  } catch (e) {
    console.error('[fetchMyStats]', e);
    return null;
  }
}
