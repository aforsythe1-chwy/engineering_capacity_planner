/** Normalize local-search terms so punctuation and spacing do not affect matching. */
export function normalizeFuzzyText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Scores an ordered-character match. Lower scores are better; null means no
 * match. Prefixes and substrings intentionally outrank sparse matches.
 */
export function fuzzyScore(value: string, query: string): number | null {
  const haystack = normalizeFuzzyText(value);
  const needle = normalizeFuzzyText(query);
  if (!needle) return 0;
  if (haystack.startsWith(needle)) return 0;
  const substring = haystack.indexOf(needle);
  if (substring >= 0) return 10 + substring;
  let cursor = 0;
  let score = 30;
  for (const character of needle.replace(/\s/g, '')) {
    const next = haystack.indexOf(character, cursor);
    if (next < 0) return null;
    score += next - cursor;
    cursor = next + 1;
  }
  return score;
}
