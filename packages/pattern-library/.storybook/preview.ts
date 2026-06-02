import type { Preview } from '@storybook/react-vite';

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
