import type { ComponentType, CSSProperties } from 'react';
import { IcHome, IcSpark, IcRanking, IcLink, IcPromo, IcReview, IcFlag, IcReport, IcBrandRanking, IcCompany, IcRecommend, IcSnap, IcBook, IcProduct, IcBrand, IcMore, IcHelp, IcShield, IcUsers, IcCalendar, IcBell, IcMapping, IcUser } from '@/components/ui/icons';

export type ShellNavigationItem = {
  id: string; path: string; label: string;
  Icon: ComponentType<{ size?: number; style?: CSSProperties }>;
  group: 'primary' | 'reference' | 'utility' | 'admin';
  parent?: string; search: boolean; aliases?: string[];
  disclosure?: boolean; external?: boolean; adminOnly?: boolean;
  sidebarHidden?: boolean; mobileHidden?: boolean;
};
export const SHELL_NAVIGATION: ShellNavigationItem[] = [
  { id:'home', path:'/', label:'홈', Icon:IcHome, group:'primary', search:true },
  { id:'today', path:'/today', label:'오늘의매거진', Icon:IcSpark, group:'primary', search:true },
  { id:'ranking', path:'/ranking', label:'상품랭킹', Icon:IcRanking, group:'primary', search:true },
  { id:'product', path:'/product', label:'상품 검색', Icon:IcProduct, group:'primary', parent:'ranking', search:true },
  { id:'matching', path:'/matching', label:'자사매칭', Icon:IcLink, group:'primary', search:true },
  { id:'promo', path:'/promo', label:'프로모션', Icon:IcPromo, group:'primary', search:true },
  { id:'reviews', path:'/reviews', label:'자사리뷰', Icon:IcReview, group:'primary', search:true },
  { id:'anomaly', path:'/anomaly', label:'이상탐지', Icon:IcFlag, group:'primary', search:true },
  { id:'reference', path:'', label:'시장 참고자료', Icon:IcMore, group:'reference', disclosure:true, search:false },
  { id:'report', path:'/report', label:'심층리포트', Icon:IcReport, group:'reference', parent:'reference', search:true },
  { id:'brand-ranking', path:'/brand-ranking', label:'브랜드랭킹', Icon:IcBrandRanking, group:'reference', parent:'reference', search:true },
  { id:'brand', path:'/brand', label:'브랜드 검색', Icon:IcBrand, group:'reference', parent:'brand-ranking', search:true },
  { id:'companies', path:'/companies', label:'회사목록', Icon:IcCompany, group:'reference', parent:'reference', search:true },
  { id:'company', path:'/company', label:'회사 검색', Icon:IcCompany, group:'reference', parent:'companies', search:true },
  { id:'recommend', path:'/recommend', label:'추천판', Icon:IcRecommend, group:'reference', parent:'reference', search:true },
  { id:'snap', path:'/snap', label:'착장스냅', Icon:IcSnap, group:'reference', parent:'reference', search:true },
  { id:'magazine', path:'/magazine', label:'무신사매거진', Icon:IcBook, group:'reference', parent:'reference', search:true },
  { id:'manual', path:'https://www.notion.so/36b7af342d908176b629c6343d1c35a7', label:'사용 매뉴얼', Icon:IcHelp, group:'utility', search:false, external:true, mobileHidden:true },
  { id:'me', path:'/me', label:'내 정보', Icon:IcUser, group:'utility', search:true, aliases:['내 프로필','마이페이지'], sidebarHidden:true },
  { id:'admin', path:'/admin', label:'관리자', Icon:IcShield, group:'admin', search:false, adminOnly:true },
  { id:'admin-dashboard', path:'/admin', label:'관리 대시보드', Icon:IcShield, group:'admin', parent:'admin', search:false, adminOnly:true },
  { id:'admin-users', path:'/admin/users', label:'사용자 관리', Icon:IcUsers, group:'admin', parent:'admin', search:false, adminOnly:true },
  { id:'admin-llm', path:'/admin/llm', label:'LLM 관리', Icon:IcSpark, group:'admin', parent:'admin', search:false, adminOnly:true },
  { id:'admin-jobs', path:'/admin/jobs', label:'수집 모니터링', Icon:IcCalendar, group:'admin', parent:'admin', search:false, adminOnly:true },
  { id:'admin-notifications', path:'/admin/notifications', label:'알림 모니터링', Icon:IcBell, group:'admin', parent:'admin', search:false, adminOnly:true },
  { id:'admin-mapping', path:'/admin/mapping', label:'DART 매핑', Icon:IcMapping, group:'admin', parent:'admin', search:false, adminOnly:true },
  { id:'admin-anomalies', path:'/admin/anomalies', label:'이상탐지 룰', Icon:IcFlag, group:'admin', parent:'admin', search:false, adminOnly:true },
  { id:'admin-guides', path:'/admin/guides', label:'가이드 관리', Icon:IcBook, group:'admin', parent:'admin', search:false, adminOnly:true },
];
export function shellPathMatches(pathname: string, path: string): boolean {
  if (!path) return false;
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path + '/');
}
export const SHELL_GROUPS = new Set(SHELL_NAVIGATION.flatMap(item => item.parent ? [item.parent] : []));
export function shellAncestors(id: string): string[] {
  const result: string[] = [];
  let item = SHELL_NAVIGATION.find(item => item.id === id);
  while (item?.parent) { result.unshift(item.parent); item = SHELL_NAVIGATION.find(parent => parent.id === item!.parent); }
  return result;
}
export function shellGroupsForPath(pathname: string): string[] {
  const result = new Set<string>();
  for (const item of SHELL_NAVIGATION) if (!item.external && shellPathMatches(pathname, item.path)) {
    shellAncestors(item.id).forEach(id => result.add(id));
  }
  return [...result];
}
export function shellBreadcrumb(pathname: string): string[] {
  const item = SHELL_NAVIGATION.filter(item => !item.external && shellPathMatches(pathname, item.path))
    .sort((a,b) => b.path.length - a.path.length || Number(!!b.parent) - Number(!!a.parent))[0];
  if (!item) return ['UTTU'];
  return [...shellAncestors(item.id).map(id => SHELL_NAVIGATION.find(item => item.id === id)!.label), item.label];
}
export const SHELL_SEARCH_PAGES = SHELL_NAVIGATION.filter(item => item.search && !item.adminOnly && !item.external);
export function shellPageMatches(item: ShellNavigationItem, keyword: string): boolean {
  const normalized = keyword.toLowerCase().replace(/\s/g, '');
  return [item.label,...(item.aliases ?? [])].some(label => label.toLowerCase().replace(/\s/g, '').includes(normalized));
}
