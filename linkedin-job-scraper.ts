import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as dotenv from 'dotenv';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import { SESSION_FILE, JOBS_FILE, LOG_FILE, CV_PROFILE_FILE, TIMEOUTS, DELAYS, SELECTORS } from './utils/scraper-config.js';
import { logError, logInfo } from './utils/logger.js';
import { randomDelay } from './utils/browser.js';
import type { Job, CvProfile } from './utils/types.js';

// Load environment variables
dotenv.config();

class LinkedInJobScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private jobsFile = JOBS_FILE;
  private hasDebugged = false;

  async init() {
    this.browser = await chromium.launch({ headless: true });
    const hasSession = fs.existsSync(SESSION_FILE);
    this.context = hasSession
      ? await this.browser.newContext({ storageState: SESSION_FILE })
      : await this.browser.newContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(TIMEOUTS.page);
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

  async searchJobs(keyword: string, location: string = '', remoteOnly = false) {
    if (!this.page) throw new Error('Browser not initialized');

    // f_WT=2 → remote only; f_WT=1,2,3 → on-site + hybrid + remote
    const workTypes = remoteOnly ? '2' : '1%2C2%2C3';
    const maxPages = Number(process.env.MAX_PAGES_PER_SEARCH ?? 3);

    const QA_KEYWORDS = [
      // English
      'qa', 'quality assurance', 'quality engineer', 'test', 'testing',
      'automation', 'tester', 'sdet',
      // Spanish
      'automatización', 'automatizacion', 'pruebas', 'calidad de software',
      'control de calidad', 'analista qa', 'ingeniero qa'
    ];

    const allExtracted: Array<{ title: string; company: string; location: string; link: string; description: string; datePosted: string }> = [];

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      const start = pageIdx * 25;
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&f_TPR=r432000&f_WT=${workTypes}&start=${start}`;
      await this.page.goto(searchUrl);

      const currentUrl = this.page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
        throw new Error('SESSION_EXPIRED: LinkedIn redirigió al login — sesión expirada');
      }
      await randomDelay(DELAYS.page.min, DELAYS.page.max);

      // Dismiss login modal if present before scrolling
      await this.dismissModal();

      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await randomDelay(DELAYS.scroll.min, DELAYS.scroll.max);

      // Modal re-appears after scroll — dismiss again
      await this.dismissModal();

      if (!this.hasDebugged) {
        this.hasDebugged = true;
        await this.debugPage(`${keyword} / ${location}`);
      }

      // LinkedIn public view uses .job-search-card with base-search-card__* inner elements
      const pageJobs = await this.page.$$eval('.job-search-card', (cards) => {
        return cards.map((card) => {
          // Link: base-card__full-link wraps the entire card in public view
          const linkEl = (card.querySelector('a.base-card__full-link') as HTMLAnchorElement)
                      || (card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement);
          const rawLink = linkEl?.href || '';
          const link = rawLink.split('?')[0] ?? '';

          // Title
          const titleEl = card.querySelector('h3.base-search-card__title')
                       || card.querySelector('.base-search-card__title');
          const title = titleEl?.textContent?.trim() || '';

          // Company
          const companyEl = card.querySelector('h4.base-search-card__subtitle')
                         || card.querySelector('.base-search-card__subtitle');
          const company = companyEl?.textContent?.trim() || '';

          // Location
          const locationEl = card.querySelector('.job-search-card__location')
                          || card.querySelector('.job-card-container__location');
          const location = locationEl?.textContent?.trim() || '';

          // Date
          const timeEl = card.querySelector('time');
          const datePosted = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';

          return { title, company, location, link, description: '', datePosted };
        });
      });

      // Discard cards where the link could not be extracted — avoids false dedup on empty string
      const validOnPage = pageJobs.filter(j => j.link);

      // No results on this page means we've reached the end — stop paginating
      if (validOnPage.length === 0) break;

      allExtracted.push(...validOnPage);
      logInfo(`Página ${pageIdx + 1}/${maxPages}: ${validOnPage.length} cards para "${keyword}" en ${location || 'global'}`);

      // Pause between pages to avoid rate limiting
      if (pageIdx < maxPages - 1) await randomDelay(DELAYS.page.min, DELAYS.page.max);
    }

    const jobsWithSource = allExtracted
      .map(job => ({ ...job, sourceLocation: location }))
      .filter(job => {
        const title = job.title.toLowerCase();
        return QA_KEYWORDS.some(kw => title.includes(kw));
      });

    console.log(`✅ Extracted ${jobsWithSource.length} relevant jobs from "${keyword}" (filtered from ${allExtracted.length} total)`);

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
    const merged = [...existingJobs, ...jobsWithTimestamp];
    // Dedup by link — los existentes tienen prioridad (primer elemento gana)
    const seen = new Set<string>();
    const deduped = merged.filter(job => {
      if (seen.has(job.link)) return false;
      seen.add(job.link);
      return true;
    });
    const allJobs = this.pruneOldJobs(deduped);
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

    const whatsappEnabled = process.env.WHATSAPP_ENABLED !== 'false';
    if (whatsappEnabled && accountSid && authToken && fromNumber && toNumbers.length > 0) {
      const client = twilio(accountSid, authToken);
      const messages = this.formatWhatsAppMessages(newJobs, label);

      for (const toNumber of toNumbers) {
        for (const message of messages) {
          try {
            const result = await client.messages.create({ body: message, from: fromNumber, to: toNumber });
            logInfo(`WhatsApp enviado a ${toNumber}. SID: ${result.sid}`);
            if (messages.length > 1) await new Promise(r => setTimeout(r, DELAYS.whatsapp));
          } catch (error) {
            logError(`WhatsApp nuevas ofertas → ${toNumber}`, error);
          }
        }
      }
    } else if (!whatsappEnabled) {
      console.log('📵 WhatsApp desactivado (WHATSAPP_ENABLED=false) — solo correo.');
    } else {
      console.log('⚠️ Twilio not configured.');
    }

    await sendEmail(
      `🚀 ${label} (${newJobs.length} oferta${newJobs.length !== 1 ? 's' : ''})`,
      buildJobsEmailHtml(newJobs, label)
    );
  }

  markNotified(links: string[]) {
    const linkSet = new Set(links);
    const jobs = this.loadExistingJobs().map(job =>
      linkSet.has(job.link) ? { ...job, notifiedAt: new Date().toISOString() } : job
    );
    fs.writeFileSync(this.jobsFile, JSON.stringify(jobs, null, 2));
  }

  async dismissModal() {
    if (!this.page) return;
    try {
      for (const sel of SELECTORS.dismissModal) {
        const btn = await this.page.$(sel);
        if (btn) {
          await btn.click();
          await randomDelay(DELAYS.modal.min, DELAYS.modal.max);
          return;
        }
      }
      // Fallback: press Escape
      await this.page.keyboard.press('Escape');
      await randomDelay(DELAYS.modal.min, DELAYS.modal.max);
    } catch {
      // Modal not present — silently ignore
    }
  }

  async fetchJobDescriptions(jobs: Job[], maxJobs = 20): Promise<Job[]> {
    if (!this.page) return jobs;
    const toFetch = jobs.slice(0, maxJobs);
    const enriched: Job[] = [];

    for (const job of toFetch) {
      try {
        await this.page.goto(job.link, { timeout: TIMEOUTS.modal });
        await randomDelay(DELAYS.scroll.min, DELAYS.scroll.max);

        const description = await this.page.$$eval(
          [...SELECTORS.description].join(', '),
          (els) => els.map(el => el.textContent?.trim() ?? '').join(' ')
        ).catch(() => '');

        enriched.push({ ...job, description: description.substring(0, 2000) });
        logInfo(`Descripción obtenida: "${job.title}" (${description.length} chars)`);
      } catch {
        enriched.push(job);
      }
      await randomDelay(DELAYS.description.min, DELAYS.description.max);
    }

    // Jobs beyond maxJobs keep their empty description
    return [...enriched, ...jobs.slice(maxJobs)];
  }

  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }
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
      // Session expired: no point retrying, propagate immediately so the caller can alert and stop
      if (error instanceof Error && error.message.startsWith('SESSION_EXPIRED')) throw error;
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
  const desc = (job.description || '').toLowerCase();
  const loc = (job.location + ' ' + (job.sourceLocation ?? '')).toLowerCase();
  const all = title + ' ' + desc;
  const allLoc = all + ' ' + loc;

  // Seniority
  if (/\bsenior\b|\bsr\.?\b|\blead\b|\bstaff\b|\bprincipal\b/.test(title)) score += 35;
  else if (/\bmid\b|\bssr\b|\bsemi\b/.test(title)) score += 15;
  else if (/\bjunior\b|\bjr\.?\b|\bentry\b|\btrainee\b/.test(title)) score -= 25;

  // Modalidad — remote es prioridad máxima
  if (/remot[eo]/.test(allLoc)) score += 25;
  else if (/h[íi]brid/.test(allLoc)) score += 10;

  // Manual QA + STLC (core del perfil buscado)
  if (/\bmanual\b/.test(all)) score += 12;
  if (/\bstlc\b|software testing life cycle/.test(all)) score += 10;
  if (/test\s+(plan|case|suite|strateg)|traceabilit|casos de prueba|plan de pruebas|matriz de trazabilidad/.test(all)) score += 8;

  // API testing
  if (/\bpostman\b/.test(all)) score += 10;
  if (/\binsomnia\b|\bcharles\s*proxy\b/.test(all)) score += 8;
  if (/\brest\s*api\b|\bapi\s+test|api\s+validat/.test(all)) score += 8;

  // Base de datos y SQL
  if (/\bsql\b/.test(all)) score += 10;
  if (/database\s+test|data\s+integrit|consultas\s+sql/.test(all)) score += 8;

  // Arquitectura moderna
  if (/microservice/.test(all)) score += 10;
  if (/event.driven|\beda\b/.test(all)) score += 8;

  // Bug tracking
  if (/\bjira\b/.test(all)) score += 6;
  if (/azure\s+devops/.test(all)) score += 6;

  // Herramientas de automatización
  if (/playwright/.test(all)) score += 15;
  if (/\bcypress\b/.test(all)) score += 12;
  if (/\bselenium\b/.test(all)) score += 10;
  if (/\bappium\b/.test(all)) score += 8;
  if (/\bsdet\b/.test(all)) score += 12;

  // CI/CD
  if (/ci\/cd|github\s+actions|gitlab\s+ci|\bjenkins\b/.test(all)) score += 8;
  if (/\bdocker\b|\bkubernetes\b/.test(all)) score += 5;

  // Performance / load testing
  if (/\bk6\b|\bjmeter\b|\bgatling\b/.test(all)) score += 6;

  // Metodología ágil
  if (/\bagile\b|\bscrum\b/.test(all)) score += 5;

  // Accesibilidad / seguridad
  if (/\bwcag\b|accessibility\s+test|pruebas\s+de\s+accesibilidad/.test(all)) score += 7;
  if (/security\s+test|pruebas\s+de\s+seguridad/.test(all)) score += 5;

  // AI tools en el flujo de trabajo (bonus fuerte)
  if (/cursor\b|windsurf|claude\s+code|copilot\s+cli|gemini\s+cli|\bcodex\b/.test(all)) score += 12;
  if (/\bai\b|artificial intelligence|\bllm\b|machine learning|inteligencia artificial/.test(all)) score += 6;

  // Señal de cliente US / nearshore (english required = perfil internacional)
  if (/\benglish\b|\bingl[eé]s\b/.test(all)) score += 8;
  if (/us\s+client|cliente\s+(us|eeuu)|gorilla\s+logic|toptal|perficient/.test(all)) score += 10;

  // LATAM / Colombia-friendly signals (empresa acepta candidatos remotos fuera de EEUU)
  if (/\blatam\b|latin\s+america/.test(all)) score += 20;
  if (/\bcolombia\b/.test(desc)) score += 20;
  if (/nearshore/.test(all)) score += 15;
  if (/timezone.{0,30}(est|pst|cst|et\b|pt\b|ct\b)|compatible.{0,20}timezone|work\s+from\s+anywhere|anywhere\s+in\s+the\s+world/.test(all)) score += 10;
  if (/open\s+to\s+international|global\s+(remote\s+)?team|international\s+team|distributed\s+team/.test(all)) score += 10;

  // Señales que excluyen candidatos fuera de EEUU
  if (/must\s+be\s+authorized\s+to\s+work|authorized\s+to\s+work\s+in\s+the\s+u\.?s|u\.?s\.?\s+citizen(ship)?|green\s+card|must\s+reside\s+in\s+the\s+u\.?s|only\s+u\.?s\.?\s+residents?/.test(all)) score -= 50;
  if (/\bc2c\b|\bw-?2\b|\b1099\b/.test(all)) score -= 30;

  // Señales negativas
  if (/manufactur|industrial|hardware|mec[áa]nic|embedded|firmware/.test(all)) score -= 20;
  if (/\bsap\b/.test(title)) score -= 10;
  if (/edtech|game\s+test|videogame/.test(all)) score -= 15;

  // Bonus por recencia
  if (job.datePosted) {
    const posted = new Date(job.datePosted);
    if (!isNaN(posted.getTime())) {
      const ageHours = (Date.now() - posted.getTime()) / (1000 * 60 * 60);
      if (ageHours < 24) score += 10;
      else if (ageHours < 72) score += 5;
    }
  }

  return score;
}

function scoreStars(score: number): string {
  if (score >= 65) return '⭐⭐⭐';
  if (score >= 35) return '⭐⭐';
  return '⭐';
}

// ─── Detección de país y filtros de exclusión ─────────────────────────────

const COUNTRY_PATTERNS: Record<string, RegExp> = {
  'Brasil':    /\bbrasil\b|\bbrazil\b|são paulo|sao paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|fortaleza\b|brasília|brasilia|recife\b|manaus\b|goiânia|goiania/i,
  'España':    /\bespa[nñ]a\b|\bspain\b|\bmadrid\b|\bbarcelona\b|\bvalencia\b|\bsevilla\b|\bbilbao\b|\bzaragoza\b|\bmálaga\b|\bmalaga\b|\balicante\b|\bmurcia\b|\bvalladolid\b/i,
  'México':    /\bm[eé]xico\b|\bcdmx\b|\bmonterrey\b|\bguadalajara\b|\bpuebla\b/i,
  'Argentina': /\bargentina\b|\bbuenos aires\b|\bc[oó]rdoba\b|\brosario\b/i,
  'Chile':     /\bchile\b|\bsantiago de chile\b/i,
  'Perú':      /\bper[uú]\b|\blima\b/i,
  'Colombia':  /\bcolombia\b|\bbogot[aá]\b|\bmedell[ií]n\b|\bcali\b|\bbarranquilla\b|\bcartagena\b/i,
};

function detectJobCountry(job: Job): string {
  const text = [job.location, job.company, job.description || ''].join(' ');
  for (const [country, pattern] of Object.entries(COUNTRY_PATTERNS)) {
    if (pattern.test(text)) return country;
  }
  return '';
}

function hasInternationalSignal(job: Job): boolean {
  const all = (job.title + ' ' + (job.description || '')).toLowerCase();
  return /\blatam\b|latin\s+america|nearshore|\bcolombia\b|work\s+from\s+anywhere|anywhere\s+in\s+the\s+world|open\s+to\s+international|global\s+(remote\s+)?team|international\s+team|distributed\s+team|worldwide\s+team|remote[- ]first|hire.{0,20}global|global.{0,20}hire/.test(all);
}

function isExcludedJob(job: Job): { excluded: boolean; reason: string } {
  const country = detectJobCountry(job);

  if (country === 'Brasil') {
    return { excluded: true, reason: 'oferta de Brasil' };
  }

  if (country === 'España') {
    return { excluded: true, reason: 'oferta de España (zona horaria incompatible)' };
  }

  // Detectar restricciones explícitas de país en la descripción
  const desc = (job.description || '').toLowerCase();

  // Hard exclusion: US jobs that explicitly require US work authorization
  if (job.sourceLocation === 'United States') {
    const usAuthRequired = /must\s+be\s+authorized\s+to\s+work|authorized\s+to\s+work\s+in\s+the\s+u\.?s|u\.?s\.?\s+citizen(ship)?\s+required|green\s+card\s+required|must\s+reside\s+in\s+the\s+u\.?s|only\s+u\.?s\.?\s+residents?/.test(desc);
    if (usAuthRequired) return { excluded: true, reason: 'requiere autorización de trabajo en EEUU' };
  }
  const countryRestrictions = [
    { pattern: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?m[eé]xico|exclusivo\s+m[eé]xico|only\s+(for\s+)?mexico/i, country: 'México' },
    { pattern: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?argentina|exclusivo\s+argentina/i, country: 'Argentina' },
    { pattern: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?chile|exclusivo\s+chile/i, country: 'Chile' },
    { pattern: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?per[uú]|exclusivo\s+per[uú]/i, country: 'Perú' },
  ];
  for (const r of countryRestrictions) {
    if (r.pattern.test(desc)) {
      return { excluded: true, reason: `restricción a ${r.country}` };
    }
  }

  return { excluded: false, reason: '' };
}

// ─── Filtro de CV (se activa cuando cv-profile.json existe) ───────────────

function loadCvProfile(): CvProfile | null {
  if (!fs.existsSync(CV_PROFILE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CV_PROFILE_FILE, 'utf-8')) as CvProfile; } catch { return null; }
}

function scoreAgainstCv(job: Job, profile: CvProfile): number {
  const all = (job.title + ' ' + (job.description || '')).toLowerCase();
  let bonus = 0;
  for (const skill of profile.skills) {
    if (all.includes(skill.toLowerCase())) bonus += 5;
  }
  for (const kw of (profile.excludeKeywords ?? [])) {
    if (all.includes(kw.toLowerCase())) bonus -= 15;
  }
  return bonus;
}

async function sendEmail(subject: string, html: string) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to   = process.env.EMAIL_TO;
  if (!host || !user || !pass || !to) {
    console.warn('⚠️  sendEmail: faltan vars SMTP en el entorno — email no enviado.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user, pass },
  });

  try {
    const info = await transporter.sendMail({
      from: `"LinkedIn Scraper QA" <${user}>`,
      to,
      subject,
      html,
    });
    logInfo(`Email enviado a ${to}. ID: ${info.messageId}`);
  } catch (error) {
    logError('sendEmail', error);
  }
}

function parseJobDescription(raw: string): string {
  if (!raw.trim()) {
    return '<p style="color:#9ca3af;font-style:italic;margin:0">Sin descripción disponible.</p>';
  }

  // LinkedIn descriptions often arrive as a single wall of text with no newlines.
  // Step 1: insert line breaks before known section header keywords embedded in the text.
  let text = raw.trim();
  text = text.replace(
    /([^\n])\s*(?=(?:Requisitos|Requirements|Responsabilidades|Funciones y responsabilidades|Responsibilities|Funciones|Deseables?|Nice[\s-]to[\s-]have|Habilidades(?: complementarias)?|Skills|Beneficios|Benefits|Ofrecemos|We offer|About the role|About us|Sobre nosotros|Position Description|Job Description|Descripción del (?:cargo|puesto|rol)|Qualifications|Perfil(?: requerido)?|Lo que buscamos|Lo que ofrecemos|Conocimientos?)[^:\n]{0,40}:)/gi,
    '$1\n\n'
  );

  // Step 2: parse line by line
  const lines = text.replace(/\n{3,}/g, '\n\n').split('\n').map(l => l.trim()).filter(Boolean);
  const html: string[] = [];
  const bullets: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    const lis = bullets.map(b => `<li style="margin:5px 0;color:#374151;line-height:1.6;padding-left:2px">${b}</li>`).join('');
    html.push(`<ul style="margin:6px 0 12px 20px;padding:0">${lis}</ul>`);
    bullets.length = 0;
  };

  const sectionHeader = (text: string) =>
    `<p style="margin:16px 0 6px;font-size:11px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:2px solid #e2e8f0;padding-bottom:5px">${text}</p>`;

  // Split a paragraph into sentences at ". Capital" boundaries
  const splitSentences = (t: string) =>
    t.split(/\.\s+(?=[A-ZÁÉÍÓÚÑ])/).map(s => s.trim().replace(/\.$/, '')).filter(Boolean);

  for (const line of lines) {
    // Explicit bullet chars (•, -, *, ·, numbered)
    const bulletMatch = line.match(/^[•\-\*·]\s+(.+)/) ?? line.match(/^\d+[.)]\s+(.+)/);
    if (bulletMatch) { bullets.push(bulletMatch[1] ?? line); continue; }

    // "Header: body..." — header is ≤ 5 words, no period inside, followed by colon + content
    const sectionMatch = line.match(/^([^:.]{2,50}):\s*(.+)$/);
    if (sectionMatch && sectionMatch[1]!.split(' ').length <= 5 && !sectionMatch[1]!.includes('.')) {
      flushBullets();
      html.push(sectionHeader(sectionMatch[1]!.trim()));
      const body = sectionMatch[2]!.trim();
      const sentences = splitSentences(body);
      if (sentences.length >= 2) sentences.forEach(s => bullets.push(s));
      else html.push(`<p style="margin:4px 0 8px;color:#374151;line-height:1.65">${body}</p>`);
      continue;
    }

    // Standalone header line ending in ":"
    if (line.endsWith(':') && line.length <= 80 && !line.includes('.')) {
      flushBullets();
      html.push(sectionHeader(line.slice(0, -1)));
      continue;
    }

    // Long paragraph — split into sentences and render as bullets if multiple items
    flushBullets();
    const sentences = splitSentences(line);
    if (sentences.length >= 2) {
      sentences.forEach(s => bullets.push(s));
    } else {
      html.push(`<p style="margin:4px 0 10px;color:#374151;line-height:1.65">${line}</p>`);
    }
  }
  flushBullets();

  return html.join('') || '<p style="color:#9ca3af;font-style:italic;margin:0">Sin descripción disponible.</p>';
}

function scoreAccent(score: number): { border: string; badgeBg: string; badgeText: string; stars: string } {
  if (score >= 65) return { border: '#16a34a', badgeBg: '#dcfce7', badgeText: '#15803d', stars: '⭐⭐⭐' };
  if (score >= 35) return { border: '#d97706', badgeBg: '#fef3c7', badgeText: '#b45309', stars: '⭐⭐' };
  return          { border: '#94a3b8', badgeBg: '#f1f5f9', badgeText: '#475569', stars: '⭐' };
}

function buildJobsEmailHtml(jobs: Job[], label: string): string {
  const timestamp = new Date().toLocaleString('es-CO');

  const cards = jobs.map((job) => {
    const score = job.score ?? 0;
    const accent = scoreAccent(score);

    const meta: string[] = [];
    if (job.datePosted) meta.push(`📅 ${job.datePosted}`);
    if (job.detectedCountry) meta.push(`🌍 ${job.detectedCountry}`);
    if (job.sourceLocation && job.sourceLocation !== job.detectedCountry) meta.push(`🔍 ${job.sourceLocation}`);
    if (/remot[eo]/i.test(job.location + ' ' + (job.description || ''))) meta.push('🌐 Remote');
    const metaHtml = meta.length > 0
      ? `<div style="margin-top:8px">${meta.map(t =>
          `<span style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:11px;padding:2px 8px;border-radius:20px;margin:2px 4px 2px 0">${t}</span>`
        ).join('')}</div>`
      : '';

    return `
      <div style="border:1px solid #e2e8f0;border-left:4px solid ${accent.border};border-radius:0 8px 8px 0;margin-bottom:14px;overflow:hidden;background:#fff">
        <!-- Cabecera -->
        <div style="padding:14px 16px;border-bottom:1px solid #f1f5f9">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
            <tr>
              <td style="vertical-align:top;padding-right:14px">
                <div style="font-size:15px;font-weight:700;color:#1e293b;line-height:1.3">${job.title}</div>
                <div style="font-size:13px;color:#64748b;margin-top:4px">
                  <strong style="color:#334155">${job.company}</strong>
                  <span style="color:#cbd5e1"> &nbsp;|&nbsp; </span>
                  <span>${job.location}</span>
                </div>
                ${metaHtml}
              </td>
              <td style="vertical-align:top;width:130px;min-width:130px">
                <a href="${job.link}" style="display:block;background:#0077B5;color:#fff;padding:9px 0;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;text-align:center;white-space:nowrap">Ver oferta →</a>
                <div style="margin-top:6px;text-align:center">
                  <span style="display:inline-block;background:${accent.badgeBg};color:${accent.badgeText};border:1px solid ${accent.border};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">${accent.stars} ${score} pts</span>
                </div>
              </td>
            </tr>
          </table>
        </div>
        <!-- Descripción -->
        <div style="padding:14px 16px;font-size:13px;background:#fafafa">
          ${parseJobDescription(job.description || '')}
        </div>
      </div>`;
  }).join('');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:740px;margin:auto;background:#f8fafc;padding:20px">
      <!-- Encabezado -->
      <div style="background:linear-gradient(135deg,#0077B5 0%,#005c8e 100%);color:#fff;padding:20px 24px;border-radius:10px;margin-bottom:20px">
        <div style="font-size:20px;font-weight:700;margin:0">🚀 ${label}</div>
        <div style="font-size:13px;opacity:0.85;margin-top:6px">
          ${timestamp} &nbsp;·&nbsp; ${jobs.length} oferta${jobs.length !== 1 ? 's' : ''}
        </div>
        <!-- Leyenda de score -->
        <div style="margin-top:12px;font-size:11px;opacity:0.8">
          <span style="margin-right:12px">⭐⭐⭐ ≥ 65 pts &nbsp; Muy relevante</span>
          <span style="margin-right:12px">⭐⭐ ≥ 35 pts &nbsp; Relevante</span>
          <span>⭐ &lt; 35 pts &nbsp; Revisar</span>
        </div>
      </div>
      ${cards}
      <!-- Footer -->
      <div style="text-align:center;font-size:11px;color:#94a3b8;padding-top:8px">
        LinkedIn Job Scraper · Anderson Orjuela · Bogotá, Colombia
      </div>
    </div>`;
}

async function notifyError(message: string) {
  const whatsappEnabled = process.env.WHATSAPP_ENABLED !== 'false';
  if (whatsappEnabled) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_WHATSAPP_FROM;
    const toNumbers = (process.env.WHATSAPP_TO || '').split(',').map(n => n.trim()).filter(Boolean);
    if (accountSid && authToken && fromNumber && toNumbers.length > 0) {
      const client = twilio(accountSid, authToken);
      for (const toNumber of toNumbers) {
        try {
          const result = await client.messages.create({ body: message, from: fromNumber, to: toNumber });
          logInfo(`Alerta de error enviada a ${toNumber}. SID: ${result.sid}`);
        } catch (error) {
          logError('notifyError', error);
        }
      }
    }
  }

  const errorTs = new Date().toLocaleString('es-CO');
  await sendEmail(
    '⚠️ Scraper LinkedIn — Alerta de error',
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border:1px solid #fecaca;border-radius:8px;overflow:hidden">
      <div style="background:#dc2626;color:#fff;padding:14px 20px">
        <div style="font-size:16px;font-weight:700">⚠️ Alerta del Scraper</div>
        <div style="font-size:12px;opacity:0.85;margin-top:2px">${errorTs}</div>
      </div>
      <div style="padding:20px">
        <pre style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:14px;border-radius:6px;white-space:pre-wrap;font-size:13px;line-height:1.6;margin:0">${message}</pre>
      </div>
    </div>`
  );
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

    // Combine Colombia (all work types) + US remote-only into one unified target list
    const locationTargets = [
      ...(process.env.SEARCH_LOCATIONS || '').split(',').map(l => l.trim()).filter(Boolean)
        .map(location => ({ location, remoteOnly: false })),
      ...(process.env.SEARCH_LOCATIONS_REMOTE || '').split(',').map(l => l.trim()).filter(Boolean)
        .map(location => ({ location, remoteOnly: true })),
    ];
    const remoteOnlyLocations = new Set(
      locationTargets.filter(t => t.remoteOnly).map(t => t.location)
    );

    let allJobs: Job[] = [];
    let allNewJobs: Job[] = [];
    const isFirstRun = !fs.existsSync(scraper['jobsFile']) || scraper.loadExistingJobs().length === 0;

    let consecutiveFailures = 0;
    let errorAlertSent = false;
    let sessionExpired = false;
    const FAILURE_THRESHOLD = 3;

    for (const { location, remoteOnly } of locationTargets) {
      if (sessionExpired) break;
      const tag = remoteOnly ? ' 🌐 (remote only)' : '';
      console.log(`\n  📍 Location: ${location}${tag}`);
      for (const keyword of keywords) {
        console.log(`  🔍 Searching: ${keyword}`);
        let result: Job[] | null = null;
        try {
          result = await withRetry(
            () => scraper.searchJobs(keyword, location, remoteOnly),
            `searchJobs("${keyword}", "${location}"${remoteOnly ? ', remote' : ''})`
          );
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('SESSION_EXPIRED')) {
            const ts = new Date().toLocaleString('es-CO');
            await notifyError(
              `🔐 *Sesión LinkedIn expirada*\n_${ts}_\n\nEl scraper se detuvo. Ejecuta:\n\`npx tsx linkedin-login.ts\`\npara renovar la sesión y reinicia el scraper.`
            );
            logInfo('Sesión expirada — deteniendo todas las búsquedas');
            sessionExpired = true;
            break;
          }
          throw error;
        }

        if (result === null) {
          consecutiveFailures++;
          if (consecutiveFailures >= FAILURE_THRESHOLD && !errorAlertSent) {
            errorAlertSent = true;
            const ts = new Date().toLocaleString('es-CO');
            await notifyError(`⚠️ *Scraper LinkedIn — Alerta*\n_${ts}_\n\n${consecutiveFailures} búsquedas fallidas consecutivas.\nÚltima: "${keyword}" en ${location}\n\nRevisa scraper.log para más detalles.`);
          }
        } else {
          consecutiveFailures = 0;
          errorAlertSent = false;
        }

        const jobs = result ?? [];
        allJobs = allJobs.concat(jobs);
        const newJobs = await scraper.getNewJobs(jobs);
        allNewJobs = allNewJobs.concat(newJobs);
        await randomDelay(DELAYS.between.min, DELAYS.between.max);
      }
    }

    // Remove duplicates
    const uniqueJobs = allNewJobs.filter((job, index, self) =>
      index === self.findIndex(j => j.link === job.link)
    );

    const uniqueAllJobs = allJobs.filter((job, index, self) =>
      index === self.findIndex(j => j.link === job.link)
    );

    const cvProfile = loadCvProfile();

    const jobsToScore = isFirstRun ? uniqueAllJobs : uniqueJobs;
    const jobsEnriched = jobsToScore.length > 0
      ? await scraper.fetchJobDescriptions(jobsToScore)
      : jobsToScore;

    const MIN_SCORE = Number(process.env.MIN_SCORE ?? 10);

    const jobsToProcess = jobsEnriched
      .map(job => {
        const detectedCountry = detectJobCountry(job);
        const cvBonus = cvProfile ? scoreAgainstCv(job, cvProfile) : 0;
        return { ...job, detectedCountry, score: scoreJob(job) + cvBonus };
      })
      .filter(job => {
        if (job.sourceLocation && remoteOnlyLocations.has(job.sourceLocation)) {
          // Require explicit international/LATAM signal — most US jobs don't hire outside the US
          if (!hasInternationalSignal(job)) {
            console.log(`  ⛔ Sin señal internacional: "${job.title}" en ${job.company} — descartado`);
            return false;
          }
          // Hybrid = not viable from Colombia
          const locDesc = (job.location + ' ' + (job.description || '')).toLowerCase();
          if (/\bh[íi]brid[ao]?\b|\bhybrid\b/.test(locDesc)) {
            console.log(`  ⛔ Híbrido (no apto desde Colombia): "${job.title}" en ${job.company} — descartado`);
            return false;
          }
          if ((job.score ?? 0) < 40) {
            console.log(`  ⛔ Score bajo (${job.score}): "${job.title}" en ${job.company} — descartado`);
            return false;
          }
        }
        // Score mínimo global — aplica a todas las ubicaciones incluyendo Colombia
        if ((job.score ?? 0) < MIN_SCORE) {
          console.log(`  ⛔ Score insuficiente (${job.score} < ${MIN_SCORE}): "${job.title}" en ${job.company} — descartado`);
          return false;
        }
        const { excluded, reason } = isExcludedJob(job);
        if (excluded) console.log(`  ⛔ Excluido: "${job.title}" en ${job.company} — ${reason}`);
        return !excluded;
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    scraper.saveJobs(jobsToProcess);

    // Filtrar jobs ya notificados por otro proceso (race condition entre instancias)
    const alreadyNotified = new Set(
      scraper.loadExistingJobs().filter(j => j.notifiedAt).map(j => j.link)
    );
    const jobsToNotify = isFirstRun
      ? jobsToProcess
      : jobsToProcess.filter(j => !alreadyNotified.has(j.link));

    if (isFirstRun) {
      await scraper.notifyNewJobs(jobsToNotify, 'PRIMERA EJECUCIÓN - TODAS LAS OFERTAS');
      scraper.markNotified(jobsToNotify.map(j => j.link));
    } else if (jobsToNotify.length > 0) {
      await scraper.notifyNewJobs(jobsToNotify, 'Nuevas ofertas QA');
      scraper.markNotified(jobsToNotify.map(j => j.link));
    }

    console.log(`\n✓ Job search completed. ${jobsToProcess.length} jobs ${isFirstRun ? 'found and saved (first run)' : 'new jobs found and saved'}.`);
  } catch (error) {
    console.error('✗ Error during job search:', error);
  } finally {
    await scraper.close();
  }
}

