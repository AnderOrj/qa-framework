import { chromium } from 'playwright';
import { SESSION_FILE } from './utils/scraper-config.js';

async function saveLinkedInSession() {
  console.log('\n📋 LinkedIn Session Login');
  console.log('='.repeat(50));
  console.log('1. Se abrirá un navegador con LinkedIn');
  console.log('2. Inicia sesión manualmente');
  console.log('3. Cuando veas tu feed, cierra el navegador');
  console.log('='.repeat(50) + '\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
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

  await page.goto('https://www.linkedin.com/login');

  console.log('⏳ Esperando que inicies sesión en LinkedIn...');
  await page.waitForURL('**/feed**', { timeout: 120000 });

  console.log('✓ Sesión detectada. Guardando...');
  await context.storageState({ path: SESSION_FILE });
  await browser.close();

  console.log(`✓ Sesión guardada en: ${SESSION_FILE}`);
  console.log('  Ya puedes correr el scraper normalmente.\n');
}

saveLinkedInSession().catch(console.error);
