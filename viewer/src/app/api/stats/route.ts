import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 3600; // 1시간 캐시

function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

export async function GET() {
  try {
    const sb = admin();
    const [brands, products, reviews] = await Promise.all([
      sb.from('brands').select('*', { count: 'exact', head: true }),
      sb.from('products').select('*', { count: 'exact', head: true }),
      sb.from('reviews').select('*', { count: 'exact', head: true }),
    ]);

    return NextResponse.json({
      brands:   brands.count  ?? 0,
      products: products.count ?? 0,
      reviews:  reviews.count  ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
