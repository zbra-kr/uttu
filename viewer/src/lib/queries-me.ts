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
  is_read: boolean;
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
    .select('id, event_type, title, body, link, is_read, created_at')
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
    .eq('is_read', false);
  return count ?? 0;
}

export async function markRead(id: string): Promise<void> {
  await supabase.from('user_notifications').update({ is_read: true }).eq('id', id);
}

export async function markAllRead(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('user_notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
}
