import 'server-only';
import { supabaseServer } from '@/lib/supabase/server';
import { readTeamsSetupAccess, teamsSetupRequired } from './setup-access';

export async function getTeamsSetupContext() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const required = teamsSetupRequired();
  if (!user) return { user: null, required,
    decision: { allowed: false, reason: 'identity_required' as const }, canConnect: false };
  try { return { user, required, ...await readTeamsSetupAccess(sb, user) }; }
  catch { return { user, required,
    decision: { allowed: false, reason: 'unavailable' as const }, canConnect: false }; }
}
