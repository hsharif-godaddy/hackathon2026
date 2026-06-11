import { useEffect, useId, useRef, type JSX } from 'react';

const FACE_CLIP_PATH =
  'M56.6571 245L18.6571 81.5001C113.057 40.7001 137.657 120.833 138.157 166C131.324 166.333 116.957 168.5 114.157 174.5C110.657 182 120.657 193.5 124.157 201C127.657 208.5 130.657 226.5 120.657 235.5C110.657 244.5 87.6571 229 80.6571 230C75.0571 230.8 62.3238 240.333 56.6571 245Z';

const SMILE_KEYFRAMES = [
  'M80.1571 180.5 C88 193, 106 214, 118 212',
  'M78       179   C87 195, 106 217, 118 214',
  'M76       178   C86 198, 106 220, 116 216',
  'M78       179   C87 195, 106 217, 118 214',
  'M80.1571 180.5 C88 193, 106 214, 118 212',
] as const;

const SMILE_REST =
  'M80.1571 180.5C86.3182 191.831 104.344 214.29 118 212';

const BROW_REST = 'M62 108 C68 102, 92 102, 99 108';
const BROW_UP = 'M61 103 C68  96, 92  96, 100 103';

const HAIR_CONFIG = [
  { amp: 18, speed: 1.7, phase: 0.0 },
  { amp: 22, speed: 1.5, phase: 0.55 },
  { amp: 16, speed: 1.9, phase: 1.1 },
  { amp: 20, speed: 1.6, phase: 1.65 },
] as const;

const SMILE_KEYFRAME_NUMS = SMILE_KEYFRAMES.map(function parseSmileFrame(frame) {
  return parseNums(frame);
});
const BROW_REST_NUMS = parseNums(BROW_REST);
const BROW_UP_NUMS = parseNums(BROW_UP);

function parseNums(pathData: string): number[] {
  return pathData.match(/-?[\d.]+/g)?.map(Number) ?? [];
}

