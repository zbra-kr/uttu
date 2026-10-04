import React from 'react';
function notify(){window.dispatchEvent(new Event('popstate'));}
export const router={push(url:string){history.pushState({},'',url);notify();},replace(url:string){history.replaceState({},'',url);notify();},back(){history.back();},refresh(){notify();},prefetch(){}};
function useURL(){const [url,setURL]=React.useState(()=>location.href);React.useEffect(()=>{const fn=()=>setURL(location.href);window.addEventListener('popstate',fn);return()=>window.removeEventListener('popstate',fn);},[]);return new URL(url);}
export const usePathname=()=>useURL().pathname;
export const useSearchParams=()=>useURL().searchParams;
export const useRouter=()=>router;
export default function Link({href,children,onClick,...props}:any){return <a {...props} href={typeof href==='string'?href:'#'} onClick={e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();router.push(href);}}}>{children}</a>;}
