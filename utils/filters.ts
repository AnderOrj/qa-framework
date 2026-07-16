import { REGEX_PATTERNS } from './regex-patterns.js';
import type { Job, JobSalary } from './types.js';

export const COUNTRY_PATTERNS: Record<string, RegExp> = {
  'Brasil':    /\bbrasil\b|\bbrazil\b|são paulo|sao paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|fortaleza\b|brasília|brasilia|recife\b|manaus\b|goiânia|goiania/i,
  'España':    /\bespa[nñ]a\b|\bspain\b|\bmadrid\b|\bbarcelona\b|\bvalencia\b|\bsevilla\b|\bbilbao\b|\bzaragoza\b|\bmálaga\b|\bmalaga\b|\balicante\b|\bmurcia\b|\bvalladolid\b/i,
  'México':    /\bm[eé]xico\b|\bcdmx\b|\bmonterrey\b|\bguadalajara\b|\bpuebla\b/i,
  'Argentina': /\bargentina\b|\bbuenos aires\b|\bc[oó]rdoba\b|\brosario\b/i,
  'Chile':     /\bchile\b|\bsantiago de chile\b/i,
  'Perú':      /\bper[uú]\b|\blima\b/i,
  'Colombia':  /\bcolombia\b|\bbogot[aá]\b|\bmedell[ií]n\b|\bcali\b|\bbarranquilla\b|\bcartagena\b|\bcúcuta\b|\bcucuta\b|\bbucaramanga\b|\bsanta marta\b|\bpereira\b|\bmanizales\b|\barmenia\b|colomb/i,
};

export const COLOMBIAN_COMPANIES = new Set([
  'rappi', 'bancolombia', 'davivienda', 'platzi', 'globant', 'toptal',
  'gorilla logic', 'pragma', 'smartyoga', 'laika', 'despegar',
  'mercado libre', 'stripe', 'sofka', 'ceiba', 'indigo',
  'emás', 'innovatech', 'tcs', 'infosys', 'cognizant',
  'encora', 'rvm', 'nearform', 'atom', 'four',
  'tiber', 'conquer', 'ksquare', 'sygnum', 'giftio',
  'xometry', 'zocket', 'flo', 'betterfly', 'belvo',
]);

export function isColombian(job: Job): boolean {
  const companyLower = job.company.toLowerCase();
  if (COLOMBIAN_COMPANIES.has(companyLower)) return true;
  const text = [job.location, job.company, job.description || ''].join(' ').toLowerCase();
  return /\bcolombia\b|bogot|medell|cali\b|barranquilla|cartagena|colombian/i.test(text);
}

export function detectJobCountry(job: Job): string {
  const text = [job.location, job.company, job.description || ''].join(' ');
  for (const [country, pattern] of Object.entries(COUNTRY_PATTERNS)) {
    if (pattern.test(text)) return country;
  }
  return '';
}

export function hasInternationalSignal(job: Job): boolean {
  const all = (job.title + ' ' + (job.description || '')).toLowerCase();
  return REGEX_PATTERNS.latam.test(all) || REGEX_PATTERNS.nearshore.test(all) ||
    /\bcolombia\b|work\s+from\s+anywhere|anywhere\s+in\s+the\s+world|worldwide\s+team|remote[- ]first|hire.{0,20}global|global.{0,20}hire/i.test(all) ||
    REGEX_PATTERNS.internationalTeam.test(all);
}

// ─── Salary parser ────────────────────────────────────────────────────────────

function normalizeAmount(raw: string, isK: boolean): number {
  const n = parseFloat(raw.replace(/,/g, ''));
  return isK ? n * 1000 : n;
}

