import * as fs from 'fs';
import { CV_PROFILE_FILE } from './scraper-config.js';
import { isColombian } from './filters.js';
import type { Job, CvProfile } from './types.js';

export function scoreJob(job: Job): number {
  let score = 0;
  const title = job.title.toLowerCase();
  const desc  = (job.description || '').toLowerCase();
  const loc   = (job.location + ' ' + (job.sourceLocation ?? '')).toLowerCase();
  const all   = title + ' ' + desc;
  const allLoc = all + ' ' + loc;

  // Seniority
  if (/\bsenior\b|\bsr\.?\b|\blead\b|\bstaff\b|\bprincipal\b/.test(title)) score += 35;
  else if (/\bmid\b|\bssr\b|\bsemi\b/.test(title)) score += 15;
  else if (/\bjunior\b|\bjr\.?\b|\bentry\b|\btrainee\b/.test(title)) score -= 25;

  // Modalidad
  if (/remot[eo]/.test(allLoc)) score += 25;
  else if (/h[íi]brid/.test(allLoc)) score += 10;

  // Manual QA + STLC
  if (/\bmanual\b/.test(all)) score += 12;
  if (/\bstlc\b|software testing life cycle/.test(all)) score += 10;
  if (/test\s+(plan|case|suite|strateg)|traceabilit|casos de prueba|plan de pruebas|matriz de trazabilidad/.test(all)) score += 8;

  // API testing
  if (/\bpostman\b/.test(all)) score += 10;
  if (/\binsomnia\b|\bcharles\s*proxy\b/.test(all)) score += 8;
  if (/\brest\s*api\b|\bapi\s+test|api\s+validat/.test(all)) score += 8;

  // Base de datos
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

  // Performance
  if (/\bk6\b|\bjmeter\b|\bgatling\b/.test(all)) score += 6;

  // Metodología ágil
  if (/\bagile\b|\bscrum\b/.test(all)) score += 5;

  // Accesibilidad / seguridad
  if (/\bwcag\b|accessibility\s+test|pruebas\s+de\s+accesibilidad/.test(all)) score += 7;
  if (/security\s+test|pruebas\s+de\s+seguridad/.test(all)) score += 5;

  // AI tools
  if (/cursor\b|windsurf|claude\s+code|copilot\s+cli|gemini\s+cli|\bcodex\b/.test(all)) score += 12;
  if (/\bai\b|artificial intelligence|\bllm\b|machine learning|inteligencia artificial/.test(all)) score += 6;

  // Cliente US / nearshore
  if (/\benglish\b|\bingl[eé]s\b/.test(all)) score += 8;
  if (/us\s+client|cliente\s+(us|eeuu)|gorilla\s+logic|toptal|perficient/.test(all)) score += 10;

  // LATAM / Colombia-friendly
  if (isColombian(job)) score += 50;
  else if (/\blatam\b|latin\s+america/.test(all)) score += 15;

  if (/nearshore/.test(all)) score += 15;
  if (/timezone.{0,30}(est|pst|cst|et\b|pt\b|ct\b)|compatible.{0,20}timezone|work\s+from\s+anywhere|anywhere\s+in\s+the\s+world/.test(all)) score += 12;
  if (/open\s+to\s+international|global\s+(remote\s+)?team|international\s+team|distributed\s+team/.test(all)) {
    // Sólo suma si es nearshore o menciona Colombia
    if (/nearshore|colombia/i.test(all)) score += 10;
    else score -= 15;
  }

  // Penalizar EST timezone required sin ser colombiano
  if (/\best\s*(?:time\s*)?zone|eastern\s+time|office\s+hours.*est/.test(desc) && !isColombian(job)) score -= 20;

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
