/**
 * viewer 전역 날짜·숫자 포맷 유틸
 *
 * KST 변환: toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) 방식으로 통일.
 * +9h 수동 가산 방식(getTime() + 9 * 3_600_000)은 사용하지 않는다.
 */

/** Asia/Seoul 기준 현재 Date */
export function kstNow(): Date {
  return new Date();
}

/** KST 오늘 날짜 'YYYY-MM-DD' */
export function kstToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** KST 기준 N일 전 'YYYY-MM-DD' (순수 달력 산술) */
export function kstDaysAgo(n: number): string {
  const today = kstToday();
  const [y, mo, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d - n)).toISOString().slice(0, 10);
}

/** ISO → 'YYYY.MM.DD' (KST) */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
    .replace(/-/g, '.');
}

/** ISO → 'YYYY.MM.DD HH:mm' (KST) */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date.replace(/-/g, '.')} ${time}`;
}

/** ISO → 'HH:mm:ss' (KST) */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul' });
}

/** 시작·종료 ISO → 'N분 N초' (endIso null이면 현재까지) */
export function fmtDuration(startIso: string, endIso: string | null): string {
  const end = endIso ? new Date(endIso) : new Date();
  const sec = Math.round((end.getTime() - new Date(startIso).getTime()) / 1000);
  if (sec < 60)   return `${sec}초`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
  return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분`;
}

/** 숫자 → 한국식 천단위 (null/undefined → '—') */
export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('ko-KR');
}

/** 토큰 수 → 축약 '1.2K / 3.4M' */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
