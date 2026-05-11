import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { hsvToHex, hexToHsv, hsvToRgb, normalizeHex } from '../utils/color';

export interface ColorPickerProps {
  value: string;
  /** Fires on every change (each drag pixel). Use for instant visual preview. */
  onChange: (hex: string) => void;
  /** Fires when a drag ends or hex is committed. Use for persistence. */
  onChangeEnd?: (hex: string) => void;
  /** Called on mousedown outside the picker. Consumer should hide the picker. */
  onClickOutside?: () => void;
  /** Optional slot rendered between the hex input and bottom of the picker (e.g. swatches). */
  children?: ReactNode;
}

interface HsvState {
  h: number;
  s: number;
  v: number;
}

// --- SatValCanvas ---

function SatValCanvas({ hue, sat, val, onChangeSV, onChangeEnd }: {
  hue: number;
  sat: number;
  val: number;
  onChangeSV: (s: number, v: number) => void;
  onChangeEnd?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  const WIDTH = 176;
  const HEIGHT = 130;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[ColorPicker] canvas.getContext("2d") returned null');
      return;
    }

    const [r, g, b] = hsvToRgb(hue, 1, 1);
    const hueColor = `rgb(${r},${g},${b})`;

    const gradH = ctx.createLinearGradient(0, 0, WIDTH, 0);
    gradH.addColorStop(0, '#ffffff');
    gradH.addColorStop(1, hueColor);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const gradV = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradV.addColorStop(0, 'rgba(0,0,0,0)');
    gradV.addColorStop(1, '#000000');
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }, [hue]);

  const svFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): { s: number; v: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(WIDTH, e.clientX - rect.left));
    const y = Math.max(0, Math.min(HEIGHT, e.clientY - rect.top));
    return { s: x / WIDTH, v: 1 - y / HEIGHT };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    dragging.current = true;
    canvas.setPointerCapture(e.pointerId);
    const sv = svFromEvent(e);
    if (sv) onChangeSV(sv.s, sv.v);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragging.current) return;
    const sv = svFromEvent(e);
    if (sv) onChangeSV(sv.s, sv.v);
  };

  const handlePointerUp = (): void => {
    dragging.current = false;
    onChangeEnd?.();
  };

  const thumbX = sat * WIDTH;
  const thumbY = (1 - val) * HEIGHT;

  return (
    <div style={{ position: 'relative', width: WIDTH, height: HEIGHT }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ borderRadius: '4px', cursor: 'crosshair', display: 'block' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div style={{
        position: 'absolute',
        left: thumbX,
        top: thumbY,
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        border: '2px solid white',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

// --- HueSlider ---

function HueSlider({ hue, onChangeHue, onChangeEnd }: {
  hue: number;
  onChangeHue: (h: number) => void;
  onChangeEnd?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const WIDTH = 176;
  const HEIGHT = 14;

  const hueFromEvent = (e: React.PointerEvent<HTMLDivElement>): number | null => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    const x = Math.max(0, Math.min(WIDTH, e.clientX - rect.left));
    return (x / WIDTH) * 360;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const track = trackRef.current;
    if (!track) return;
    dragging.current = true;
    track.setPointerCapture(e.pointerId);
    const h = hueFromEvent(e);
    if (h !== null) onChangeHue(h);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const h = hueFromEvent(e);
    if (h !== null) onChangeHue(h);
  };

  const handlePointerUp = (): void => {
    dragging.current = false;
    onChangeEnd?.();
  };

  const thumbLeft = (hue / 360) * WIDTH;

  return (
    <div
      ref={trackRef}
      data-testid="color-picker-hue-slider"
      style={{
        position: 'relative',
        width: WIDTH,
        height: HEIGHT,
        borderRadius: '7px',
        background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        cursor: 'pointer',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div style={{
        position: 'absolute',
        top: '-3px',
        left: thumbLeft,
        width: '14px',
        height: '20px',
        borderRadius: '4px',
        border: '2px solid white',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

// --- HexInput ---

function HexInput({ hex, onCommitHex }: {
  hex: string;
  onCommitHex: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(hex);
  const lastExternalHex = useRef(hex);

  useEffect(() => {
    if (hex !== lastExternalHex.current) {
      setDraft(hex);
      lastExternalHex.current = hex;
    }
  }, [hex]);

  const commit = (force?: boolean): void => {
    const normalized = normalizeHex(draft);
    if (normalized && (force || normalized !== hex)) {
      onCommitHex(normalized);
      lastExternalHex.current = normalized;
    } else {
      setDraft(hex);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(true);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <div style={{
        width: '28px',
        height: '28px',
        borderRadius: '4px',
        background: hex,
        border: '1px solid #ddd',
        flexShrink: 0,
      }} />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        style={{
          flex: 1,
          padding: '5px 8px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#333',
          outline: 'none',
          minWidth: 0,
        }}
      />
    </div>
  );
}

// --- Main Component ---

export default function ColorPicker({ value, onChange, onChangeEnd, onClickOutside, children }: ColorPickerProps) {
  const [hsv, setHsv] = useState<HsvState>(() => hexToHsv(value));
  const lastEmittedRef = useRef(value);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setHsv(hexToHsv(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (!onClickOutside) return;
    const handlePointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClickOutside();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClickOutside]);

  const emitChange = useCallback((newHsv: HsvState): void => {
    const hex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    lastEmittedRef.current = hex;
    onChange(hex);
  }, [onChange]);

  const emitEnd = useCallback((): void => {
    const hex = lastEmittedRef.current;
    onChangeEnd?.(hex);
  }, [onChangeEnd]);

  const handleSVChange = useCallback((s: number, v: number): void => {
    const newHsv = { ...hsv, s, v };
    setHsv(newHsv);
    emitChange(newHsv);
  }, [hsv, emitChange]);

  const handleHueChange = useCallback((h: number): void => {
    const newHsv = { ...hsv, h };
    setHsv(newHsv);
    emitChange(newHsv);
  }, [hsv, emitChange]);

  const handleHexCommit = useCallback((hex: string): void => {
    const newHsv = hexToHsv(hex);
    setHsv(newHsv);
    lastEmittedRef.current = hex;
    onChange(hex);
    onChangeEnd?.(hex);
  }, [onChange, onChangeEnd]);

  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Color picker"
      data-airo-dev-tools=""
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        background: '#fff',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        width: '200px',
      }}
    >
      <SatValCanvas hue={hsv.h} sat={hsv.s} val={hsv.v} onChangeSV={handleSVChange} onChangeEnd={emitEnd} />
      <HueSlider hue={hsv.h} onChangeHue={handleHueChange} onChangeEnd={emitEnd} />
      <HexInput hex={currentHex} onCommitHex={handleHexCommit} />
      {children}
    </div>
  );
}
