import 'server-only';
import type { CentralRestDiagnostic } from './central-rest-diagnostics';
import { centralState, parseCentralScope } from './central-sales-read';
import { createCentralRestExecutor, type SnowflakeRestBinding } from './central-sales-rest';
import { prepareRequesterReview, readRequesterLocalSales } from './requester-local-review';
import { validateRequesterIds } from './requester-allowlist';
import type { CentralActor } from './central-sales-server';
export interface RequesterRestBinding { expectedRequesterId: string; expectedRequesterIds?: readonly string[]; rest: SnowflakeRestBinding | null }
export async function readAuthenticatedRequesterRestSales(input: unknown, binding: RequesterRestBinding,
  currentActor: () => Promise<CentralActor | null>, http: typeof fetch = fetch) {
  const parsed = parseCentralScope(input);
  if (parsed.reason) return centralState('request', null, parsed.reason);
  let diagnosticActor:CentralActor|null=null;
  let selectedRole:CentralActor['role']|undefined;
  const scope = parsed.scope!; let expectedRequesterId = binding.expectedRequesterId; const rest = binding.rest;
  if(binding.expectedRequesterIds!==undefined){
    const ids=validateRequesterIds(binding.expectedRequesterIds);
    if(!ids||!ids.includes(expectedRequesterId))return centralState('withheld',scope,'LOCAL_REQUESTER_REQUIRED');
    let actor:CentralActor|null;try{actor=await currentActor();}catch{return centralState('error',scope,'AUTH_READ_FAILED');}
    // Select the independently configured entry, never use a request or actor ID
    // as a fallback grant. The existing pin then rechecks this exact actor/role.
    const selected=ids.find(id=>id===actor?.userId);
    if(!selected||!actor||(actor.role!=='admin'&&actor.role!=='viewer'))return centralState('withheld',scope,'LOCAL_REQUESTER_REQUIRED');
    expectedRequesterId=selected; selectedRole=actor.role;
  }
  // Auth before constructing transport or touching signer/HTTP.
  const pinnedActor=async()=>{
    const actor=await currentActor();
    if(selectedRole!==undefined&&(!actor||actor.userId!==expectedRequesterId||actor.role!==selectedRole))return null;
    diagnosticActor=actor;
    return actor;
  };
  const deps = { currentActor:pinnedActor, executor: null };
  const context = await prepareRequesterReview(scope, expectedRequesterId, deps);
  if (!context) return readRequesterLocalSales(scope, context, deps);
  try {
    let diagnostic:CentralRestDiagnostic|undefined;
    // Same independent requester pin and admin restriction as existing diagnostics.
    const permitted=diagnosticActor as CentralActor|null;
    const collect=permitted?.role==='admin'&&permitted.userId===expectedRequesterId?(value:CentralRestDiagnostic)=>{diagnostic=value;}:undefined;
    const state=await readRequesterLocalSales(scope, context, { currentActor:pinnedActor, executor: rest ? createCentralRestExecutor(rest, http, collect) : null });
    if(diagnostic&&collect){
      // Do not expose metadata after session/role changes during the REST read.
      let actor:CentralActor|null;try{actor=await currentActor();}catch{return state;}
      if(actor?.role==='admin'&&actor.userId===expectedRequesterId)return {...state,transportDiagnostics:diagnostic};
    }
    return state;
  }
  catch { return centralState('error', scope, 'READ_FAILED'); }
}