async function runDailySummary() {
  const timestamp = new Date().toLocaleString('es-CO');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString()}] RESUMEN DIARIO — ${timestamp}`);
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

  console.log(`\n📋 Total ofertas encontradas hoy: ${todaysJobs.length}\n`);

  todaysJobs.forEach((job, idx) => {
    const stars = scoreStars(job.score ?? 0);
    const date = job.datePosted ? ` | 📅 ${job.datePosted}` : '';
    const desc = job.description ? `\n   📝 ${job.description.substring(0, 100)}...` : '';
    console.log(`${idx + 1}. ${stars} ${job.title}`);
    console.log(`   🏢 ${job.company} | 📍 ${job.location}${date}`);
    console.log(`   🔗 ${job.link}${desc}`);
    console.log('');
  });

  console.log('='.repeat(60));

  const dailyLabel = `RESUMEN DIARIO — ${new Date().toLocaleDateString('es-CO')} (${todaysJobs.length} ofertas)`;
  await scraper.notifyNewJobs(todaysJobs, dailyLabel);
}

async function runWeeklySummary() {
  const timestamp = new Date().toLocaleString('es-CO');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString()}] TOP 10 SEMANAL — ${timestamp}`);
  console.log(`${'='.repeat(60)}`);

  const scraper = new LinkedInJobScraper();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const top10 = scraper.loadExistingJobs()
    .filter(job => job.savedAt && new Date(job.savedAt).getTime() >= cutoff)
    .map(job => ({ ...job, score: job.score ?? scoreJob(job) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  console.log(`\n🏆 Top ofertas de la semana: ${top10.length}\n`);
  top10.forEach((job, idx) => {
    console.log(`${idx + 1}. ${scoreStars(job.score ?? 0)} [${job.score} pts] ${job.title} @ ${job.company}`);
  });
  console.log('='.repeat(60));

  if (top10.length === 0) {
    console.log('Sin ofertas esta semana.');
    return;
  }

  const weekLabel = `TOP 10 OFERTAS DE LA SEMANA — ${new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  await scraper.notifyNewJobs(top10, weekLabel);
}

let isSearchRunning = false;

function startScheduler() {
  const schedule = process.env.CRON_SCHEDULE || '0 7-19 * * *';
  const scriptPath = fileURLToPath(import.meta.url);

  console.log('\n📅 Job scraper scheduler started.');
  console.log(`   Scraping:  ${schedule}`);
  console.log(`   Summary:   0 8 * * * (8:00 am diario)`);
  console.log(`   Weekly:    0 17 * * 5 (viernes 5:00 pm — top 10)\n`);

  cron.schedule(schedule, () => {
    if (isSearchRunning) {
      console.log(`[${new Date().toLocaleTimeString()}] Skipping — previous search still running.`);
      return;
    }
    isSearchRunning = true;

    // Spawn child process so Playwright never blocks the cron event loop
    const child = spawn('npx', ['tsx', scriptPath, '--once'], {
      cwd: path.dirname(scriptPath),
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', () => { isSearchRunning = false; });
    child.on('error', (err) => {
      console.error(`[${new Date().toLocaleTimeString()}] Error al iniciar proceso hijo:`, err);
      isSearchRunning = false;
    });
  });

  cron.schedule('0 8 * * *', () => {
    runDailySummary().catch(console.error);
  });

  cron.schedule('0 17 * * 5', () => {
    runWeeklySummary().catch(console.error);
  });

  // Keep the process running
  setInterval(() => {}, 1000);
}

async function sendTestEmail(toOverride?: string) {
  const scraper = new LinkedInJobScraper();
  const jobs = scraper.loadExistingJobs();
  if (jobs.length === 0) {
    console.error('✗ No hay jobs en jobs.json para enviar.');
    return;
  }

  const last = jobs[jobs.length - 1]!;
  const job = { ...last, score: last.score ?? scoreJob(last) } as Job;

  const to = toOverride ?? process.env.EMAIL_TO ?? '';
  if (!to) { console.error('✗ EMAIL_TO no configurado.'); return; }

  const subject = `🧪 Test email — ${job.title} @ ${job.company}`;
  const html = buildJobsEmailHtml([job], 'Email de prueba — último job encontrado');

  // Override EMAIL_TO temporarily
  const original = process.env.EMAIL_TO;
  process.env.EMAIL_TO = to;
  await sendEmail(subject, html);
  process.env.EMAIL_TO = original;

  console.log(`✓ Email de prueba enviado a: ${to}`);
  console.log(`  Job: ${job.title} @ ${job.company} (score: ${job.score})`);
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--once')) {
    await runJobSearch();
  } else if (args.includes('--summary')) {
    await runDailySummary();
  } else if (args.includes('--weekly')) {
    await runWeeklySummary();
  } else if (args.includes('--test-email')) {
    const toArg = args.find(a => a.startsWith('--to='))?.split('=')[1];
    await sendTestEmail(toArg);
  } else {
    startScheduler();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { runJobSearch };