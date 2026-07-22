import { supabaseBrowser } from './supabase/client';

// ── 인터페이스 ────────────────────────────────────────────────────────────────

export interface HelpArticle {
  id: string;
  slug: string;
  title: string;
  page_path: string | null;
  category: string | null;
  sort_order: number;
  content: object;
  is_published: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HelpArticleVersion {
  id: string;
  article_id: string;
  version_number: number;
  title: string;
  content: object;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TocItem {
  id: string;
  slug: string;
  title: string;
  page_path: string | null;
  category: string | null;
  sort_order: number;
}

export interface HelpCategory {
  name: string;
  articles: TocItem[];
}

// ── 쿼리 함수 ─────────────────────────────────────────────────────────────────

/** 특정 앱 경로에 연결된 공개 아티클 목록 */
export async function fetchHelpByPath(pagePath: string): Promise<HelpArticle[]> {
  const { data, error } = await supabaseBrowser()
    .from('help_articles')
    .select('*')
    .eq('page_path', pagePath)
    .eq('is_published', true)
    .order('sort_order');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** slug로 아티클 단건 조회 (미공개 포함 — RLS가 admin 여부 판단) */
export async function fetchHelpBySlug(slug: string): Promise<HelpArticle | null> {
  const { data, error } = await supabaseBrowser()
    .from('help_articles')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** 공개 아티클 전체를 카테고리별로 그룹화한 트리 */
export async function fetchHelpTree(): Promise<HelpCategory[]> {
  const { data, error } = await supabaseBrowser()
    .from('help_articles')
    .select('id, slug, title, page_path, category, sort_order')
    .eq('is_published', true)
    .order('category', { nullsFirst: true })
    .order('sort_order');
  if (error) throw new Error(error.message);

  const grouped = new Map<string, TocItem[]>();
  for (const item of (data ?? []) as TocItem[]) {
    const cat = item.category ?? '일반';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(item);
  }
  return Array.from(grouped.entries()).map(([name, articles]) => ({ name, articles }));
}

/** 제목·카테고리에서 키워드 검색 (ilike — 한국어 포함) */
export async function searchHelp(query: string): Promise<HelpArticle[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabaseBrowser()
    .from('help_articles')
    .select('*')
    .eq('is_published', true)
    .or(`title.ilike.%${q}%,category.ilike.%${q}%`)
    .order('sort_order')
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** 아티클 수정 이력 (최신순) */
export async function fetchHelpVersions(articleId: string): Promise<HelpArticleVersion[]> {
  const { data, error } = await supabaseBrowser()
    .from('help_article_versions')
    .select('*')
    .eq('article_id', articleId)
    .order('version_number', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── 관리자용 함수 (비공개 포함) ───────────────────────────────────────────────

export interface HelpArticleRow extends HelpArticle {
  version_count: number;
}

export const HELP_CATEGORIES = ['시작하기', '주요기능', '분석', '관리자', '용어집'] as const;
export type HelpCategoryName = (typeof HELP_CATEGORIES)[number];

/** 관리자 목록용 (비공개 포함, RLS가 admin 판단) */
export async function fetchAllArticles(opts?: {
  category?: string;
  search?: string;
}): Promise<HelpArticleRow[]> {
  const sb = supabaseBrowser();

  let q = sb
    .from('help_articles')
    .select('*')
    .order('updated_at', { ascending: false });

  if (opts?.category) q = q.eq('category', opts.category);
  if (opts?.search) {
    const s = opts.search;
    q = q.or(`title.ilike.%${s}%,slug.ilike.%${s}%`);
  }

  const { data, error } = await q.limit(500);
  if (error) throw new Error(error.message);
  if (!data?.length) return [];

  const ids = data.map(a => a.id);
  const { data: vRows } = await sb
    .from('help_article_versions')
    .select('article_id')
    .in('article_id', ids);

  const vCount: Record<string, number> = {};
  for (const v of vRows ?? []) {
    vCount[v.article_id] = (vCount[v.article_id] ?? 0) + 1;
  }

  return data.map(a => ({ ...a, version_count: vCount[a.id] ?? 0 }));
}

/** 아티클 단건 조회 (ID 기준, 비공개 포함) */
export async function fetchArticleById(id: string): Promise<HelpArticle | null> {
  const { data, error } = await supabaseBrowser()
    .from('help_articles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export interface CreateArticleInput {
  slug: string;
  title: string;
  page_path?: string | null;
  category?: string | null;
  sort_order?: number;
  content: object;
  is_published?: boolean;
  created_by?: string | null;
}

/** 아티클 INSERT */
export async function createArticle(input: CreateArticleInput): Promise<HelpArticle> {
  const { data, error } = await supabaseBrowser()
    .from('help_articles')
    .insert({
      slug: input.slug,
      title: input.title,
      page_path: input.page_path ?? null,
      category: input.category ?? null,
      sort_order: input.sort_order ?? 0,
      content: input.content,
      is_published: input.is_published ?? false,
      created_by: input.created_by ?? null,
      updated_by: input.created_by ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export interface UpdateArticleInput {
  title?: string;
  page_path?: string | null;
  category?: string | null;
  sort_order?: number;
  content?: object;
  is_published?: boolean;
  updated_by?: string | null;
  changeNote?: string;
}

/** 기존 row를 help_article_versions에 백업한 뒤 UPDATE */
export async function updateArticle(
  id: string,
  input: UpdateArticleInput,
): Promise<HelpArticle> {
  const sb = supabaseBrowser();

  const { data: current, error: fetchErr } = await sb
    .from('help_articles')
    .select('title, content')
    .eq('id', id)
    .single();
  if (fetchErr) throw new Error(fetchErr.message);

  const { data: latestVer } = await sb
    .from('help_article_versions')
    .select('version_number')
    .eq('article_id', id)
    .order('version_number', { ascending: false })
    .limit(1);

  const nextVer = ((latestVer?.[0]?.version_number ?? 0) + 1);

  const { error: backupErr } = await sb
    .from('help_article_versions')
    .insert({
      article_id: id,
      version_number: nextVer,
      title: current.title,
      content: current.content,
      note: input.changeNote ?? null,
      created_by: input.updated_by ?? null,
    });
  if (backupErr) throw new Error(backupErr.message);

  const patch: Record<string, unknown> = { updated_by: input.updated_by ?? null };
  if (input.title      !== undefined) patch.title       = input.title;
  if (input.page_path  !== undefined) patch.page_path   = input.page_path;
  if (input.category   !== undefined) patch.category    = input.category;
  if (input.sort_order !== undefined) patch.sort_order  = input.sort_order;
  if (input.content    !== undefined) patch.content     = input.content;
  if (input.is_published !== undefined) patch.is_published = input.is_published;

  const { data: updated, error: updateErr } = await sb
    .from('help_articles')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (updateErr) throw new Error(updateErr.message);
  return updated;
}

/** is_published만 토글 (목록 화면 즉시 토글용) */
export async function togglePublish(id: string, isPublished: boolean): Promise<void> {
  const { error } = await supabaseBrowser()
    .from('help_articles')
    .update({ is_published: isPublished })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
