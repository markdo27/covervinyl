/**
 * Character morph between two texts: glyphs that exist in both (same character
 * and same font) slide from their old to their new position, everything else
 * fades out or in. This recreates the intro title effect where e.g.
 * "jazz**matic**" grows into "jazz samples: **illmatic**".
 */

export interface MorphPlan<T> {
  matched: [T, T][];
  removed: T[];
  added: T[];
}

/** Longest-common-subsequence matching on `key`. O(n*m), fine for titles. */
export function planMorph<T extends { key: string }>(from: T[], to: T[]): MorphPlan<T> {
  const n = from.length;
  const m = to.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = from[i].key === to[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const matched: [T, T][] = [];
  const removed: T[] = [];
  const added: T[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (from[i].key === to[j].key && dp[i][j] === dp[i + 1][j + 1] + 1) {
      matched.push([from[i], to[j]]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(from[i]);
      i++;
    } else {
      added.push(to[j]);
      j++;
    }
  }
  while (i < n) removed.push(from[i++]);
  while (j < m) added.push(to[j++]);
  return { matched, removed, added };
}
