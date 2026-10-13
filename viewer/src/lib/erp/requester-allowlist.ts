import 'server-only';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// New server setting is a JSON array of one or two independently verified UUIDs.
// Present but invalid plural settings never fall back to the legacy single ID.
export function validateRequesterIds(value:unknown):readonly string[]|null {
  if(!Array.isArray(value)||value.length<1||value.length>2||!value.every(id=>typeof id==='string'&&UUID.test(id)))return null;
  const ids=value.map(id=>(id as string).toLowerCase());
  if(new Set(ids).size!==ids.length)return null;
  return Object.freeze(ids);
}
export function requesterIdsFromEnvironment(env:Readonly<Record<string,string|undefined>>):readonly string[]|null {
  if(env.UTTU_ERP_REQUESTER_IDS!==undefined){
    try{return validateRequesterIds(JSON.parse(env.UTTU_ERP_REQUESTER_IDS));}catch{return null;}
  }
  return validateRequesterIds([env.UTTU_ERP_REQUESTER_ID]);
}
