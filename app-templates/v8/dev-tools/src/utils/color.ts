export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h < 60) { r1 = c; g1 = x; }
  else if (h < 120) { r1 = x; g1 = c; }
  else if (h < 180) { g1 = c; b1 = x; }
  else if (h < 240) { g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }

  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  return [
    clamp((r1 + m) * 255),
    clamp((g1 + m) * 255),
    clamp((b1 + m) * 255),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return [r, g, b];
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r1) h = 60 * (((g1 - b1) / d) % 6);
    else if (max === g1) h = 60 * ((b1 - r1) / d + 2);
    else h = 60 * ((r1 - g1) / d + 4);
  }
  if (h < 0) h += 360;
  if (h >= 360) h -= 360;

  const s = max === 0 ? 0 : d / max;
  const v = max;

  return { h, s, v };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    console.warn(`[color-math] hexToHsv: invalid hex "${hex}", falling back to black`);
    return { h: 0, s: 0, v: 0 };
  }
  return rgbToHsv(rgb[0], rgb[1], rgb[2]);
}

export function isValidHex(value: string): boolean {
  return normalizeHex(value) !== null;
}

export function normalizeHex(value: string): string | null {
  let hex = value.trim().toLowerCase();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3 && /^[0-9a-f]{3}$/.test(hex)) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6 || !/^[0-9a-f]{6}$/.test(hex)) return null;
  return `#${hex}`;
}
