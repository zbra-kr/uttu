import { requireAdmin } from '@/lib/auth/require-admin';
import { NextResponse } from 'next/server';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  return NextResponse.json({
    claude: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  });
}
