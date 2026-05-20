/**
 * Word-level LCS diff used by the Fix popover to highlight what changed
 * between the original text and the model's correction.
 *
 * Tokens are split on whitespace boundaries with whitespace preserved as
 * its own tokens, so the reconstructed output is loss-free for rendering.
 */

export type DiffPartType = "unchanged" | "added" | "removed";

export interface DiffPart {
  type: DiffPartType;
  text: string;
}

const TOKEN_SPLIT = /(\s+)/;

function tokenize(text: string): string[] {
  return text.split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

export function diffWords(oldText: string, newText: string): DiffPart[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const raw: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ type: "unchanged", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: "removed", text: a[i] });
      i++;
    } else {
      raw.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < m) raw.push({ type: "removed", text: a[i++] });
  while (j < n) raw.push({ type: "added", text: b[j++] });

  return coalesce(raw);
}

function coalesce(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last && last.type === part.type) {
      last.text += part.text;
    } else {
      out.push({ ...part });
    }
  }
  return out;
}
