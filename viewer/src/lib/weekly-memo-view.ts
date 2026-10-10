import { isWeeklyDate, isWeeklyId, parseWeeklyLocation, formatWeeklyTime, WEEKLY_MEMO_HEADER } from './weekly-review';

/** Recognize the v1 plaintext structure; ambiguous or edited structure has no inferred date. */
export function parseWeeklyMemoNextDate(body: string): string | null {
  const lines = body.split('\n');
  if (lines[0] !== WEEKLY_MEMO_HEADER || lines.filter(line => line === WEEKLY_MEMO_HEADER).length !== 1
    || !/^브랜드: .+$/.test(lines[1] ?? '')
    || !/^작성일 범위: \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2} \(KST\)$/.test(lines[2] ?? '')
    || !/^조회 기준: \d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d KST$/.test(lines[3] ?? '')
    || !/^별점 조건: (전체|1~2점|4~5점)$/.test(lines[4] ?? '')) return null;
  const field = (name: string) => lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trimStart().startsWith(name) && /^\s*[:：]/.test(line.trimStart().slice(name.length)));
  for (const name of ['브랜드', '작성일 범위', '조회 기준', '별점 조건', '선택한 원문', '근거 보기']) {
    if (field(name).length !== 1) return null;
  }
  const count = /^선택한 원문: ([1-9]|10)건 \(브랜드 전체의 이슈 건수·비율이 아님\)$/.exec(lines[5] ?? '');
  if (!count) return null;
  const evidenceEnd = 6 + Number(count[1]);
  if (lines[evidenceEnd] !== '' || !lines[evidenceEnd + 1]?.startsWith('관찰: ')) return null;
  for (const line of lines.slice(6, evidenceEnd)) {
    const row = /^- .+ · 작성 (\d{4}-\d{2}-\d{2}) · [1-5]\/5 · 원천 ID .+ · 저장 \d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d KST · 저장 ID (.+)$/.exec(line);
    if (!row || !isWeeklyDate(row[1]) || !isWeeklyId(row[2])) return null;
  }
  const observation = field('관찰'), check = field('다음 확인'), date = field('다음 확인일');
  if (observation.length !== 1 || check.length !== 1 || date.length !== 1
    || observation[0].index !== evidenceEnd + 1 || check[0].index <= observation[0].index
    || !check[0].line.startsWith('다음 확인: ') || !check[0].line.slice('다음 확인: '.length).trim()
    || !observation[0].line.slice('관찰: '.length).trim()
    || date[0].index <= check[0].index || date[0].index !== lines.length - 4
    || lines.at(-3) !== ''
    || lines.at(-2) !== '수집 완전성 미확인. 조회 기준 이후 저장된 리뷰는 제외하며, 원문 수정·삭제는 재열람에 반영될 수 있습니다.'
    || !/^근거 보기: \/reviews\/weekly\?[^\s]+$/.test(lines.at(-1) ?? '')) return null;
  const href = lines.at(-1)!.slice('근거 보기: '.length);
  const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
  const at = params.get('at') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at))) return null;
  // Explicit validation clock is derived from the memo cutoff, never today's date.
  const validationNow = new Date(Date.parse(at) + 86_400_000);
  if (validationNow.getUTCFullYear() > 9999) return null;
  const location = parseWeeklyLocation(params, validationNow);
  if (!location.scope || location.error || !location.evidence.length
    || location.evidence.length !== Number(count[1])
    || lines[2] !== `작성일 범위: ${location.scope.from} ~ ${location.scope.to} (KST)`
    || lines[3] !== `조회 기준: ${formatWeeklyTime(location.scope.at)}`
    || lines[4] !== `별점 조건: ${location.scope.rating === 'low' ? '1~2점' : location.scope.rating === 'high' ? '4~5점' : '전체'}`
    || lines.slice(6, evidenceEnd).some((line, index) => line.slice(line.lastIndexOf('저장 ID ') + 6).toLowerCase() !== location.evidence[index])) return null;
  const parsed = /^다음 확인일: (\d{4}-\d{2}-\d{2})$/.exec(date[0].line);
  return parsed && !parsed[1].startsWith('0000-') && isWeeklyDate(parsed[1]) ? parsed[1] : null;
}

export type WeeklyMemoOrder = 'latest' | 'nextDate';
export interface WeeklyMemoGroup<T> { date: string | null; rows: T[] }
/** Only loaded rows. Preserve server cursor order within a date, never mutate query rows. */
export function groupLoadedWeeklyMemos<T extends { body: string }>(rows: T[], order: WeeklyMemoOrder): WeeklyMemoGroup<T>[] {
  if (order === 'latest') return [{ date: null, rows: [...rows] }];
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const date = parseWeeklyMemoNextDate(row.body);
    const items = groups.get(date);
    if (items) items.push(row);
    else groups.set(date, [row]);
  }
  return [...groups.entries()].sort(([a], [b]) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)
    .map(([date, items]) => ({ date, rows: items }));
}
