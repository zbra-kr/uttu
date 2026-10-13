'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryScope } from './ranking-discovery';
import { discoveryScopeKey, DiscoveryClientError, fetchDiscoveryEvidence, type DiscoveryProduct, type EvidenceResult } from './ranking-discovery-client';
type State={status:'loading'|'ready'|'error';data:EvidenceResult|null;error:string|null};
/** Mounted only for the selected product; close/product/scope/account changes abort its read. */
export function useRankingEvidence(product:DiscoveryProduct,scope:DiscoveryScope,owner:string|null|undefined){
 const[state,setState]=useState<State>({status:'loading',data:null,error:null});const[index,setIndex]=useState(0);
 const key=discoveryScopeKey(scope),history=useRef<(string|null)[]>([null]),last=useRef<{cursor:string|null;index:number}>({cursor:null,index:0});
 const pending=useRef<AbortController|null>(null),epoch=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const cancel=useCallback(()=>{epoch.current++;pending.current?.abort();pending.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;},[]);
 const begin=useCallback((cursor:string|null,page:number)=>{
  cancel();if(!owner)return;
  const generation=epoch.current,controller=new AbortController();pending.current=controller;last.current={cursor,index:page};setState({status:'loading',data:null,error:null});
  const current=()=>generation===epoch.current&&!controller.signal.aborted;
  timer.current=setTimeout(()=>{if(!current())return;controller.abort();pending.current=null;timer.current=null;setState({status:'error',data:null,error:'aggregate-query-timeout'});},15000);
  void fetchDiscoveryEvidence(JSON.parse(key),product.productId,product.observationCount,cursor,controller.signal).then(data=>{if(current()){setState({status:'ready',data,error:null});setIndex(page);}})
   .catch(error=>{if(current())setState({status:'error',data:null,error:error instanceof DiscoveryClientError?error.code:'aggregate-unconnected'});})
   .finally(()=>{if(epoch.current!==generation)return;if(timer.current)clearTimeout(timer.current);timer.current=null;pending.current=null;});
 },[cancel,key,product.productId,product.observationCount,owner]);
 useEffect(()=>{history.current=[null];setIndex(0);begin(null,0);return cancel;},[begin,cancel]);
 return{...state,index,retry(){if(pending.current)return;begin(last.current.cursor,last.current.index);},restart(){if(pending.current)return;history.current=[null];begin(null,0);},
  next(){if(pending.current||state.status!=='ready'||!state.data?.nextCursor)return;history.current=[...history.current.slice(0,index+1),state.data.nextCursor];begin(state.data.nextCursor,index+1);},
  previous(){if(pending.current||state.status!=='ready'||!index)return;begin(history.current[index-1],index-1);}};
}
