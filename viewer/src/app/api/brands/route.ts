import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

export async function POST(req: Request) {
  try {
    const { slug, name, name_eng, company_id } = await req.json() as {
      slug: string; name: string; name_eng?: string; company_id?: string;
    };
    if (!slug?.trim()) return NextResponse.json({ error: 'slug은 필수입니다' }, { status: 400 });
    if (!name?.trim()) return NextResponse.json({ error: '브랜드명은 필수입니다' }, { status: 400 });

    const row: Record<string, unknown> = {
      slug: slug.trim().toLowerCase(),
      name: name.trim(),
      detail_fetched_at: new Date().toISOString(),
    };
    if (name_eng?.trim()) row.name_eng = name_eng.trim();
    if (company_id)       row.company_id = company_id;

    const { data, error } = await adminClient()
      .from('brands')
      .insert(row)
      .select('id, slug, name, name_eng, company_id')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    const msg: string = e.message ?? String(e);
    const status = msg.includes('unique') || msg.includes('duplicate') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
