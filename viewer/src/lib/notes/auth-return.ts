/** Keep persisted-note returns small enough for OAuth URLs and sealed cookies.
 * After authentication the RLS-bound permalink restores the saved source context.
 */
export function compactNoteAuthReturn(path: string): string {
  try {
    const base = 'https://uttu.invalid';
    const url = new URL(path, base);
    const ids = url.searchParams.getAll('note');
    if (url.origin === base && ['/ranking', '/product', '/brand', '/company'].includes(url.pathname)
      && ids.length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ids[0])) {
      return `/me/notes/${ids[0].toLowerCase()}`;
    }
  } catch { /* Existing redirect validation remains responsible for other paths. */ }
  return path;
}
