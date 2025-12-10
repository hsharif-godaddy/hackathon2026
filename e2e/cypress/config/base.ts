export const baseConfig = {
    chromeWebSecurity: false,
    defaultCommandTimeout: 30000,
    excludeSpecPattern: '**/node_modules/**',
    pageLoadTimeout: 150000,
    reporter: 'cypress-multi-reporters',
    reporterOptions: { configFile: 'reporter.json' },
    screenshotsFolder: 'test-results/screenshots',
    specPattern: 'cypress/tests/**/*.cy.ts',
    trashAssetsBeforeRuns: true,
    video: true,
    videosFolder: 'test-results/videos',
    viewportWidth: 1920,
    viewportHeight: 1360,
    videoCompression: 28,
    watchForFileChanges: false,
    hideXhr: true, // to avoid logging too many unnecessary xhr requests to the console
};