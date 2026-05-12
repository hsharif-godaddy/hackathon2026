// Split markdown on blank lines (outside fenced code) so each block can be
// rendered + memoized independently while bytes stream in. Finalized block
// indices are stable on append, so React.memo can skip prior blocks; only
// the growing tail block re-renders.
//
// CommonMark allows fences preceded by up to 3 spaces of indentation and
// accepts both backtick (```) and tilde (~~~) fences. We recognise all
// four combinations so a blank line inside a code block never causes a
// false split during streaming.
export function splitMarkdownBlocks(md: string): string[] {
  const blocks: string[] = [];
  let cur = '';
  // Track the opening fence character so a mismatched fence (e.g. a ~~~
  // line inside a ``` block) doesn't flip the state off prematurely.
  // CommonMark requires a fence to close with the same character run it
  // was opened with.
  let fenceChar: '`' | '~' | null = null;
  for (const line of md.split('\n')) {
    const stripped = line.replace(/^ {0,3}/, '');
    if (fenceChar === null) {
      if (stripped.startsWith('```')) fenceChar = '`';
      else if (stripped.startsWith('~~~')) fenceChar = '~';
    } else if (stripped.startsWith(fenceChar.repeat(3))) {
      fenceChar = null;
    }
    const inFence = fenceChar !== null;
    if (!inFence && line.trim() === '' && cur) {
      blocks.push(cur);
      cur = '';
    } else {
      cur += (cur ? '\n' : '') + line;
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}
