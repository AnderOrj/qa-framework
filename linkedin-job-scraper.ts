import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import * as dotenv from 'dotenv';
import cron from 'node-cron';

import {
  SESSION_FILE, JOBS_FILE, LOG_FILE, CV_PROFILE_FILE,
  TIMEOUTS, DELAYS, SELECTORS, QA_KEYWORDS,
} from './utils/scraper-config.js';
import { logError, logInfo } from './utils/logger.js';
import { randomDelay } from './utils/browser.js';
import type { Job } from './utils/types.js';
import { scoreJob, scoreStars, loadCvProfile, scoreAgainstCv } from './utils/scoring.js';
import { detectJobCountry, hasInternationalSignal, isExcludedJob, isHybridOrOnSite, parseSalary, isBelowMinSalary, isColombian } from './utils/filters.js';
import { notifyNewJobs, notifyError, notifyCritical } from './utils/notifications.js';
import { loadJobs, saveJobs, getNewJobs, markNotified, dedupJobs } from './utils/store.js';
import { autoLogin } from './utils/auto-login.js';
import { generateAndSendCoverLetter } from './utils/cover-letter.js';
import { filterSuspectJobs }         from './utils/job-quality.js';

dotenv.config();

// ─── Browser scraper class ────────────────────────────────────────────────────

class LinkedInJobScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private hasDebugged = false;

  async init() {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    const ctxOptions = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 } as const,
    };
    const hasSession = fs.existsSync(SESSION_FILE);
    this.context = hasSession
      ? await this.browser.newContext({ ...ctxOptions, storageState: SESSION_FILE })
      : await this.browser.newContext(ctxOptions);
    this.page = await this.context.newPage();
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as unknown as Record<string, unknown>)['chrome'] = { runtime: {} };
    });
    this.page.setDefaultTimeout(TIMEOUTS.page);
    if (hasSession) logInfo('Sesión LinkedIn cargada desde linkedin-session.json');
  }

  async searchJobs(keyword: string, location: string = '', remoteOnly = false): Promise<Job[]> {
    if (!this.page) throw new Error('Browser not initialized');

    const workTypes = remoteOnly ? '2' : '1%2C2%2C3';
    const maxPages = Number(process.env.MAX_PAGES_PER_SEARCH ?? 3);
    const daysBack = Number(process.env.SEARCH_DAYS_BACK ?? 7);
    const allExtracted: Job[] = [];

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      const start = pageIdx * 25;
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&f_TPR=r${daysBack * 86400}&f_WT=${workTypes}&start=${start}`;
      const t0 = Date.now();
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      const elapsed = Date.now() - t0;
      // Adaptive rate limiting: slow response → increase delays to avoid blocks
      const slowFactor = elapsed > 6000 ? 2.5 : elapsed > 3500 ? 1.6 : 1;
      if (slowFactor > 1) logInfo(`⚡ Rate limiting adaptativo: respuesta en ${elapsed}ms → delays ×${slowFactor}`);

      const currentUrl = this.page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
        throw new Error('SESSION_EXPIRED: LinkedIn redirigió al login — sesión expirada');
      }

      await this.page.waitForSelector('.job-search-card, .job-card-container', { timeout: TIMEOUTS.jobCard }).catch(() => {});
      await randomDelay(DELAYS.page.min / 2 * slowFactor, DELAYS.page.max / 2 * slowFactor);
      await this.dismissModal();
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(DELAYS.scroll.min / 2, DELAYS.scroll.max / 2);
      await this.dismissModal();

      if (!this.hasDebugged) {
        this.hasDebugged = true;
        await this.debugPage(`${keyword} / ${location}`);
      }

      const pageJobs = await this.page.$$eval('.job-search-card, .job-card-container', (cards) =>
        cards.map((card) => {
          const linkEl = (card.querySelector('a.base-card__full-link') as HTMLAnchorElement)
                      || (card.querySelector('a.job-card-list__title') as HTMLAnchorElement)
                      || (card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement);
          const link = (linkEl?.href || '').split('?')[0] ?? '';

          const titleEl = card.querySelector('.artdeco-entity-lockup__title')
                       || card.querySelector('a.job-card-list__title--link')
                       || card.querySelector('.base-search-card__title')
                       || card.querySelector('.job-card-list__title');
          const title = titleEl?.textContent?.trim() || '';

          const companyEl = card.querySelector('.base-search-card__subtitle')
                         || card.querySelector('.job-card-container__primary-description')
                         || card.querySelector('.artdeco-entity-lockup__subtitle');
          const company = companyEl?.textContent?.trim() || '';

          const locationEl = card.querySelector('.job-search-card__location')
                          || card.querySelector('.job-card-container__metadata-item')
                          || card.querySelector('.artdeco-entity-lockup__caption');
          const location = locationEl?.textContent?.trim() || '';

          const timeEl = card.querySelector('time');
          const datePosted = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';

          return { title, company, location, link, description: '', datePosted } as {
            title: string; company: string; location: string; link: string; description: string; datePosted: string;
          };
        })
      );

      const validOnPage = pageJobs.filter(j => j.link);
      if (validOnPage.length === 0) break;

      allExtracted.push(...validOnPage);
      logInfo(`Página ${pageIdx + 1}/${maxPages}: ${validOnPage.length} cards para "${keyword}" en ${location || 'global'}`);

      if (pageIdx < maxPages - 1) await randomDelay(DELAYS.page.min, DELAYS.page.max);
    }

    const relevant = allExtracted
      .map(job => ({ ...job, sourceLocation: location }))
      .filter(job => QA_KEYWORDS.some(kw => job.title.toLowerCase().includes(kw)));

    console.log(`✅ Extracted ${relevant.length} relevant jobs from "${keyword}" (filtered from ${allExtracted.length} total)`);
    return relevant;
  }

  async fetchJobDescriptions(jobs: Job[], maxJobs = 20): Promise<Job[]> {
    if (!this.page) return jobs;
    const toFetch = jobs.slice(0, maxJobs);
    const enriched: Job[] = [];

    for (const job of toFetch) {
      try {
        await this.page.goto(job.link, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.modal });

        const currentUrl = this.page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/authwall') || currentUrl.includes('/checkpoint')) {
          logInfo(`⚠️  Sesión expirada al obtener descripción: ${currentUrl} — abortando descripciones`);
          enriched.push(job);
          break;
        }

        // Scroll para activar carga lazy de la descripción
        await this.page.evaluate(() => window.scrollTo(0, 400));
        await this.page.waitForSelector([...SELECTORS.description].join(', '), { timeout: TIMEOUTS.jobCard }).catch(() => {});
        await randomDelay(DELAYS.scroll.min / 2, DELAYS.scroll.max / 2);

        // Expandir descripción colapsada si hay botón "Show more"
        for (const sel of SELECTORS.showMore) {
          try {
            const btn = await this.page.$(sel);
            if (btn) {
              await btn.click();
              await randomDelay(400, 700);
              break;
            }
          } catch { /* botón no presente */ }
        }

        const description = await this.page.$$eval(
          [...SELECTORS.description].join(', '),
          (els) => els.map(el => el.textContent?.trim() ?? '').filter(t => t.length > 0).join(' ')
        ).catch(() => '');

        if (description.length === 0) {
          const pageTitle = await this.page.title().catch(() => '');
          logInfo(`⚠️  Descripción vacía: "${job.title}" | URL: ${currentUrl.substring(0, 80)} | Title: ${pageTitle}`);
          // Health check: loguear qué selectores están activos para detectar cambios de DOM
          for (const sel of SELECTORS.description) {
            const count = await this.page.$$eval(sel, els => els.length).catch(() => 0);
            if (count > 0) logInfo(`  ✓ Selector activo (${count} elementos, textContent vacío?): ${sel}`);
          }
          logInfo(`  ✗ Ningún selector retornó contenido — puede ser cambio de DOM en LinkedIn`);
        }

        const salary = parseSalary(description);
        enriched.push({ ...job, description: description.substring(0, 2000), ...(salary ? { salary } : {}) });
        logInfo(`Descripción obtenida: "${job.title}" (${description.length} chars)`);
      } catch (err) {
        logInfo(`⚠️  Error obteniendo descripción de "${job.title}": ${String(err).substring(0, 100)}`);
        enriched.push(job);
      }
      await randomDelay(DELAYS.description.min, DELAYS.description.max);
    }

    return [...enriched, ...jobs.slice(maxJobs)];
  }

  private async dismissModal() {
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
      await this.page.keyboard.press('Escape');
      await randomDelay(DELAYS.modal.min, DELAYS.modal.max);
    } catch { /* modal not present */ }
  }

  private async debugPage(label: string) {
    if (!this.page) return;
    const url = this.page.url();
    const title = await this.page.title();
    const screenshotPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'debug-screenshot.png');
    await this.page.screenshot({ path: screenshotPath, fullPage: false });
    logInfo(`DEBUG [${label}] URL: ${url} | Title: ${title} | Screenshot: ${screenshotPath}`);
    const counts = await this.page.evaluate(() => ({
      jobSearchCard:    document.querySelectorAll('.job-search-card').length,
      jobCardContainer: document.querySelectorAll('.job-card-container').length,
      dataJobId:        document.querySelectorAll('[data-job-id]').length,
    }));
    logInfo(`DEBUG selectors: ${JSON.stringify(counts)}`);
    // Alerta temprana si ningún selector de cards está encontrando resultados
    if (counts.jobSearchCard === 0 && counts.jobCardContainer === 0 && counts.dataJobId === 0) {
      logInfo(`⚠️  ALERTA: Todos los selectores de job-cards retornan 0 — posible cambio de DOM en LinkedIn`);
    }
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      if (error instanceof Error && error.message.startsWith('SESSION_EXPIRED')) throw error;
      const isLast = attempt === retries;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
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
  const tooBig = size > 5 * 1024 * 1024;
  const tooOld = (Date.now() - birthtimeMs) > 7 * 24 * 60 * 60 * 1000;
  if (tooBig || tooOld) {
    const reason = tooBig ? `${(size / 1024 / 1024).toFixed(1)} MB` : 'más de 7 días';
    fs.renameSync(LOG_FILE, LOG_FILE.replace('.log', '.log.bak'));
    logInfo(`Log rotado (${reason}) → scraper.log.bak`);
  }
}


// ─── Per-location search ──────────────────────────────────────────────────────

async function searchOneLocation(
  keywords: string[],
  location: string,
  remoteOnly: boolean,
  retried = false,
): Promise<{ jobs: Job[]; sessionExpired: boolean }> {
  const scraper = new LinkedInJobScraper();
  await scraper.init();
  const tag = remoteOnly ? ' 🌐 (remote only)' : '';
  console.log(`\n  📍 Location: ${location}${tag}`);

  const jobs: Job[] = [];
  let consecutiveFailures = 0;
  let errorAlertSent = false;

  try {
    for (const keyword of keywords) {
      console.log(`  🔍 [${location}] Searching: ${keyword}`);
      let result: Job[] | null = null;
      try {
        result = await withRetry(
          () => scraper.searchJobs(keyword, location, remoteOnly),
          `searchJobs("${keyword}", "${location}"${remoteOnly ? ', remote' : ''})`
        );
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('SESSION_EXPIRED')) {
          if (!retried) {
            logInfo('Sesión expirada — intentando auto-renovar...');
            const renewed = await autoLogin();
            if (renewed) {
              logInfo('Sesión renovada — reintentando búsqueda en esta ubicación...');
              await scraper.close();
              return searchOneLocation(keywords, location, remoteOnly, true);
            }
          }
          await notifyCritical(
            'Sesión LinkedIn expirada',
            `Auto-renovación ${retried ? 'ya intentada y falló' : 'falló'}.\n\nAcción requerida:\n  npx tsx linkedin-login.ts\n\nEl scraper se detuvo. Reinícialo después de renovar la sesión.`
          );
          logInfo('Sesión expirada — deteniendo todas las búsquedas');
          return { jobs, sessionExpired: true };
        }
        throw error;
      }

      if (result === null) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3 && !errorAlertSent) {
          errorAlertSent = true;
          const ts = new Date().toLocaleString('es-CO');
          await notifyError(`⚠️ *Scraper LinkedIn — Alerta*\n_${ts}_\n\n${consecutiveFailures} búsquedas fallidas consecutivas.\nÚltima: "${keyword}" en ${location}\n\nRevisa scraper.log para más detalles.`);
        }
      } else {
        consecutiveFailures = 0;
        errorAlertSent = false;
        jobs.push(...result);
      }

      await randomDelay(DELAYS.between.min, DELAYS.between.max);
    }
  } finally {
    await scraper.close();
    console.log(`  ✓ [DONE] Location: ${location}${tag} — ${jobs.length} jobs found`);
  }

  return { jobs, sessionExpired: false };
}

// ─── Main run ─────────────────────────────────────────────────────────────────

async function runJobSearch() {
  rotateLogIfNeeded();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString()}] Starting LinkedIn job search...`);
  console.log(`${'='.repeat(60)}`);

  try {
    const keywords = (process.env.SEARCH_KEYWORDS || '').split(',').map(k => k.trim()).filter(Boolean);

    const locationTargets = [
      ...(process.env.SEARCH_LOCATIONS        || '').split(',').map(l => l.trim()).filter(Boolean).map(location => ({ location, remoteOnly: false })),
      ...(process.env.SEARCH_LOCATIONS_REMOTE || '').split(',').map(l => l.trim()).filter(Boolean).map(location => ({ location, remoteOnly: true  })),
    ];
    const remoteOnlyLocations = new Set(locationTargets.filter(t => t.remoteOnly).map(t => t.location));
    const isFirstRun = !fs.existsSync(JOBS_FILE) || loadJobs().length === 0;

    console.log(`  ⚡ Running ${locationTargets.length} location(s) in parallel...`);

    const locationResults = await Promise.all(
      locationTargets.map(({ location, remoteOnly }) => searchOneLocation(keywords, location, remoteOnly))
    );

    if (locationResults.some(r => r.sessionExpired)) return;

    const allJobs = locationResults.flatMap(r => r.jobs);
    const jobsToScore = dedupJobs(isFirstRun ? allJobs : getNewJobs(allJobs));

    // Also pick up existing jobs that never got a description (backfill)
    const MAX_DESC = Number(process.env.MAX_DESC_PER_RUN ?? 40);
    const existingNoDesc = isFirstRun ? [] : loadJobs()
      .filter(j => !j.description || j.description.length < 50)
      .slice(0, Math.max(0, MAX_DESC - jobsToScore.length));

    const toEnrich = [...jobsToScore, ...existingNoDesc];

    let jobsEnriched = jobsToScore;
    if (toEnrich.length > 0) {
      const descScraper = new LinkedInJobScraper();
      await descScraper.init();
      try {
        const enriched = await descScraper.fetchJobDescriptions(toEnrich, MAX_DESC);
        // Split back: new jobs enriched + backfilled existing jobs (save back to store)
        jobsEnriched = enriched.slice(0, jobsToScore.length);
        const backfilled = enriched.slice(jobsToScore.length).filter(j => j.description && j.description.length > 50);
        if (backfilled.length > 0) {
          const all = loadJobs().map(j => {
            const updated = backfilled.find(b => b.link === j.link);
            if (!updated) return j;
            const merged: typeof j = { ...j };
            if (updated.description) merged.description = updated.description;
            if (updated.salary)      merged.salary      = updated.salary;
            return merged;
          });
          saveJobs(all);
          console.log(`  📝 Backfill: ${backfilled.length} jobs sin descripción actualizados`);
        }
      } finally {
        await descScraper.close();
      }
    }

    const cvProfile = loadCvProfile();
    const MIN_SCORE = Number(process.env.MIN_SCORE ?? 10);

    const jobsToProcess = jobsEnriched
      .map(job => {
        const detectedCountry = detectJobCountry(job);
        const cvBonus = cvProfile ? scoreAgainstCv(job, cvProfile) : 0;
        return { ...job, detectedCountry, score: scoreJob(job) + cvBonus };
      })
      .filter(job => {
        // 🇨🇴 COLOMBIA: Incluir todos los jobs QA sin filtros estrictos
        if (isColombian(job)) {
          console.log(`  ✅ Job colombiano (sin filtros estrictos): "${job.title}" @ ${job.company}`);
          return true;
        }

        // Para trabajos NO colombianos, aplicar filtros normales
        const MIN_SALARY_USD = Number(process.env.MIN_SALARY_USD ?? 0);
        if (MIN_SALARY_USD > 0 && isBelowMinSalary(job, MIN_SALARY_USD)) {
          console.log(`  ⛔ Salario bajo (${job.salary?.raw}): "${job.title}" en ${job.company} — descartado`);
          return false;
        }
        if (job.sourceLocation && remoteOnlyLocations.has(job.sourceLocation)) {
          if (isHybridOrOnSite(job)) {
            console.log(`  ⛔ Híbrido/presencial (no apto desde Colombia): "${job.title}" en ${job.company} — descartado`);
            return false;
          }
          // Para jobs de EEUU sin señal de contratación internacional, exigir score alto
          // (evita jobs US-remote que solo contratan dentro de EEUU sin decirlo explícitamente)
          const hasIntlSignal = hasInternationalSignal(job);
          const minRemoteScore = hasIntlSignal ? 15 : 40;
          if ((job.score ?? 0) < minRemoteScore) {
            const reason = hasIntlSignal ? 'score bajo' : 'sin señal internacional y score insuficiente';
            console.log(`  ⛔ ${reason} (${job.score} < ${minRemoteScore}): "${job.title}" en ${job.company} — descartado`);
            return false;
          }
        }
        if ((job.score ?? 0) < MIN_SCORE) {
          console.log(`  ⛔ Score insuficiente (${job.score} < ${MIN_SCORE}): "${job.title}" en ${job.company} — descartado`);
          return false;
        }
        const { excluded, reason } = isExcludedJob(job, cvProfile?.blockedCompanies);
        if (excluded) console.log(`  ⛔ Excluido: "${job.title}" en ${job.company} — ${reason}`);
        return !excluded;
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Detector de jobs falsos/spam (solo si ANTHROPIC_API_KEY está configurada)
    let finalJobs: Job[] = jobsToProcess;
    if (process.env.ANTHROPIC_API_KEY && !isFirstRun) {
      const { clean, suspect } = await filterSuspectJobs(jobsToProcess as Job[]);
      if (suspect.length > 0) console.log(`  🚩 ${suspect.length} jobs sospechosos eliminados por detector de spam`);
      finalJobs = clean;
    }

    saveJobs(finalJobs);

    const alreadyNotified = new Set(loadJobs().filter(j => j.notifiedAt).map(j => j.link));
    const jobsToNotify = isFirstRun
      ? finalJobs
      : finalJobs.filter(j => {
          if (alreadyNotified.has(j.link)) return false;
          // No notificar sin descripción — el backfill la completará en el próximo ciclo
          if (!j.description || j.description.length < 80) {
            console.log(`  ⏳ Sin descripción aún: "${j.title}" @ ${j.company} — se enviará en próximo ciclo`);
            return false;
          }
          return true;
        });

    if (jobsToNotify.length > 0) {
      const label = isFirstRun ? 'PRIMERA EJECUCIÓN - TODAS LAS OFERTAS' : 'Nuevas ofertas QA';
      await notifyNewJobs(jobsToNotify, label);
      markNotified(jobsToNotify.map(j => j.link));

      // Cover letters solo pa jobs nuevos ⭐⭐⭐ (max 3 por ejecución, no en primera corrida)
      if (!isFirstRun) {
        const topJobs = jobsToNotify.filter(j => (j.score ?? 0) >= 65).slice(0, 3);
        for (const job of topJobs) {
          await generateAndSendCoverLetter(job);
        }
      }
    }

    console.log(`\n✓ Job search completed. ${jobsToProcess.length} jobs new jobs found and saved.`);

    // Regenerate dashboard after each run
    try {
      const { generateDashboard } = await import('./dashboard/generate.js');
      generateDashboard();
    } catch { /* dashboard generation is non-critical */ }

    // Resumen diario automático: si son las 18h o más y no se envió hoy todavía
    try {
      const hour = new Date().getHours();
      if (hour >= 18) {
        const summaryFlagFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.summary-sent-today');
        const todayStr = new Date().toLocaleDateString('es-CO');
        const lastSent = fs.existsSync(summaryFlagFile) ? fs.readFileSync(summaryFlagFile, 'utf-8').trim() : '';
        if (lastSent !== todayStr) {
          logInfo('Ejecutando resumen diario automático (≥18h y no enviado hoy)...');
          await runDailySummary();
          fs.writeFileSync(summaryFlagFile, todayStr);
        }
      }
    } catch (err) {
      logError('Resumen diario automático', err);
    }
  } catch (error) {
    console.error('✗ Error during job search:', error);
  }
}

// ─── Summary functions ────────────────────────────────────────────────────────

function buildScoreBreakdown(job: Job): string[] {
  const all   = ((job.title ?? '') + ' ' + (job.description ?? '')).toLowerCase();
  const title = (job.title ?? '').toLowerCase();
  const reasons: string[] = [];
  if (/\bsenior\b|\bsr\.?\b|\blead\b/.test(title))        reasons.push('Senior/Lead (+35)');
  if (/remot[eo]/.test(all))                               reasons.push('Remote (+25)');
  if (/\blatam\b|latin\s+america/.test(all))               reasons.push('LATAM (+20)');
  if (/\bcolombia\b/.test(all))                            reasons.push('Colombia (+20)');
  if (/playwright/.test(all))                              reasons.push('Playwright (+15)');
  if (/\bsdet\b/.test(all))                                reasons.push('SDET (+12)');
  if (/\bcypress\b/.test(all))                             reasons.push('Cypress (+12)');
  if (/nearshore/.test(all))                               reasons.push('Nearshore (+15)');
  if (/\bpostman\b/.test(all))                             reasons.push('Postman (+10)');
  if (/\brest\s*api\b/.test(all))                          reasons.push('REST API (+8)');
  if (/\bsql\b/.test(all))                                 reasons.push('SQL (+10)');
  if (/microservice/.test(all))                            reasons.push('Microservices (+10)');
  if (/\bai\b|\bllm\b/.test(all))                          reasons.push('AI/LLM (+6)');
  if (/\benglish\b|\bingl[eé]s\b/.test(all))               reasons.push('English req (+8)');
  if (/ci\/cd|github\s+actions/.test(all))                 reasons.push('CI/CD (+8)');
  return reasons;
}

async function runDailySummary() {
  const timestamp = new Date().toLocaleString('es-CO');
  const todayStr  = new Date().toLocaleDateString('es-CO');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString()}] RESUMEN DIARIO — ${timestamp}`);
  console.log(`${'='.repeat(60)}`);

  const allJobs = loadJobs()
    .filter(job => job.savedAt && new Date(job.savedAt).toLocaleDateString('es-CO') === todayStr)
    .map(job => ({ ...job, score: job.score ?? scoreJob(job) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const top5    = allJobs.slice(0, 5);
  const rest    = allJobs.slice(5);

  console.log(`\n📋 Total ofertas hoy: ${allJobs.length} | Top 5 destacadas:\n`);
  top5.forEach((job, idx) => {
    const stars   = scoreStars(job.score ?? 0);
    const reasons = buildScoreBreakdown(job).slice(0, 3).join(' · ');
    console.log(`${idx + 1}. ${stars} [${job.score} pts] ${job.title} @ ${job.company}`);
    console.log(`   📍 ${job.location}  |  Por qué: ${reasons}`);
    console.log(`   🔗 ${job.link}\n`);
  });
  console.log('='.repeat(60));

  // Rich HTML email with top-5 breakdown + rest as compact list
  const dateLabel = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const topHtml = top5.map((job, idx) => {
    const stars   = scoreStars(job.score ?? 0);
    const reasons = buildScoreBreakdown(job);
    const salary  = job.salary ? `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${job.salary.raw}</span>` : '';
    const reasonsHtml = reasons.length
      ? `<div style="margin-top:6px;font-size:11px;color:#64748b">${reasons.map(r => `<span style="background:#f1f5f9;padding:2px 7px;border-radius:8px;margin-right:4px">${r}</span>`).join('')}</div>`
      : '';
    return `
      <div style="border:1px solid #cbd5e1;border-left:4px solid ${(job.score ?? 0) >= 65 ? '#16a34a' : (job.score ?? 0) >= 35 ? '#2563eb' : '#94a3b8'};border-radius:0 8px 8px 0;margin-bottom:12px;background:#ffffff;overflow:hidden">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>
            <td style="padding:14px 16px;vertical-align:top">
              <div style="font-size:13px;font-weight:700;color:#1e293b">#${idx + 1} ${stars} ${job.title}</div>
              <div style="font-size:12px;color:#4a90d9;font-weight:600;margin-top:2px">${job.company}</div>
              <div style="font-size:11px;color:#64748b;margin-top:4px">📍 ${job.location}${job.datePosted ? ' · 📅 ' + job.datePosted : ''}</div>
              ${reasonsHtml}
              <a href="${job.link}" style="display:inline-block;margin-top:10px;background:#0077B5;color:#ffffff;padding:6px 14px;border-radius:6px;font-size:12px;text-decoration:none;font-weight:600">Ver oferta →</a>
            </td>
            <td style="padding:14px 16px;vertical-align:top;text-align:right;white-space:nowrap;width:120px">
              ${salary}
              <div style="margin-top:4px"><span style="background:#1a2744;color:#ffffff;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700">${job.score} pts</span></div>
            </td>
          </tr>
        </table>
      </div>`;
  }).join('');

  const restHtml = rest.length > 0
    ? `<div style="margin-top:20px"><p style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Otras ${rest.length} ofertas del día</p>
       ${rest.map(j => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px"><span style="color:#1e293b;font-weight:600">${j.title}</span> <span style="color:#4a90d9">@ ${j.company}</span> <span style="color:#94a3b8;float:right">${j.score ?? 0} pts</span><br><a href="${j.link}" style="color:#0077B5;font-size:11px">Ver →</a></div>`).join('')}
       </div>`
    : '';

  const html = `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#e8ecf1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
      <tr><td align="center" style="padding:20px 10px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:700px">
          <tr><td style="background:linear-gradient(135deg,#1a2744 0%,#2563eb 100%);color:#ffffff;padding:20px 24px;border-radius:10px;mso-border-radius:10px">
            <div style="font-size:18px;font-weight:800;color:#ffffff">📋 Resumen Diario QA</div>
            <div style="font-size:13px;color:#c8d8f8;margin-top:4px;text-transform:capitalize">${dateLabel}</div>
            <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px">
              <tr>
                <td style="text-align:center;padding-right:24px">
                  <div style="font-size:24px;font-weight:800;color:#ffffff">${allJobs.length}</div>
                  <div style="font-size:11px;color:#c8d8f8">Ofertas hoy</div>
                </td>
                <td style="text-align:center;padding-right:24px">
                  <div style="font-size:24px;font-weight:800;color:#ffffff">${allJobs.filter(j => (j.score ?? 0) >= 65).length}</div>
                  <div style="font-size:11px;color:#c8d8f8">⭐⭐⭐ Top</div>
                </td>
                <td style="text-align:center">
                  <div style="font-size:24px;font-weight:800;color:#ffffff">${allJobs.filter(j => j.salary).length}</div>
                  <div style="font-size:11px;color:#c8d8f8">Con salario</div>
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding-top:16px">
            <p style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 10px">🏆 Top 5 del día</p>
            ${topHtml}
            ${restHtml}
          </td></tr>
          <tr><td style="text-align:center;font-size:11px;color:#64748b;padding:12px 0 4px">
            LinkedIn Job Scraper · Anderson Orjuela · Bogotá, Colombia
          </td></tr>
        </table>
      </td></tr>
    </table>`;

  const { sendEmail } = await import('./utils/notifications.js');
  const label = `📋 Resumen Diario QA — ${dateLabel} (${allJobs.length} ofertas, top: ${top5[0]?.title ?? 'N/A'})`;
  await sendEmail(label, html);
}

async function runWeeklySummary() {
  const timestamp = new Date().toLocaleString('es-CO');
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString()}] TOP 10 SEMANAL — ${timestamp}`);
  console.log(`${'='.repeat(60)}`);

  const top10 = loadJobs()
    .filter(job => job.savedAt && new Date(job.savedAt).getTime() >= cutoff)
    .map(job => ({ ...job, score: job.score ?? scoreJob(job) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  console.log(`\n🏆 Top ofertas de la semana: ${top10.length}\n`);
  top10.forEach((job, idx) => console.log(`${idx + 1}. ${scoreStars(job.score ?? 0)} [${job.score} pts] ${job.title} @ ${job.company}`));
  console.log('='.repeat(60));

  if (top10.length === 0) { console.log('Sin ofertas esta semana.'); return; }

  const weekLabel = `TOP 10 OFERTAS DE LA SEMANA — ${new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  await notifyNewJobs(top10, weekLabel);
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let isSearchRunning = false;

function startScheduler() {
  const schedule   = process.env.CRON_SCHEDULE || '0 7-19 * * *';
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
    const child = spawn('npx', ['tsx', scriptPath, '--once'], {
      cwd: path.dirname(scriptPath),
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    child.on('close', () => { isSearchRunning = false; });
    child.on('error', (err) => {
      console.error(`Error al iniciar proceso hijo:`, err);
      isSearchRunning = false;
    });
  });

  cron.schedule('0 8 * * *',   () => runDailySummary().catch(console.error));
  cron.schedule('0 17 * * 5',  () => runWeeklySummary().catch(console.error));

  setInterval(() => {}, 1000);
}

// ─── Dev helpers ──────────────────────────────────────────────────────────────

async function sendTestEmail(toOverride?: string) {
  const jobs = loadJobs();
  if (jobs.length === 0) { console.error('✗ No hay jobs en jobs.json para enviar.'); return; }

  const last = jobs[jobs.length - 1]!;
  const job  = { ...last, score: last.score ?? scoreJob(last) } as Job;
  const to   = toOverride ?? process.env.EMAIL_TO ?? '';
  if (!to) { console.error('✗ EMAIL_TO no configurado.'); return; }

  const { sendEmail } = await import('./utils/notifications.js');
  const { buildJobsEmailHtml } = await import('./utils/email.js');

  const original = process.env.EMAIL_TO;
  process.env.EMAIL_TO = to;
  await sendEmail(`🧪 Test email — ${job.title} @ ${job.company}`, buildJobsEmailHtml([job], 'Email de prueba — último job encontrado'));
  process.env.EMAIL_TO = original;

  console.log(`✓ Email de prueba enviado a: ${to}`);
  console.log(`  Job: ${job.title} @ ${job.company} (score: ${job.score})`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if      (args.includes('--once'))      await runJobSearch();
  else if (args.includes('--summary'))   await runDailySummary();
  else if (args.includes('--weekly'))    await runWeeklySummary();
  else if (args.includes('--test-email')) {
    const toArg = args.find(a => a.startsWith('--to='))?.split('=')[1];
    await sendTestEmail(toArg);
  } else {
    startScheduler();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}

export { runJobSearch };
