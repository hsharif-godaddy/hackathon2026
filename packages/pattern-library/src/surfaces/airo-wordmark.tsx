import { type JSX, useId } from 'react';

/**
 * Props for {@link AiroWordmark}.
 */
export interface AiroWordmarkProps {
  /** Accessible label for the wordmark image. */
  ariaLabel: string;
}

/**
 * Inline Airo wordmark — the canonical brand SVG shared by every Airo
 * surface (e.g. `PanelChrome` chat headers, `BuilderHeader` brand cluster).
 * Lives at `src/surfaces/airo-wordmark.tsx` rather than inside
 * `panel-chrome/AiroHeader.tsx` so cross-surface consumers can import the
 * primitive without dragging in `AiroHeader`'s top-level
 * `AiroHeader.Sections = AiroHeaderSections` compound-attachment side
 * effect (and the full header implementation graph that comes with it).
 *
 * `useId()` keeps the gradient id unique across multiple instances on a
 * page (e.g. every surface story on the autodocs page) so the
 * `<linearGradient>` references never collide.
 *
 * The radial-gradient stops (`#B688F7`, `#946CEE`, `#5034DC`) are the
 * Airo brand identity — they have no equivalent intent token and are
 * deliberately exempt from the "no hardcoded colors" rule the way shadow
 * geometry is in the root `AGENTS.md`. Keep them in this single place
 * so any future brand-asset update only touches one file.
 */
export function AiroWordmark({ ariaLabel }: AiroWordmarkProps): JSX.Element {
  const gradientId = `airo-surfaces-airo-wordmark-${useId()}`;
  return (
    <svg width="53" height="24" viewBox="0 0 53 24" fill="none" role="img" aria-label={ariaLabel}>
      <path
        d="M25.8766 2.23446C25.0487 1.79941 24.3693 1.12431 23.9314 0.301708C23.882 0.209164 23.809 0.133347 23.7226 0.0816989C23.6362 0.0292239 23.5356 0 23.4307 0C23.2202 0 23.0289 0.116713 22.9308 0.301708C22.4929 1.12431 21.8127 1.79941 20.9848 2.23446C20.7994 2.33197 20.682 2.52284 20.682 2.73118C20.682 2.93952 20.7994 3.13122 20.9848 3.22873C21.8127 3.66378 22.4929 4.33888 22.9308 5.16148C22.9803 5.25402 23.0524 5.32901 23.1388 5.38149C23.2252 5.43396 23.3258 5.46319 23.4307 5.46319C23.6412 5.46319 23.8325 5.34647 23.9314 5.16148C24.3693 4.33888 25.0487 3.66378 25.8766 3.22873C26.0628 3.13122 26.1803 2.94035 26.1803 2.73201C26.1803 2.52367 26.0628 2.33197 25.8766 2.23446ZM50.2751 10.9115C49.6719 9.79885 48.8222 8.91119 47.7251 8.24942C46.628 7.59012 45.3479 7.26011 43.8859 7.26011C42.423 7.26011 41.143 7.59012 40.0459 8.24942C38.9487 8.91119 38.099 9.79876 37.4959 10.9115C36.8927 12.025 36.5908 13.2618 36.5908 14.6212C36.5908 15.9806 36.8927 17.2157 37.4959 18.3301C38.099 19.4436 38.9487 20.3313 40.0459 20.9914C41.143 21.6523 42.4231 21.9823 43.8859 21.9823C45.3479 21.9823 46.628 21.6523 47.7251 20.9914C48.8222 20.3313 49.6719 19.4437 50.2751 18.3301C50.8782 17.2158 51.1802 15.9806 51.1802 14.6212C51.1802 13.2618 50.8782 12.025 50.2751 10.9115ZM47.1094 16.7615C46.8686 17.4182 46.4836 17.9441 45.956 18.3392C45.4284 18.7327 44.7373 18.9301 43.8858 18.9301C43.0336 18.9301 42.3424 18.7327 41.8147 18.3392C41.2871 17.9441 40.9021 17.4183 40.6614 16.7615C40.4206 16.1048 40.3007 15.3913 40.3007 14.6212C40.3007 13.8519 40.4206 13.1377 40.6614 12.4792C40.9021 11.8225 41.2872 11.2965 41.8147 10.9031C42.3423 10.508 43.0335 10.3122 43.8858 10.3122C44.7372 10.3122 45.4284 10.508 45.956 10.9031C46.4836 11.2965 46.8686 11.8224 47.1094 12.4792C47.3501 13.1377 47.4701 13.8519 47.4701 14.6212C47.4701 15.3913 47.3501 16.1048 47.1094 16.7615ZM35.8374 7.3226C35.5774 7.28005 35.2503 7.26177 34.8677 7.26177C33.9686 7.26177 33.1642 7.54344 32.4495 8.1169C31.8346 8.60617 31.3473 9.2787 30.9875 10.1246V7.54675H27.5433V21.6938H30.9597V15.8596C30.9597 14.8627 31.125 13.9743 31.4512 13.1992C31.7775 12.4232 32.2414 11.8073 32.842 11.3606C33.4384 10.9097 34.1438 10.6839 34.9525 10.6839C35.3308 10.6839 35.6336 10.7072 35.8702 10.7639C36.1067 10.8155 36.3105 10.8764 36.4716 10.9423V7.46349C36.3106 7.41184 36.0974 7.37012 35.8374 7.3226ZM21.6145 7.54684L15.2706 11.7708L10.9004 0.863402H8.18681L0.161926 20.9221C-0.427796 22.3981 0.666094 24 2.26397 24C2.48789 24 2.71024 23.9666 2.92241 23.9025C3.13468 23.8383 3.3376 23.7433 3.52388 23.6191L13.4789 16.984L15.1993 21.6939H19.2474L16.5414 14.942L21.6145 11.5608V21.6939H25.1459V7.54684H21.6145ZM4.90458 18.6735L9.50628 6.11504L12.297 13.7511L4.90458 18.6735Z"
        fill={`url(#${gradientId})`}
      />
      <defs>
        <radialGradient
          id={gradientId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(27.2387 2.60959) scale(39.9095 39.6546)"
        >
          <stop offset="0.0132" stopColor="#B688F7" />
          <stop offset="0.3557" stopColor="#946CEE" />
          <stop offset="1" stopColor="#5034DC" />
        </radialGradient>
      </defs>
    </svg>
  );
}
