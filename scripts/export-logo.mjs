import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: process.env.F4F_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const svg = readFileSync('extension/icons/logo.svg', 'utf8');
  for (const size of [16, 32, 48, 128, 512, 1024]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({ path: `extension/icons/${size > 128 ? `logo-${size}` : `icon-${size}`}.png`, omitBackground: true });
  }
  const light = readFileSync('extension/icons/logo-light.svg', 'utf8');
  await page.setViewportSize({ width: 128, height: 128 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${light}`);
  await page.screenshot({ path: 'extension/icons/logo-light-128.png', omitBackground: true });
  console.log('Exported extension icons and 512/1024px logos.');
} finally { await browser.close(); }
