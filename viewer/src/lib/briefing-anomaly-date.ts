export function realCalendarDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Carry only the briefing date; retain existing filters, entity IDs and fragment. */
export function briefingAnomalyHref(href: string, date: string): string {
  const valid = realCalendarDate(date);
  if (!valid || !/^\/anomaly(?:[?#]|$)/.test(href)) return href;
  const url = new URL(href, 'https://uttu.invalid');
  url.searchParams.set('date', valid);
  return url.pathname + url.search + url.hash;
}
