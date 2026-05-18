const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js',
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'npx http-server -p 8765 -c-1 -s',
    port: 8765,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://localhost:8765',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
});
