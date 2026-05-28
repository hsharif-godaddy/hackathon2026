/**
 * Minimal stub for @react-spring/web.
 *
 * @godaddy/antares pulls in @visx/xychart, which imports @react-spring/web in
 * its AnimatedAnnotation component. That component is never rendered in this
 * repo's tests or Storybook stories, but Vite's bundler still resolves every
 * static import it encounters. This stub satisfies those resolution attempts
 * without requiring the real package to be installed.
 *
 * Do not add logic here — it is intentionally inert.
 */

// biome-ignore lint/suspicious/noExplicitAny: stub
const noop = (..._args: any[]): any => undefined;

// animated.div, animated.span, etc. — each returns a no-op component.
// biome-ignore lint/suspicious/noExplicitAny: stub
export const animated: any = new Proxy(
  {},
  {
    get(_t, _k) {
      return noop;
    },
  },
);

// Shorthand alias.
// biome-ignore lint/suspicious/noExplicitAny: stub
export const a: any = animated;

// Interpolation helper — returns a constant no-op in the stub.
// biome-ignore lint/suspicious/noExplicitAny: stub
export const to = (..._args: any[]): any => undefined;

export const useSpring = noop;
export const useSprings = noop;
export const useTrail = noop;
export const useTransition = noop;
export const useChain = noop;
export const useSpringRef = noop;
export const useInView = noop;

export const config = {
  default: { tension: 170, friction: 26 },
  gentle: { tension: 120, friction: 14 },
  wobbly: { tension: 180, friction: 12 },
  stiff: { tension: 210, friction: 20 },
  slow: { tension: 280, friction: 60 },
  molasses: { tension: 280, friction: 120 },
};

// biome-ignore lint/suspicious/noExplicitAny: stub
export class SpringValue<T = any> {
  constructor(public value: T) {}
  get() {
    return this.value;
  }
}

export const Spring = noop;
export const Trail = noop;
export const Transition = noop;