export function parseSalary(text: string): JobSalary | undefined {
  if (!text) return undefined;

  let m: RegExpMatchArray | null;

  if ((m = text.match(REGEX_PATTERNS.usdKTo)))    return { min: normalizeAmount(m[1]!, true),  max: normalizeAmount(m[2]!, true),  currency: 'USD', raw: m[0] };
  if ((m = text.match(REGEX_PATTERNS.usdKRange))) return { min: normalizeAmount(m[1]!, true),  max: normalizeAmount(m[2]!, true),  currency: 'USD', raw: m[0] };
  if ((m = text.match(REGEX_PATTERNS.usdRange)))  return { min: normalizeAmount(m[1]!, false), max: normalizeAmount(m[2]!, false), currency: 'USD', raw: m[0] };
  if ((m = text.match(REGEX_PATTERNS.usdSingleK)))return { min: normalizeAmount(m[1]!, true),  currency: 'USD', raw: m[0] };
  if ((m = text.match(REGEX_PATTERNS.usdSingle))) {
    const val = normalizeAmount(m[1]!, false);
    if (val < 500) return undefined;
    return { min: val, currency: 'USD', raw: m[0] };
  }
  if ((m = text.match(REGEX_PATTERNS.copRange)))  return { min: normalizeAmount(m[1]!, false), max: normalizeAmount(m[2]!, false), currency: 'COP', raw: m[0] };

  return undefined;
}

export function isBelowMinSalary(job: Job, minUsd: number): boolean {
  const s = job.salary;
  if (!s) return false; // no salary info → don't filter out
  if (s.currency === 'COP') {
    // rough COP→USD: 4200 COP = 1 USD
    const maxCop = s.max ?? s.min ?? 0;
    return maxCop / 4200 < minUsd;
  }
  const maxUsd = s.max ?? s.min ?? 0;
  return maxUsd > 0 && maxUsd < minUsd;
}

// ─── Hybrid / on-site detection ───────────────────────────────────────────────

export function isHybridOrOnSite(job: Job): boolean {
  const text = ((job.location ?? '') + ' ' + (job.description ?? '')).toLowerCase();

  if (REGEX_PATTERNS.onSiteRequired.test(text)) return true;
  if (REGEX_PATTERNS.daysInOffice.test(text)) return true;
  if (REGEX_PATTERNS.daysPerWeek.test(text)) return true;
  if (REGEX_PATTERNS.flexibleHybrid.test(text)) return true;
  if (REGEX_PATTERNS.hybrid.test(job.location)) return true;

  return false;
}

// ─── Job exclusion ────────────────────────────────────────────────────────────

export function isExcludedJob(job: Job, blockedCompanies?: string[]): { excluded: boolean; reason: string } {
  if (blockedCompanies && blockedCompanies.length > 0) {
    const companyNorm = job.company.toLowerCase().trim();
    const blocked = blockedCompanies.find(b => companyNorm.includes(b.toLowerCase().trim()));
    if (blocked) return { excluded: true, reason: `empresa bloqueada (${job.company})` };
  }
  const country = detectJobCountry(job);

  if (country === 'Brasil') return { excluded: true, reason: 'oferta de Brasil' };
  if (country === 'España') return { excluded: true, reason: 'oferta de España (zona horaria incompatible)' };

  const desc = (job.description || '').toLowerCase();

  if (job.sourceLocation === 'United States' && REGEX_PATTERNS.usPresenceRequired.test(desc)) {
    return { excluded: true, reason: 'requiere presencia/autorización en EEUU' };
  }

  if (REGEX_PATTERNS.estOnlyTimezone.test(desc) && !isColombian(job)) {
    return { excluded: true, reason: 'requiere EST timezone (no colombiano)' };
  }

  const countryRestrictions: Array<{ pattern: RegExp; country: string }> = [
    { pattern: REGEX_PATTERNS.mexicoOnly, country: 'México' },
    { pattern: REGEX_PATTERNS.argentinaOnly, country: 'Argentina' },
    { pattern: REGEX_PATTERNS.chileOnly, country: 'Chile' },
    { pattern: REGEX_PATTERNS.peruOnly, country: 'Perú' },
  ];
  for (const r of countryRestrictions) {
    if (r.pattern.test(desc)) return { excluded: true, reason: `restricción a ${r.country}` };
  }

  return { excluded: false, reason: '' };
}
