import postcssIntents from '@ux/postcss-intents';

const config = {
  plugins: [
    "@tailwindcss/postcss",
    postcssIntents(), // looks like it's not doing much
  ],
};

export default config;
