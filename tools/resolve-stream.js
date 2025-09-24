// tools/resolve-stream.js
const { chromium } = require('playwright');
const fs = require('fs');

const TARGET = process.env.CASTER_WIDGET_URL ||
  'https://widgets.cloud.caster.fm/player/?token=41a9830e-3fa4-4aef-a0cb-226600fb2946&frameId=2x5fz&theme=dark&color=6C2BDD';
const MATCH_PREFIX = process.env.STREAM_MATCH_PREFIX ||
  'https://sapircast.caster.fm:10445/VCDm1?token=';
const PRE_CLICK_WAIT_MS = parseInt(process.env.PRE_CLICK_WAIT_MS || '2000', 10);
const MATCH_TIMEOUT_MS  = parseInt(process.env.MATCH_TIMEOUT_MS  || '30000', 10);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  let matchedViaRequest = null;
  context.on('request', (req) => {
    const u = req.url();
    if (!matchedViaRequest && u.startsWith(MATCH_PREFIX)) matchedViaRequest = u;
  });

  await page.goto(TARGET, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(PRE_CLICK_WAIT_MS);

  // Try to click "Play"
  const selectors = [
    '.play button.control-btn',
    'button:has-text("PLAY")',
    '[onclick*="playerAction"]',
  ];
  let clicked = false;
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      await loc.click({ force: true });
      clicked = true; break;
    } catch {}
  }
  if (!clicked) {
    for (const frame of page.frames()) {
      try {
        const loc = frame.locator('.play button.control-btn, button:has-text("PLAY"), [onclick*="playerAction"]').first();
        await loc.waitFor({ state: 'visible', timeout: 2000 });
        await loc.click({ force: true });
        clicked = true; break;
      } catch {}
    }
  }

  // Directly from audio element
  let audioSrc = null;
  try {
    audioSrc = await page.waitForFunction(
      (prefix) => {
        const a = document.getElementById('playerAudioElement');
        return a && typeof a.src === 'string' && a.src.startsWith(prefix) ? a.src : null;
      },
      MATCH_PREFIX,
      { timeout: MATCH_TIMEOUT_MS }
    ).then(h => h);
  } catch {}

  let finalUrl = matchedViaRequest || audioSrc;

  // Fallback: compute from widget config
  if (!finalUrl) {
    try {
      finalUrl = await page.evaluate(() => {
        try {
          const cfg = window.casterfmCloud;
          const domain = cfg.account.streaming_server.domain;
          const port   = cfg.account.streaming_server_port;
          const mount  = cfg.account.channels[0].streaming_server_mountpoint;
          const token  = cfg.streamToken;
          return `https://${domain}:${port}/${mount}?token=${token}`;
        } catch { return null; }
      });
    } catch {}
  }

  await context.close();
  await browser.close();

  if (!finalUrl) {
    console.error('Could not resolve stream URL.');
    process.exit(1);
  }

  const out = { url: finalUrl, resolvedAt: new Date().toISOString() };
  fs.writeFileSync('stream.json', JSON.stringify(out, null, 2));
  console.log('Wrote stream.json:', out);
})();
