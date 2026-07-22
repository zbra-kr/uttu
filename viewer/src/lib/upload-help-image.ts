import { supabaseBrowser } from './supabase/client';

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const BUCKET = 'help_assets';

/**
 * Supabase Storage 'help_assets' 버킷에 이미지를 업로드하고 공개 URL을 반환한다.
 *
 * ⚠️ 버킷 설정: 이미지가 <img src> 에 영구 삽입되므로 버킷은 public=true 여야 한다.
 *    SQL Editor → storage.buckets 에서 public 컬럼을 true로 변경하거나, Supabase 대시보드
 *    Storage → help_assets → Edit → Public으로 전환.
 */
export async function uploadHelpImage(file: File, articleId: string): Promise<string> {
  if (!ALLOWED.has(file.type)) {
    throw new Error(`지원하지 않는 파일 형식입니다 (${file.type}). JPEG·PNG·GIF·WebP·SVG만 가능합니다.`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`파일 크기가 5MB를 초과합니다 (${(file.size / 1048576).toFixed(1)} MB).`);
  }

  const ext  = file.name.split('.').pop() ?? 'jpg';
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `articles/${articleId}/${Date.now()}_${rand}.${ext}`;

  const sb = supabaseBrowser();

  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
