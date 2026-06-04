import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import { SESSION_FILE, TIMEOUTS } from './scraper-config.js';
import { logInfo } from './logger.js';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function createPage(timeout = TIMEOUTS.page): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const hasSession = fs.existsSync(SESSION_FILE);
  const context = hasSession
    ? await browser.newContext({ storageState: SESSION_FILE })
    : await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  if (hasSession) logInfo('Sesión LinkedIn cargada desde linkedin-session.json');

  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

export async function validateSession(page: Page): Promise<boolean> {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'load' });
  const url = page.url();
  return !url.includes('/login') && !url.includes('/authwall');
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(r => setTimeout(r, ms));
}
