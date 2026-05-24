import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

const sevenDaysAgo = () => new Date(Date.now() - 7 * 86400000).toISOString();
const thirtyDaysAgo = () => new Date(Date.now() - 30 * 86400000).toISOString();

export async function GET() {
  const ss = await supabaseServer();
  const { data: { user } } = await ss.auth.getUser();
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const d7 = sevenDaysAgo();
  const d30 = thirtyDaysAgo();

  const [
    bookmarksAll,
    bookmarks7d,
    notesAll,
    notes7d,
    viewAll,
    view7d,
    savedFilters,
    activeSubs,
    mentionsMe,
  ] = await Promise.all([
    ss.from('user_bookmarks').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ss.from('user_bookmarks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', d7),
    ss.from('user_notes').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ss.from('user_notes').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', d7),
    ss.from('user_view_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ss.from('user_view_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('viewed_at', d7),
    ss.from('user_saved_filters').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ss.from('user_notification_subscriptions').select('id, event_type', { count: 'exact' }).eq('user_id', user.id).eq('enabled', true),
    ss.from('user_notes').select('id', { count: 'exact', head: true }).contains('mentioned_user_ids', [user.id]).neq('user_id', user.id).gte('created_at', d30),
  ]);

  const activeSubs_count = activeSubs.count ?? 0;
  const distinctEvents = activeSubs.data
    ? new Set(activeSubs.data.map((r: { event_type: string }) => r.event_type)).size
    : 0;

  return NextResponse.json({
    bookmarks:                bookmarksAll.count ?? 0,
    bookmarks_recent_7d:      bookmarks7d.count ?? 0,
    notes:                    notesAll.count ?? 0,
    notes_recent_7d:          notes7d.count ?? 0,
    view_history:             viewAll.count ?? 0,
    view_history_recent_7d:   view7d.count ?? 0,
    saved_filters:            savedFilters.count ?? 0,
    active_subscriptions:     activeSubs_count,
    active_subscription_events: distinctEvents,
    mentions_received_30d:    mentionsMe.count ?? 0,
  });
}
