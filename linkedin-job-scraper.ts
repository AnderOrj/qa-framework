import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import twilio from 'twilio';
import cron from 'node-cron';

const LOG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scraper.log');

function logError(context: string, error: unknown) {
  const ts = new Date().toLocaleString('es-CO');
  const err = error as Record<string, unknown>;
  const code = err?.code ?? err?.status ?? 'N/A';
  const msg = error instanceof Error ? error.message : String(error);
  const line = `[${ts}] ✗ ${context} | code=${code} | ${msg}\n`;

  console.error(line.trim());
  fs.appendFileSync(LOG_FILE, line);

  // Twilio sandbox session expired codes
  if (code === 63016 || code === 21408 || String(msg).includes('opt in')) {
    const hint = `[${ts}] ⚠️  ACCIÓN REQUERIDA: sesión sandbox expirada. Envía "join <palabra>" al +14155238886 desde WhatsApp para reactivar.\n`;
    console.error(hint.trim());
    fs.appendFileSync(LOG_FILE, hint);
  }
}

function logInfo(msg: string) {
  const ts = new Date().toLocaleString('es-CO');
  const line = `[${ts}] ✓ ${msg}\n`;
  console.log(line.trim());
  fs.appendFileSync(LOG_FILE, line);
}

// Load environment variables
dotenv.config();

interface Job {
  title: string;
  company: string;
  location: string;
  link: string;
  datePosted?: string;
  description?: string;
  sourceLocation?: string;
  savedAt?: string;
  score?: number;
}

const SESSION_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'linkedin-session.json');

class LinkedInJobScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private jobsFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'jobs.json');
  private hasDebugged = false;

  async init() {
    this.browser = await chromium.launch({ headless: true });
    const hasSession = fs.existsSync(SESSION_FILE);
    this.context = hasSession
      ? await this.browser.newContext({ storageState: SESSION_FILE })
      : await this.browser.newContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(60000);
    if (hasSession) logInfo('Sesión LinkedIn cargada desde linkedin-session.json');
  }

  async debugPage(label: string) {
    if (!this.page) return;
    const url = this.page.url();
    const title = await this.page.title();
    const screenshotPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'debug-screenshot.png');
    await this.page.screenshot({ path: screenshotPath, fullPage: false });
    logInfo(`DEBUG [${label}] URL: ${url} | Title: ${title} | Screenshot: ${screenshotPath}`);
    const counts = await this.page.evaluate(() => ({
      jobSearchCard: document.querySelectorAll('.job-search-card').length,
      jobCardContainer: document.querySelectorAll('.job-card-container').length,
      dataJobId: document.querySelectorAll('[data-job-id]').length,
      scaffoldListItem: document.querySelectorAll('.scaffold-layout__list-container li').length,
      jobsResultsItem: document.querySelectorAll('.jobs-search-results__list-item').length,
    }));
    logInfo(`DEBUG selectors: ${JSON.stringify(counts)}`);
  }

  async searchJobs(keyword: string, location: string = '') {
    if (!this.page) throw new Error('Browser not initialized');

    // Filter: last 5 days (f_TPR=r432000), all work types: on-site, hybrid, remote (f_WT=1,2,3)
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&f_TPR=r432000&f_WT=1%2C2%2C3`;
    await this.page.goto(searchUrl);
    await randomDelay(2500, 4500);

    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await randomDelay(1500, 3000);

    if (!this.hasDebugged) {
      this.hasDebugged = true;
      await this.debugPage(`${keyword} / ${location}`);
    }

    const jobs = await this.page.$$eval('.job-search-card, .job-card-container, [data-job-id]', (cards) => {
      return cards.slice(0, 20).map((card) => {
        // Extract title from the main link
        const titleLink = card.querySelector('a[href*="/jobs/view/"]');
        const title = titleLink?.textContent?.trim() || '';

        // Get card text for fallback parsing
        const cardText = (card as HTMLElement).innerText || '';
        const lines = cardText.split('\n').filter((line: string) => line.trim());

        // Extract company from URL — most reliable source: ".../job-title-at-company-name-123456"
        let company = '';
        const rawLinkForCompany = (card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement)?.href || '';
        if (rawLinkForCompany) {
          const urlMatch = rawLinkForCompany.match(/\/jobs\/view\/.+-at-(.+?)-\d+(?:\?|$)/);
          if (urlMatch?.[1]) {
            const fromUrl = urlMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            company = fromUrl;
          }
        }

        // Extract location
        let location = '';
        const locationSelectors = [
          '.job-card-container__location',
          '[data-test-id="job-card-location"]',
          '.job-card-container__metadata-item'
        ];
        
        for (const selector of locationSelectors) {
          const locationEl = card.querySelector(selector);
          if (locationEl?.textContent?.trim()) {
            location = locationEl.textContent.trim();
            break;
          }
        }

        // Fallback to text parsing for location
        if (!location) {
          const cardText = (card as HTMLElement).innerText || '';
          location = cardText.match(/(?:Bogotá|Medellín|Cali|Barranquilla|Colombia|Remote)/)?.[0] || '';
        }

        // Extract link — strip tracking query params so dedup works across runs
        const rawLink = (titleLink as HTMLAnchorElement)?.href || '';
        const link = rawLink ? (rawLink.split('?')[0] ?? '') : '';

        // Extract description - look for job snippet
        let description = '';
        const descSelectors = [
          '.job-card-container__job-snippet',
          '[data-test-id="job-snippet"]',
          '.job-card-container__description'
        ];
        
        for (const selector of descSelectors) {
          const descEl = card.querySelector(selector);
          if (descEl?.textContent?.trim()) {
            description = descEl.textContent.trim();
            break;
          }
        }

        // Extract date posted
        let datePosted = '';
        const timeEl = card.querySelector('time');
        if (timeEl) {
          datePosted = timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || '';
        }

        return { title: title || lines[0] || '', company: company || lines[1] || '', location, link, description, datePosted };
      });
    });

    const QA_KEYWORDS = [
      // English
      'qa', 'quality assurance', 'quality engineer', 'test', 'testing',
      'automation', 'tester', 'sdet',
      // Spanish
      'automatización', 'automatizacion', 'pruebas', 'calidad de software',
      'control de calidad', 'analista qa', 'ingeniero qa'
    ];

    const jobsWithSource = jobs
      .map(job => ({ ...job, sourceLocation: location }))
      .filter(job => {
        const title = job.title.toLowerCase();
        return QA_KEYWORDS.some(kw => title.includes(kw));
      });

    console.log(`✅ Extracted ${jobsWithSource.length} relevant jobs from "${keyword}" (filtered from ${jobs.length})`);

    return jobsWithSource;
  }

  async getNewJobs(jobs: Job[]): Promise<Job[]> {
    const existingJobs = this.loadExistingJobs();
    const existingLinks = new Set(existingJobs.map(job => job.link));

    return jobs.filter(job => !existingLinks.has(job.link));
  }

  loadExistingJobs(): Job[] {
    if (!fs.existsSync(this.jobsFile)) return [];
    try {
      const data = fs.readFileSync(this.jobsFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private pruneOldJobs(jobs: Job[]): Job[] {
    const cutoff = Date.now() - 20 * 24 * 60 * 60 * 1000;
    const before = jobs.length;
    const pruned = jobs.filter(job => {
      if (!job.savedAt) return true; // keep jobs without timestamp (legacy)
      return new Date(job.savedAt).getTime() >= cutoff;
    });
    if (pruned.length < before) {
      logInfo(`Purga jobs.json: eliminadas ${before - pruned.length} ofertas con más de 20 días (quedan ${pruned.length})`);
    }
    return pruned;
  }

  saveJobs(jobs: Job[]) {
    const now = new Date().toISOString();
    const jobsWithTimestamp = jobs.map(job => ({ ...job, savedAt: job.savedAt ?? now }));
    const existingJobs = this.loadExistingJobs();
    const allJobs = this.pruneOldJobs([...existingJobs, ...jobsWithTimestamp]);
    fs.writeFileSync(this.jobsFile, JSON.stringify(allJobs, null, 2));
  }

  private formatWhatsAppMessages(newJobs: Job[], label: string): string[] {
    if (newJobs.length === 0) return [];

    const timestamp = new Date().toLocaleString('es-CO');
    const total = newJobs.length;
    const totalBlocks = Math.ceil(total / 10);
    const messages: string[] = [];

    for (let i = 0; i < total; i += 10) {
      const block = newJobs.slice(i, i + 10);
      const blockNum = Math.floor(i / 10) + 1;

      const summary = block.map((job, idx) => {
        const desc = job.description ? `\n📝 ${job.description.substring(0, 60)}...` : '';
        const date = job.datePosted ? `\n📅 ${job.datePosted}` : '';
        const source = job.sourceLocation ? ` · 🌎 ${job.sourceLocation}` : '';
        return `${i + idx + 1}. ${scoreStars(job.score ?? 0)} *${job.title}*\n🏢 ${job.company}\n📍 ${job.location}${source}${date}${desc}\n🔗 ${job.link}`;
      }).join('\n\n');

      const blockLabel = totalBlocks > 1 ? ` [${blockNum}/${totalBlocks}]` : '';
      const header = `🚀 *${label}* (${total} encontradas - últimos 5 días)${blockLabel}\n_${timestamp}_`;

      let msg = `${header}\n\n${summary}`;
      if (msg.length > 1500) msg = msg.substring(0, 1497) + '...'
      messages.push(msg);
    }

    return messages;
  }

  async notifyNewJobs(newJobs: Job[], label: string) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_WHATSAPP_FROM;
    const toNumbers = (process.env.WHATSAPP_TO || '').split(',').map(n => n.trim()).filter(Boolean);

    if (newJobs.length === 0) {
      console.log(`[${new Date().toLocaleTimeString()}] No new jobs found.`);
      return;
    }

    console.log(`[${new Date().toLocaleTimeString()}] Sending ${newJobs.length} jobs — ${label}`);

    newJobs.forEach(job => {
      console.log(`✓ ${job.title} at ${job.company} (${job.location})`);
    });

    if (accountSid && authToken && fromNumber && toNumbers.length > 0) {
      const client = twilio(accountSid, authToken);
      const messages = this.formatWhatsAppMessages(newJobs, label);

      for (const toNumber of toNumbers) {
        for (const message of messages) {
          try {
            const result = await client.messages.create({ body: message, from: fromNumber, to: toNumber });
            logInfo(`WhatsApp enviado a ${toNumber}. SID: ${result.sid}`);
            if (messages.length > 1) await new Promise(r => setTimeout(r, 1500));
          } catch (error) {
            logError(`WhatsApp nuevas ofertas → ${toNumber}`, error);
          }
        }
      }
    } else {
      console.log('⚠️ Twilio not configured.');
    }
  }

  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(r => setTimeout(r, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 3,
  baseDelayMs = 2000
): Promise<T | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === retries;
      const delayMs = baseDelayMs * 2 ** (attempt - 1); // 2s, 4s, 8s
      logError(`${label} — intento ${attempt}/${retries}${isLast ? ' (definitivo)' : `, reintentando en ${delayMs / 1000}s`}`, error);
      if (isLast) return null;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

function rotateLogIfNeeded() {
  if (!fs.existsSync(LOG_FILE)) return;
  const { size, birthtimeMs } = fs.statSync(LOG_FILE);
  const ageMs = Date.now() - birthtimeMs;
  const tooBig = size > 5 * 1024 * 1024;           // 5 MB
  const tooOld = ageMs > 7 * 24 * 60 * 60 * 1000;  // 7 days
  if (tooBig || tooOld) {
    const reason = tooBig ? `${(size / 1024 / 1024).toFixed(1)} MB` : 'más de 7 días';
    const backup = LOG_FILE.replace('.log', '.log.bak');
    fs.renameSync(LOG_FILE, backup);
    logInfo(`Log rotado (${reason}) → scraper.log.bak`);
  }
}

function scoreJob(job: Job): number {
  let score = 0;
  const title = job.title.toLowerCase();
  const loc = (job.location + ' ' + (job.sourceLocation ?? '')).toLowerCase();

  // Seniority
  if (/\bsenior\b|\bsr\.?\b|\blead\b|\bstaff\b|\bprincipal\b/.test(title)) score += 30;
  else if (/\bmid\b|\bssr\b|\bsemi/.test(title)) score += 15;
  else if (/\bjunior\b|\bjr\.?\b|\bentry\b/.test(title)) score -= 10;

  // Work mode
  if (/remot[eo]/.test(title + ' ' + loc)) score += 20;
  else if (/h[íi]brid/.test(title + ' ' + loc)) score += 10;

  // High-value tech keywords
  if (/playwright/.test(title)) score += 15;
  if (/\bcypress\b/.test(title)) score += 10;
  if (/\bselenium\b/.test(title)) score += 10;
  if (/\bsdet\b/.test(title)) score += 10;
  if (/\bapi\b|\brest\b/.test(title)) score += 8;
  if (/automat/.test(title)) score += 8;
  if (/\bai\b|artificial intelligence|inteligencia artificial/.test(title)) score += 5;

  return score;
}

function scoreStars(score: number): string {
  if (score >= 55) return '⭐⭐⭐';
  if (score >= 30) return '⭐⭐';
  return '⭐';
}

// Scheduler function
async function runJobSearch() {
  rotateLogIfNeeded();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString()}] Starting LinkedIn job search...`);
  console.log(`${'='.repeat(60)}`);

  const scraper = new LinkedInJobScraper();
  await scraper.init();

  try {
    const keywords = (process.env.SEARCH_KEYWORDS || '')
      .split(',').map(k => k.trim()).filter(Boolean);
    const locations = (process.env.SEARCH_LOCATIONS || '')
      .split(',').map(l => l.trim()).filter(Boolean);

    let allJobs: Job[] = [];
    let allNewJobs: Job[] = [];
    const isFirstRun = !fs.existsSync(scraper['jobsFile']) || scraper.loadExistingJobs().length === 0;

    for (const location of locations) {
      console.log(`\n  📍 Location: ${location}`);
      for (const keyword of keywords) {
        console.log(`  🔍 Searching: ${keyword}`);
        const jobs = await withRetry(
          () => scraper.searchJobs(keyword, location),
          `searchJobs("${keyword}", "${location}")`
        ) ?? [];
        allJobs = allJobs.concat(jobs);
        const newJobs = await scraper.getNewJobs(jobs);
        allNewJobs = allNewJobs.concat(newJobs);
        await randomDelay(1000, 2500);
      }
    }

    // Remove duplicates
    const uniqueJobs = allNewJobs.filter((job, index, self) =>
      index === self.findIndex(j => j.link === job.link)
    );

    const uniqueAllJobs = allJobs.filter((job, index, self) =>
      index === self.findIndex(j => j.link === job.link)
    );

    const jobsToProcess = (isFirstRun ? uniqueAllJobs : uniqueJobs)
      .map(job => ({ ...job, score: scoreJob(job) }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    scraper.saveJobs(jobsToProcess);
    if (isFirstRun) {
      await scraper.notifyNewJobs(jobsToProcess, 'PRIMERA EJECUCIÓN - TODAS LAS OFERTAS');
    } else if (jobsToProcess.length > 0) {
      await scraper.notifyNewJobs(jobsToProcess, 'Nuevas ofertas QA');
    }

    console.log(`\n✓ Job search completed. ${jobsToProcess.length} jobs ${isFirstRun ? 'found and saved (first run)' : 'new jobs found and saved'}.`);
  } catch (error) {
    console.error('✗ Error during job search:', error);
  } finally {
    await scraper.close();
  }
}

async function runDailySummary() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString()}] Daily summary — sending consolidated jobs...`);
  console.log(`${'='.repeat(60)}`);

  const scraper = new LinkedInJobScraper();
  const todayStr = new Date().toLocaleDateString('es-CO');

  const todaysJobs = scraper.loadExistingJobs()
    .filter(job => {
      if (!job.savedAt) return false;
      return new Date(job.savedAt).toLocaleDateString('es-CO') === todayStr;
    })
    .map(job => ({ ...job, score: job.score ?? scoreJob(job) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  console.log(`  📋 Jobs found today: ${todaysJobs.length}`);
  await scraper.notifyNewJobs(todaysJobs, 'RESUMEN DIARIO · ÚLTIMO MENSAJE CONSOLIDADO');
}

let isSearchRunning = false;

function startScheduler() {
  const schedule = process.env.CRON_SCHEDULE || '0 7-19 * * *';
  console.log('\n📅 Job scraper scheduler started.');
  console.log(`   Scraping:  ${schedule}`);
  console.log(`   Summary:   0 20 * * * (8:00 pm)\n`);

  cron.schedule(schedule, () => {
    if (isSearchRunning) {
      console.log(`[${new Date().toLocaleTimeString()}] Skipping — previous search still running.`);
      return;
    }
    isSearchRunning = true;
    runJobSearch().catch(console.error).finally(() => { isSearchRunning = false; });
  });

  cron.schedule('0 20 * * *', () => {
    runDailySummary().catch(console.error);
  });

  // Keep the process running
  setInterval(() => {}, 1000);
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--once')) {
    await runJobSearch();
  } else if (args.includes('--summary')) {
    await runDailySummary();
  } else {
    startScheduler();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { runJobSearch };