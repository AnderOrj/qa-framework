import { chromium } from 'playwright';
import { SESSION_FILE, TIMEOUTS } from './scraper-config.js';
import { logInfo, logError } from './logger.js';

export async function autoLogin(): Promise<boolean> {
  const email    = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;

  if (!email || !password) {
    logInfo('Auto-login: LINKEDIN_EMAIL/LINKEDIN_PASSWORD no configurados en .env');
    return false;
  }

  logInfo('Auto-login: intentando renovar sesión LinkedIn...');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    (window as unknown as Record<string, unknown>)['chrome'] = { runtime: {} };
  });

  try {
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#username', { timeout: TIMEOUTS.jobCard });

    await page.fill('#username', email);
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    await page.fill('#password', password);
    await new Promise(r => setTimeout(r, 600 + Math.random() * 500));

    await page.click('[data-litms-control-urn="login-submit"], button[type="submit"]');

    const result = await Promise.race([
      page.waitForURL('**/feed**',         { timeout: 30_000 }).then(() => 'feed'),
      page.waitForURL('**/checkpoint/**',  { timeout: 30_000 }).then(() => 'challenge'),
      page.waitForURL('**/challenge/**',   { timeout: 30_000 }).then(() => 'challenge'),
      page.waitForURL('**/login**',        { timeout: 30_000 }).then(() => 'login_failed'),
    ]).catch(() => 'timeout');

    if (result === 'feed') {
      await context.storageState({ path: SESSION_FILE });
      logInfo('Auto-login: sesión renovada exitosamente ✓');
      return true;
    }

    logInfo(`Auto-login: fallo — resultado: ${result}. Requiere intervención manual.`);
    return false;
  } catch (error) {
    logError('Auto-login', error);
    return false;
  } finally {
    await browser.close();
  }
}