function buildPath(template: string, nums: number[]): string {
  let index = 0;
  return template.replace(/-?[\d.]+/g, () => nums[index++]!.toFixed(4));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animated "Thinking Daddy" mascot from the approved prototype — head tilt,
 * hair bounce, glasses bob, star spin (CSS), smile morph + eyebrow blink (rAF).
 */
export function ThinkingDaddyGraphic(): JSX.Element {
  const faceClipId = `thinking-daddy-face${useId().replace(/:/g, '')}`;
  const smileRef = useRef<SVGPathElement>(null);
  const eyebrowRef = useRef<SVGPathElement>(null);
  const hairRefs = useRef<(SVGGElement | null)[]>([]);

  useEffect(function animateThinkingDaddy() {
    const reducedMotion = prefersReducedMotion();
    if (reducedMotion) {
      return;
    }

    const smileEl = smileRef.current;
    const eyebrowEl = eyebrowRef.current;
    if (!smileEl || !eyebrowEl) {
      return;
    }
    const smilePath = smileEl;
    const eyebrowPath = eyebrowEl;

    let smileStart: number | null = null;
    let hairStart: number | null = null;
    let frameId = 0;
    const blinkTimeouts: ReturnType<typeof setTimeout>[] = [];
    let blinkCancelled = false;

    function animateFrame(timestamp: number) {
      if (!smileStart) {
        smileStart = timestamp;
      }
      if (!hairStart) {
        hairStart = timestamp;
      }

      const progress = ((timestamp - smileStart) % 3600) / 3600;
      const total = SMILE_KEYFRAMES.length - 1;
      const segment = progress * total;
      const index = Math.min(Math.floor(segment), total - 1);
      const t = easeInOut(segment - index);
      const from = SMILE_KEYFRAME_NUMS[index]!;
      const to = SMILE_KEYFRAME_NUMS[index + 1]!;
      smilePath.setAttribute(
        'd',
        buildPath(
          SMILE_KEYFRAMES[0],
          from.map((value, i) => lerp(value, to[i]!, t)),
        ),
      );
      smilePath.setAttribute(
        'stroke-width',
        (4 + Math.max(0, Math.sin(progress * Math.PI * 2)) * 2).toFixed(2),
      );

      const elapsed = (timestamp - hairStart) * 0.001;
      hairRefs.current.forEach(function bounceStrand(el, strandIndex) {
        if (!el) {
          return;
        }
        const config = HAIR_CONFIG[strandIndex]!;
        const raw = Math.sin(elapsed * config.speed * Math.PI * 2 + config.phase);
        const ty = -raw * config.amp;
        const sy = raw > 0 ? 1 + raw * 0.18 : 1 + raw * 0.12;
        const sx = raw > 0 ? 1 - raw * 0.08 : 1 - raw * 0.06;
        el.setAttribute(
          'transform',
          `translate(0,${ty.toFixed(2)}) scale(${sx.toFixed(3)},${sy.toFixed(3)})`,
        );
      });

      frameId = requestAnimationFrame(animateFrame);
    }

    function setBrow(nums: number[]) {
      eyebrowPath.setAttribute('d', buildPath(BROW_REST, nums));
    }

    function tweenBrow(
      from: number[],
      to: number[],
      duration: number,
      easeFn: (value: number) => number,
      done?: () => void,
    ) {
      const start = performance.now();
      function step(now: number) {
        if (blinkCancelled) {
          return;
        }
        const raw = Math.min((now - start) / duration, 1);
        setBrow(from.map((value, i) => lerp(value, to[i]!, easeFn(raw))));
        if (raw < 1) {
          requestAnimationFrame(step);
        } else {
          done?.();
        }
      }
      requestAnimationFrame(step);
    }

    function scheduleBlink(delayMs: number) {
      const timeoutId = setTimeout(function runBlink() {
        if (blinkCancelled) {
          return;
        }
        tweenBrow(BROW_REST_NUMS, BROW_UP_NUMS, 70, easeOut, function afterBrowUp() {
          const holdId = setTimeout(function lowerBrow() {
            if (blinkCancelled) {
              return;
            }
            tweenBrow(BROW_UP_NUMS, BROW_REST_NUMS, 120, easeOut, function afterBrowDown() {
              scheduleBlink(2800 + Math.random() * 2700);
            });
          }, 90);
          blinkTimeouts.push(holdId);
        });
      }, delayMs);
      blinkTimeouts.push(timeoutId);
    }

    frameId = requestAnimationFrame(animateFrame);
    scheduleBlink(1500);

    return function cleanupThinkingDaddy() {
      blinkCancelled = true;
      cancelAnimationFrame(frameId);
      for (const timeoutId of blinkTimeouts) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  return (
    <svg
      className="airo-primitives-thinking-indicator__thinking-daddy"
      viewBox="10 62 140 170"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={faceClipId}>
          <path d={FACE_CLIP_PATH} />
        </clipPath>
      </defs>
      <path
        d="M19.6571 168.5C17.2571 156.9 27.9904 149 33.6571 146.5L41.1571 178.5C34.9904 180 22.0571 180.1 19.6571 168.5Z"
        fill="#FEFEFE"
        stroke="black"
        strokeWidth="4"
      />
      <path
        d={FACE_CLIP_PATH}
        fill="#FEFEFE"
        stroke="black"
        strokeWidth="4"
      />
      <path
        className="airo-primitives-thinking-indicator__thinking-daddy-glasses-lens"
        d="M80.1571 113C91.643 113 101.657 120.707 101.657 131C101.657 141.293 91.643 149 80.1571 149C68.6712 149 58.6571 141.293 58.6571 131C58.6571 120.707 68.6712 113 80.1571 113Z"
        fill="#BED83C"
        stroke="black"
        strokeWidth="4"
      />
      <path
        className="airo-primitives-thinking-indicator__thinking-daddy-glasses-ear"
        d="M134.657 119C140.699 119 146.269 120.22 150.401 122.286C154.414 124.293 157.657 127.435 157.657 131.5C157.657 135.565 154.414 138.708 150.401 140.714C146.269 142.78 140.699 144 134.657 144C128.615 144 123.045 142.78 118.913 140.714C114.9 138.708 111.657 135.565 111.657 131.5C111.657 127.435 114.9 124.293 118.913 122.286C123.045 120.22 128.615 119 134.657 119Z"
        fill="#BED83C"
        stroke="black"
        strokeWidth="4"
      />
      <path
        d="M100.657 130C103.657 129.167 110.257 128 112.657 130"
        stroke="black"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M31.6571 136L57.6571 132" stroke="black" strokeWidth="4" />
      <path
        ref={eyebrowRef}
        d={BROW_REST}
        fill="none"
        stroke="black"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <g className="airo-primitives-thinking-indicator__thinking-daddy-star">
        <path
          d="M12.1571 99.0001C32.9571 90.6001 34.1571 71.8335 32.1571 63.5001L40.6571 87.0001C47.4571 83.8001 55.1571 85.6668 58.1571 87.0001L45.1571 94.0001L58.1571 115.5L37.1571 102L19.6571 120L26.1571 99.0001H12.1571Z"
          fill="#FDD620"
          stroke="black"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </g>
      <g
        ref={(node) => {
          hairRefs.current[0] = node;
        }}
        className="airo-primitives-thinking-indicator__thinking-daddy-hair"
      >
        <path
          d="M91.6571 4.00012C89.6571 6.50012 79.6571 16.0001 85.6571 26.5001C91.6571 37.0001 104.157 42.5001 96.6571 59.5001"
          stroke="#F28327"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </g>
      <g
        ref={(node) => {
          hairRefs.current[1] = node;
        }}
        className="airo-primitives-thinking-indicator__thinking-daddy-hair"
      >
        <path
          d="M73.6571 0.00012C68.3238 4.8335 60.1571 18.5001 70.1571 34.5001C80.1571 50.5001 74.3238 55.5001 70.1571 56.0001"
          stroke="#F28327"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </g>
      <g
        ref={(node) => {
          hairRefs.current[2] = node;
        }}
        className="airo-primitives-thinking-indicator__thinking-daddy-hair"
      >
        <path
          d="M51.1571 2.50012C38.6571 6.00012 34.6571 10.5001 37.1571 14.5001C39.6571 18.5001 53.6571 37.0001 54.1571 41.0001C54.5571 44.2001 52.3238 50.6668 51.1571 45"
          stroke="#F28327"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </g>
      <g
        ref={(node) => {
          hairRefs.current[3] = node;
        }}
        className="airo-primitives-thinking-indicator__thinking-daddy-hair"
      >
        <path
          d="M7.65712 17.5001C3.65712 22.6668 -0.442883 36.5001 15.1571 50.5001C30.7571 64.5001 24.6571 70.3335 19.6571 71.5001"
          stroke="#F38327"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </g>
      <g clipPath={`url(#${faceClipId})`}>
        <path
          ref={smileRef}
          d={SMILE_REST}
          stroke="black"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
