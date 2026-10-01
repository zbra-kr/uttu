/** Exact selected ranges, not name/email inference. Removing/editing a token removes its recipients. */
export interface SelectedMention {
  key: string;
  label: string;
  userIds: string[];
  start: number;
  end: number;
}

export function moveMentionRanges(before: string, after: string, mentions: SelectedMention[]): SelectedMention[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const oldEnd = before.length - suffix;
  const delta = after.length - before.length;
  // A text-only diff cannot distinguish deleting the first or last identical
  // @label, including a manually typed unselected copy. Never guess which token
  // survived: invalidate that ambiguous label and require explicit reselection.
  const ambiguous = new Set<string>();
  for (const mention of mentions) {
    const token = `@${mention.label}`;
    const occurrences: Array<{ start: number; end: number }> = [];
    let start = before.indexOf(token);
    while (start !== -1) {
      const end = start + token.length;
      if (!before[end] || !/[\p{L}\p{N}_]/u.test(before[end])) occurrences.push({ start, end });
      start = before.indexOf(token, start + token.length);
    }
    if (before !== after && occurrences.length > 1
      && occurrences.some(range => prefix <= range.end && oldEnd >= range.start)) ambiguous.add(mention.label);
  }
  return mentions.flatMap(mention => {
    if (ambiguous.has(mention.label)) return [];
    let moved = mention;
    if (oldEnd <= mention.start) moved = { ...mention, start: mention.start + delta, end: mention.end + delta };
    else if (prefix < mention.end) return [];
    if (after.slice(moved.start, moved.end) !== `@${moved.label}`) return [];
    const next = after[moved.end];
    if (next && /[\p{L}\p{N}_]/u.test(next)) return [];
    return [moved];
  });
}

export function selectedMentionIds(mentions: SelectedMention[], authorId: string | null): string[] {
  return [...new Set(mentions.flatMap(mention => mention.userIds))].filter(id => id !== authorId);
}
