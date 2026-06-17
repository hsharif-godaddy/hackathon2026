// Spike: confirm @ast-grep/napi loads, parses TS/TSX, matches a metavariable,
// and exposes node range. Mirrors the pinned js-api (parse/root/findAll/getMatch/range).
import { parse, Lang } from '@ast-grep/napi';

const src = [
  'function handler(req, res) {',
  '  console.log("hit", req.path);',
  '  return res.send(downloadResource(req.id));',
  '}',
].join('\n');

const root = parse(Lang.TypeScript, src).root();

const logs = root.findAll('console.log($$$ARGS)');
const calls = root.findAll('downloadResource($A)');

console.log('logs matched:', logs.length);
console.log('first log args:', logs[0]?.getMultipleMatches('ARGS').map((n) => n.text()));
console.log('downloadResource arg:', calls[0]?.getMatch('A')?.text());
const r = calls[0]?.range();
console.log('downloadResource range:', r && { line: r.start.line, col: r.start.column });

// TSX must also load.
const tsx = parse(Lang.Tsx, 'const x = <Foo bar={baz} />;').root();
console.log('tsx kind:', tsx.kind());

const ok = logs.length === 1 && calls[0]?.getMatch('A')?.text() === 'req.id' && !!r;
console.log(ok ? 'SPIKE_PASS' : 'SPIKE_FAIL');
process.exit(ok ? 0 : 1);
