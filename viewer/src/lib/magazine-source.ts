/** Stored landingUrl comes directly from Musinsa's API; preserve valid destinations verbatim. */
export function magazineSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? value : null;
  } catch { return null; }
}

/** Preserve the existing mobile fallback only when the source field is absent. */
export function mobileMagazineSourceUrl(value: unknown, articleId: string): string | null {
  return magazineSourceUrl(value === null ? `https://www.musinsa.com/app/contents/detail/${encodeURIComponent(articleId)}` : value);
}
