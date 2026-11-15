import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';

const require = createRequire(import.meta.url);

export async function unpackedFixture(handler, extensionPath = resolve('extension')) {
  const { chromium } = require(process.env.F4F_PLAYWRIGHT_PATH || 'playwright');
  const channel = process.env.F4F_BROWSER_CHANNEL || 'msedge';
  const profile = mkdtempSync(join(tmpdir(), 'f4f-extension-test-'));
  const key = join(profile, 'fixture-key.pem');
  const cert = join(profile, 'fixture-cert.pem');
  const openssl = process.env.F4F_OPENSSL_PATH || (process.platform === 'win32' ?
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'mingw64', 'bin', 'openssl.exe') : 'openssl');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=www.instagram.com'], { stdio: 'ignore' });
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, handler);
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  let context;
  try {
    const port = server.address().port;
    const extensionArgs = channel === 'chrome' ? ['--enable-unsafe-extension-debugging'] :
      [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`];
    context = await chromium.launchPersistentContext(profile, {
      channel, headless: true,
      ignoreDefaultArgs: ['--disable-extensions'], ignoreHTTPSErrors: true,
      args: [...extensionArgs, '--disable-gpu', '--ignore-certificate-errors', '--no-proxy-server',
        `--host-resolver-rules=MAP www.instagram.com 127.0.0.1:${port}, MAP instagram.com 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1`]
    });
    if (channel === 'chrome') {
      const session = await context.browser().newBrowserCDPSession();
      await session.send('Extensions.loadUnpacked', { path: extensionPath });
      await session.detach();
    }
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    return { context, worker, extensionId: new URL(worker.url()).host, async close() {
      try { await context.close(); } finally { server.close(); }
    } };
  } catch (error) {
    await context?.close();
    server.close();
    throw error;
  }
}
