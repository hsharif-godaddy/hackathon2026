module.exports = {
  plugins: [
    require('@ux/postcss-intents')(),
    require('tailwindcss')(),
    // Pin an explicit browserslist query so autoprefixer never does per-file
    // config discovery. Without this, transforming an `@ux/*` dependency's CSS
    // (e.g. `@ux/growl/styles`, imported by several stories) makes browserslist
    // walk up into that package's own `package.json`, find
    // `"browserslist": ["extends @godaddy/browserslist-config"]`, and throw
    // because `@godaddy/browserslist-config` is a GoDaddy-internal package that
    // isn't installed here — failing the CSS transform and breaking the story.
    // `['defaults']` matches what autoprefixer already targets for this
    // package's own CSS (it has no browserslist config), so build output is
    // unchanged; it just stops autoprefixer from descending into node_modules.
    require('autoprefixer')({ overrideBrowserslist: ['defaults'] }),
  ],
};
