const { test, expect } = require('@playwright/test');

test('canvas renders a non-black trace after Start with synthetic audio', async ({ page }) => {
  // The try/catch wrapper around frameBody is already in the working tree
  // (the previous bisection added it as a diagnostic instrument). It
  // surfaces silent throws via #status. This canary reads #status before
  // taking the screenshot and fails loudly if a render exception was
  // caught.
  //
  // CAVEAT: this canary runs in headless Chromium with ANGLE-on-SwiftShader,
  // a CPU-based GL rasterizer. It does NOT exercise the same shader path
  // as Android WebView running on the device's GLES driver. A PASS here
  // does not prove the visualisation works on Android; manual APK install
  // covers that.

  // Stub getDisplayMedia with a 440 Hz OscillatorNode piped into a
  // MediaStreamAudioDestinationNode, plus a 1x1 white video track
  // (Chromium requires at least one video track on a display capture).
  // The 30 FPS captureStream rate is arbitrary; the consumer in main.js
  // only reads the audio track and ignores video.
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, 1, 1);
      const videoTrack = c.captureStream(30).getVideoTracks()[0];
      return new MediaStream([
        dest.stream.getAudioTracks()[0],
        videoTrack,
      ]);
    };
  });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[browser error]', msg.text());
  });

  await page.goto('/');
  await page.click('#capture');

  // Ready check: main.js:223 sets document.getElementById("controls").hidden
  // = false after audio capture succeeds. Waiting for this is the proxy
  // for "the app is running" without exposing module-scoped state on window.
  await page.waitForSelector('#controls:not([hidden])', { timeout: 5000 });

  // Then give the rAF loop ~30 ticks at 60 FPS to fill the trail.
  await page.waitForTimeout(500);

  const status = (await page.locator('#status').textContent()) || '';
  if (status.includes('Render error')) {
    throw new Error(`render exception surfaced: ${status}`);
  }

  // Screenshot the canvas and count pixels brighter than near-black.
  const png = await page.locator('#stage').screenshot();
  const nonBlackPixels = await page.evaluate(async (pngBytes) => {
    const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const oc = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = oc.getContext('2d');
    cx.drawImage(bmp, 0, 0);
    const data = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 24) n++;
    }
    return n;
  }, Array.from(png));

  expect(nonBlackPixels).toBeGreaterThan(500);
});
