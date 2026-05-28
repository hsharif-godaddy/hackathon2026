/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');
const tailwindIntentsPlugin = require('@ux/tailwind-intents/plugin');

module.exports = {
  important: true,
  prefix: 'gdai-cmp-',
  content: ['./src/**/*.{js,jsx,ts,tsx}', './.storybook/**/*.{js,jsx,ts,tsx}'],
  plugins: [tailwindIntentsPlugin()],
  theme: {
    extend: {
      spacing: defaultTheme.spacing,
      borderRadius: defaultTheme.borderRadius,
      borderWidth: defaultTheme.borderWidth,
    },
  },
};
