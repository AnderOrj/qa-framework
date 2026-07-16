import * as fs from 'fs';
import { CV_PROFILE_FILE } from './scraper-config.js';
import { isColombian } from './filters.js';
import { REGEX_PATTERNS } from './regex-patterns.js';
import type { Job, CvProfile } from './types.js';

export function scoreJob(job: Job): number {
  let score = 0;
  const title = job.title.toLowerCase();
  const desc  = (job.description || '').toLowerCase();
  const all   = title + ' ' + desc;
  const allLoc = all + ' ' + (job.location + ' ' + (job.sourceLocation ?? '')).toLowerCase();

  // Seniority
  if (REGEX_PATTERNS.senior.test(title)) score += 35;
  else if (REGEX_PATTERNS.mid.test(title)) score += 15;
  else if (REGEX_PATTERNS.junior.test(title)) score -= 25;

  // Modalidad
  if (REGEX_PATTERNS.remote.test(allLoc)) score += 25;
  else if (REGEX_PATTERNS.hybrid.test(allLoc)) score += 10;

  // Manual QA + STLC
  if (REGEX_PATTERNS.manual.test(all)) score += 12;
  if (REGEX_PATTERNS.stlc.test(all)) score += 10;
  if (REGEX_PATTERNS.testPlan.test(all)) score += 8;

  // API testing
  if (REGEX_PATTERNS.postman.test(all)) score += 10;
  if (REGEX_PATTERNS.insomnia.test(all)) score += 8;
  if (REGEX_PATTERNS.restApi.test(all)) score += 8;

  // Base de datos
  if (REGEX_PATTERNS.sql.test(all)) score += 10;
  if (REGEX_PATTERNS.databaseTest.test(all)) score += 8;

  // Arquitectura moderna
  if (REGEX_PATTERNS.microservice.test(all)) score += 10;
  if (REGEX_PATTERNS.eventDriven.test(all)) score += 8;

  // Bug tracking
  if (REGEX_PATTERNS.jira.test(all)) score += 6;
  if (REGEX_PATTERNS.azureDevops.test(all)) score += 6;

  // Herramientas de automatización
  if (REGEX_PATTERNS.playwright.test(all)) score += 15;
  if (REGEX_PATTERNS.cypress.test(all)) score += 12;
  if (REGEX_PATTERNS.selenium.test(all)) score += 10;
  if (REGEX_PATTERNS.appium.test(all)) score += 8;
  if (REGEX_PATTERNS.sdet.test(all)) score += 12;

  // CI/CD
  if (REGEX_PATTERNS.cicd.test(all)) score += 8;
  if (REGEX_PATTERNS.containerization.test(all)) score += 5;

  // Performance
  if (REGEX_PATTERNS.loadTesting.test(all)) score += 6;

  // Metodología ágil
  if (REGEX_PATTERNS.agile.test(all)) score += 5;

  // Accesibilidad / seguridad
  if (REGEX_PATTERNS.accessibility.test(all)) score += 7;
  if (REGEX_PATTERNS.security.test(all)) score += 5;

  // AI tools
  if (REGEX_PATTERNS.aiTools.test(all)) score += 12;
  if (REGEX_PATTERNS.ai.test(all)) score += 6;

  // Cliente US / nearshore
  if (REGEX_PATTERNS.english.test(all)) score += 8;
  if (REGEX_PATTERNS.usClient.test(all)) score += 10;

  // LATAM / Colombia-friendly
  if (isColombian(job)) score += 50;
  else if (REGEX_PATTERNS.latam.test(all)) score += 15;

  if (REGEX_PATTERNS.nearshore.test(all)) score += 15;
  if (REGEX_PATTERNS.timezone.test(all)) score += 12;
  if (REGEX_PATTERNS.internationalTeam.test(all)) {
    if (REGEX_PATTERNS.nearshore.test(all) || /colombia/i.test(all)) score += 10;
    else score -= 15;
  }

  // Penalizar EST timezone required sin ser colombiano
  if (REGEX_PATTERNS.estTimezone.test(desc) && !isColombian(job)) score -= 20;

  // Señales que excluyen candidatos fuera de EEUU
  if (REGEX_PATTERNS.usAuthRequired.test(all)) score -= 50;
  if (REGEX_PATTERNS.contractor.test(all)) score -= 30;

  // Señales negativas
  if (REGEX_PATTERNS.manufacturing.test(all)) score -= 20;
  if (REGEX_PATTERNS.sap.test(title)) score -= 10;
  if (REGEX_PATTERNS.edtech.test(all)) score -= 15;

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

export function scoreStars(score: number): string {
  if (score >= 65) return '⭐⭐⭐';
  if (score >= 35) return '⭐⭐';
  return '⭐';
}

export function scoreAccent(score: number): { border: string; badgeBg: string; badgeText: string; stars: string } {
  if (score >= 65) return { border: '#16a34a', badgeBg: '#dcfce7', badgeText: '#15803d', stars: '⭐⭐⭐' };
  if (score >= 35) return { border: '#d97706', badgeBg: '#fef3c7', badgeText: '#b45309', stars: '⭐⭐' };
  return              { border: '#94a3b8', badgeBg: '#f1f5f9', badgeText: '#475569', stars: '⭐' };
}

export function loadCvProfile(): CvProfile | null {
  if (!fs.existsSync(CV_PROFILE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CV_PROFILE_FILE, 'utf-8')) as CvProfile; } catch { return null; }
}

export function scoreAgainstCv(job: Job, profile: CvProfile): number {
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
