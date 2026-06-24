import type { Preview } from '@storybook/react-vite';
import { INITIAL_VIEWPORTS } from 'storybook/viewport';

import './preview.css';

// Theme injection is handled by the @ux/storybook-theming addon, which fetches
// CSS from the GoDaddy Theme API and injects it at runtime. The toolbar
// switcher persists the chosen alias to localStorage.

const preview: Preview = {
  parameters: {
    options: {
      storySort: {
        order: ['Usage Examples', ['Venture Home', 'Builder'], '*'],
      },
    },
    // Apply body-level theme tokens to Docs canvas blocks so dark themes render
    // correctly outside the iframe.
    inlineBodySelectors: '.docs-story',
    // Device presets for the built-in viewport toolbar. Resizing the toolbar
    // resizes the story *iframe*, which is what `matchMedia` evaluates against —
    // so viewport-driven components (e.g. ResponsiveMenu's desktop↔mobile swap)
    // respond to it. (Chrome DevTools device mode resizes the top-level page,
    // not the iframe, so it does not trip iframe media queries.)
    viewport: { options: INITIAL_VIEWPORTS },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      config: {
        rules: [
          {
            id: 'color-contrast',
            enabled: true,
          },
        ],
      },
    },
  },

  tags: ['autodocs'],
};

export default preview;
