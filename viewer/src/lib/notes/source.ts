import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUuid } from '@/lib/teams/identity';
import {
  validateRankingSourceContext, rankingSourceFromEntity, rankingContextToSearchParams,
} from './ranking-context';

export interface NoteSource {
  id: string;
  entity_type?: string | null;
  entity_id?: string | null;
  source_context?: unknown;
}

const PAGE_TITLES: Record<string, string> = {
  product: '상품 상세', company: '회사 상세', brand: '브랜드 상세', ranking_filter: '상품 랭킹',
  review: '리뷰', anomaly: '이상징후', magazine: '매거진',
};

/** Authenticated reads only. Never use an author-provided label, URL or origin. */
export async function resolveNoteSource(sb: Pick<SupabaseClient, 'from'>, note: NoteSource) {
  const title = PAGE_TITLES[note.entity_type ?? ''] ?? '메모';
  const fallback = { title, path: `/me/notes/${encodeURIComponent(note.id)}` };
  if (!isUuid(note.id) || !note.entity_id) return fallback;
  const params = new URLSearchParams({ notes: 'open', note: note.id });
  if (note.entity_type === 'ranking_filter') {
    const context = validateRankingSourceContext(note.source_context, note.entity_id)
      ?? rankingSourceFromEntity(note.entity_id);
    if (!context) return fallback;
    const ranking = rankingContextToSearchParams(context);
    params.forEach((value, key) => ranking.set(key, value));
    const path = `/ranking?${ranking}`;
    return path.length <= 6000 ? { title, path } : fallback;
  }
  if (!isUuid(note.entity_id)) return fallback;
  try {
    if (note.entity_type === 'product') {
      const { data, error } = await sb.from('products').select('musinsa_no,name').eq('id', note.entity_id).maybeSingle();
      const number = String(data?.musinsa_no ?? '');
      if (error || !/^\d{1,20}$/.test(number)) return fallback;
      let name = data?.name;
      if (!name || name === '(stub)') {
        // Match the actual product page's title for incompletely collected products.
        const { data: rows } = await sb.from('ranking_snapshots').select('product_name')
          .eq('musinsa_no', Number(number)).order('snapshot_date', { ascending: false })
          .order('rank_position', { ascending: true }).limit(1);
        name = rows?.[0]?.product_name || '상품명 미수집';
      }
      params.set('no', number);
      return { title: name ? `${title} (${name})` : title, path: `/product?${params}` };
    }
    if (note.entity_type === 'brand' || note.entity_type === 'company') {
      const column = note.entity_type === 'brand' ? 'name' : 'corp_name';
      const { data, error } = await sb.from(note.entity_type === 'brand' ? 'brands' : 'companies')
        .select(column).eq('id', note.entity_id).maybeSingle();
      if (error || !data) return fallback;
      const name = (data as unknown as Record<string, unknown>)[column];
      params.set('id', note.entity_id);
      return { title: typeof name === 'string' && name ? `${title} (${name})` : title,
        path: `/${note.entity_type}?${params}` };
    }
  } catch { /* A removed/unavailable source must not make the memo inaccessible. */ }
  return fallback;
}
