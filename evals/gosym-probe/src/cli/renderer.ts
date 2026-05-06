import chalk from 'chalk';

const primary = chalk.hex('#7C6AEF');
const accent = chalk.hex('#4ED4C8');

const PRIMARY_HEX = '#7C6AEF';
const ACCENT_HEX = '#4ED4C8';

const ASCII_ART: string[] = [
  '  ____       ____                   ____            _',
  ' / ___| ___ / ___| _   _ _ __ ___  |  _ \\ _ __ ___ | |__   ___',
  '| |  _ / _ \\\\___ \\| | | | \'_ ` _ \\ | |_) | \'__/ _ \\| \'_ \\ / _ \\',
  '| |_| | (_) |___) | |_| | | | | | ||  __/| | | (_) | |_) |  __/',
  ' \\____|\\___/|____/ \\__, |_| |_| |_||_|   |_|  \\___/|_.__/ \\___|',
  '                   |___/',
];

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function interpolateHex(
  hex1: string,
  hex2: string,
  t: number,
): string {
  const [r1, g1, b1] = parseHex(hex1);
  const [r2, g2, b2] = parseHex(hex2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (
    '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
  );
}

function gradientLine(
  line: string,
  maxWidth: number,
  offset: number = 0,
): string {
  return [...line]
    .map((ch, i) => {
      if (ch === ' ') return ch;
      // Cosine wave: seam-free cycle, purple at phase 0 and 1
      const phase = ((i / maxWidth) - offset + 1) % 1;
      const t = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
      return chalk.hex(
        interpolateHex(PRIMARY_HEX, ACCENT_HEX, t),
      )(ch);
    })
    .join('');
}

export function startupBanner(offset: number = 0): string {
  const maxWidth = Math.max(
    ...ASCII_ART.map((l) => l.length),
  );
  const art = ASCII_ART
    .map((line) => gradientLine(line, maxWidth, offset))
    .join('\n');
  const sub = `\u{1F916} ${primary('(Airo App Builder Client)')}`;
  return `\n${art}\n\n${sub}\n${divider()}\n`;
}

export function banner(): string {
  const title = primary.bold('\u{1F916} gosym-probe');
  const tagline = chalk.dim('AAB eval harness');
  return `\n${title}  ${tagline}\n${divider()}\n`;
}

export function menuItem(key: string, label: string): string {
  const bracket = accent(`[${key}]`);
  return `  ${bracket}  ${label}`;
}

export function divider(width = 40): string {
  return chalk.dim('─'.repeat(width));
}

export function table(
  headers: string[],
  rows: string[][],
): string {
  const colWidths = headers.map((h, i) => {
    if (rows.length === 0) return h.length;
    return Math.max(
      h.length,
      ...rows.map((r) => (r[i] ?? '').length),
    );
  });

  const headerRow = headers
    .map((h, i) => primary.bold(h.padEnd(colWidths[i] ?? 0)))
    .join('  ');

  const dataRows = rows.map((row) =>
    row
      .map((cell, i) => cell.padEnd(colWidths[i] ?? 0))
      .join('  '),
  );

  return [headerRow, divider(80), ...dataRows].join('\n');
}

export function masked(value: string): string {
  if (!value) return chalk.dim('(empty)');
  return chalk.dim('*'.repeat(Math.min(value.length, 8)));
}

export function statusBadge(status: string): string {
  const upper = status.toUpperCase();
  type ColorFn = (s: string) => string;
  const badges: Record<string, ColorFn> = {
    PASS: (s) => chalk.bgGreen.black(` ${s} `),
    FAIL: (s) => chalk.bgRed.white(` ${s} `),
    SKIP: (s) => chalk.bgYellow.black(` ${s} `),
    RUNNING: (s) => chalk.bgBlue.white(` ${s} `),
  };
  const fn: ColorFn =
    badges[upper] ?? ((s) => chalk.bgWhite.black(` ${s} `));
  return fn(upper);
}

export function clear(): string {
  // cursor home + erase display + erase scrollback
  return '\x1B[H\x1B[2J\x1B[3J';
}

export function sectionTitle(text: string): string {
  return primary.bold(text);
}

export function pressAnyKeyPrompt(): string {
  return chalk.dim('\n── press any key ──\n');
}

export function pressEscPrompt(): string {
  return chalk.dim('\n── press Esc to go back ──\n');
}
