const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=require('./helpers/load-source.cjs');
const root=path.join(__dirname,'..');
test('baseline shell menu defects are absent from the candidate',()=>{
 for(const name of ['Sidebar','MobileShell','CmdK']){
  const s=fs.readFileSync(path.join(root,'src/components/shell',name+'.tsx'),'utf8');
  assert.match(s,/shell-navigation/,name+' must consume the common navigation contract');
 }
 const source=fs.readFileSync(path.join(root,'src/components/shell/Sidebar.tsx'),'utf8');assert.doesNotMatch(source,/path:\s*'\/admin\/audit'/);
});
const navigation=load('src/lib/shell-navigation.ts');
const {SHELL_NAVIGATION:nav,SHELL_SEARCH_PAGES:pages,shellPathMatches:matches,shellGroupsForPath:groups,shellBreadcrumb:breadcrumb,shellAncestors:ancestors}=navigation;
const main=['/','/today','/ranking','/matching','/promo','/reviews','/anomaly'];
test('seven common primary routes and six default-folded reference routes retain order and names',()=>{
 assert.deepEqual(nav.filter(n=>n.group==='primary'&&!n.parent).map(n=>n.path),main);
 assert.deepEqual(nav.filter(n=>n.parent==='reference').map(n=>[n.path,n.label]),[['/report','심층리포트'],['/brand-ranking','브랜드랭킹'],['/companies','회사목록'],['/recommend','추천판'],['/snap','착장스냅'],['/magazine','무신사매거진']]);
 assert.deepEqual(groups('/'),[]);assert.deepEqual(groups('/product'),['ranking']);assert.deepEqual(groups('/brand'),['reference','brand-ranking']);assert.deepEqual(groups('/company'),['reference','companies']);
});
test('route boundaries never confuse singular portals and similarly named market pages',()=>{
 for(const [path,base]of [['/brand-ranking','/brand'],['/companies','/company'],['/ranking-extra','/ranking'],['/administer','/admin']])assert.equal(matches(path,base),false);
 assert.equal(matches('/brand/item','/brand'),true);assert.deepEqual(groups('/brand-ranking'),['reference']);assert.deepEqual(groups('/companies'),['reference']);
});
test('all public search pages and search portals remain searchable; all admin items stay gated',()=>{
 for(const path of [...main,'/report','/brand-ranking','/companies','/recommend','/snap','/magazine','/product','/brand','/company','/me'])assert.ok(pages.some(n=>n.path===path),path);
 assert.equal(pages.some(n=>n.path.startsWith('/admin')),false);assert.equal(nav.some(n=>n.path==='/admin/audit'),false);
 for(const n of nav.filter(n=>n.group==='admin')){assert.equal(n.adminOnly,true);assert.equal(n.search,false);}
 assert.ok(navigation.shellPageMatches(pages.find(n=>n.path==='/me'),'내 프로필'));
 assert.ok(navigation.shellPageMatches(pages.find(n=>n.path==='/today'),'오늘의 매거진'));
});
test('portal hierarchy and breadcrumbs use the same exact public names',()=>{
 for(const [path,parent,label]of [['/product','ranking','상품 검색'],['/brand','brand-ranking','브랜드 검색'],['/company','companies','회사 검색']]){const n=nav.find(n=>n.path===path);assert.equal(n.parent,parent);assert.equal(n.label,label);assert.ok(!n.mobileHidden);assert.equal(breadcrumb(path).at(-1),label);}
 for(const n of nav.filter(n=>n.search))assert.equal(breadcrumb(n.path).at(-1),n.label);
 assert.deepEqual(breadcrumb('/admin'),['관리자','관리 대시보드']);assert.deepEqual(breadcrumb('/report'),['시장 참고자료','심층리포트']);assert.deepEqual(breadcrumb(''),['UTTU']);
 assert.deepEqual(ancestors('brand'),['reference','brand-ranking']);
});
test('every retained internal menu URL has an existing concrete page',()=>{
 for(const item of nav.filter(item=>item.path&&!item.external))assert.ok(fs.existsSync(path.join(root,'src/app/(app)',item.path==='/'?'':item.path.slice(1),'page.tsx')),item.path);
});
