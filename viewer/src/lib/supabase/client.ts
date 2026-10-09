'use client';
import { createBrowserClient } from '@supabase/ssr';
import { fetchWithMatchingGuard } from './matching-transport';

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: fetchWithMatchingGuard } },
  );
}
