const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const DETAIL_PATH = new RegExp(`^(/me/notes|/admin/guides)/${UUID}$`);

/** Map supported record detail URLs to their help article's page_path. */
export function helpPagePath(pathname: string | null): string | null {
  return pathname?.replace(DETAIL_PATH, '$1/[id]') ?? null;
}
