import 'server-only';
import { supabaseServer } from '@/lib/supabase/server';
import { readCentralSales,type CentralActor } from './central-sales-server';
import { readAuthenticatedRequesterRestSales, type RequesterRestBinding } from './requester-sales-rest';
import { configuredCentralRequesterBinding } from './central-sales-composition';
import { parseCentralScope, centralState } from './central-sales-read';

async function currentActor():Promise<CentralActor|null>{
  // Reuse existing cookie-bound client and own-profile role lookup. Never a
  // service_role client, another user's profile, or client-supplied role/grant.
  const ss=await supabaseServer();const {data:{user},error}=await ss.auth.getUser();
  if(error)throw new Error('actor unavailable');if(!user)return null;
  const {data:profile,error:profileError}=await ss.from('profiles').select('role').eq('id',user.id).single();
  if(profileError)throw new Error('role unavailable');
  return {userId:user.id,role:profile?.role==='admin'||profile?.role==='viewer'?profile.role:null};
}
// Existing server-only resolver for a trusted, ephemeral local self-review call.
// Exporting does not register an endpoint, action or requester context.
export { currentActor as currentCentralActor };
export async function readCurrentRequesterRestSales(input: unknown, binding: RequesterRestBinding) {
  return readAuthenticatedRequesterRestSales(input, binding, currentActor);
}
// Actual ERP review-page entry. Server auth precedes dependency resolution;
// independent requester pin still comes solely from trusted server composition.
export async function readConfiguredCurrentCentralSales(input: unknown) {
  const parsed = parseCentralScope(input);
  if (parsed.reason) return centralState('request', null, parsed.reason);
  const scope = parsed.scope!;
  let actor: CentralActor | null;
  try { actor = await currentActor(); }
  catch { return centralState('error', scope, 'AUTH_READ_FAILED'); }
  if (!actor) return centralState('unauthenticated', scope, 'AUTH_REQUIRED');
  if (actor.role !== 'viewer' && actor.role !== 'admin') return centralState('forbidden', scope, 'ROLE_UNVERIFIED');
  try {
    const binding = configuredCentralRequesterBinding();
    if (!binding) return centralState('unconnected', scope, 'TRANSPORT_UNREGISTERED');
    return await readCurrentRequesterRestSales(scope, binding);
  } catch { return centralState('error', scope, 'READ_FAILED'); }
}
export async function readCurrentCentralSales(input:unknown){
  // Existing admin/viewer is not an ERP business-scope grant. No established
  // brand-grant source or in-process Snowflake executor exists in this viewer.
  // Do not transfer worker secrets/register persistent access to fill that gap.
  return readCentralSales(input,{currentActor,grantFor:async()=>null,executor:null});
}
