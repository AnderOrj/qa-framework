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
  return /\blatam\b|latin\s+america|nearshore|\bcolombia\b|work\s+from\s+anywhere|anywhere\s+in\s+the\s+world|open\s+to\s+international|global\s+(remote\s+)?team|international\s+team|distributed\s+team|worldwide\s+team|remote[- ]first|hire.{0,20}global|global.{0,20}hire/.test(all);
}

// ─── Salary parser ────────────────────────────────────────────────────────────

function normalizeAmount(raw: string, isK: boolean): number {
  const n = parseFloat(raw.replace(/,/g, ''));
  return isK ? n * 1000 : n;
}

export function parseSalary(text: string): JobSalary | undefined {
  if (!text) return undefined;

  // USD range with k suffix: $80k-$120k / $80K – $120K
  const usdKRange = /\$\s*(\d+(?:\.\d+)?)\s*[kK]\s*[-–—]\s*\$?\s*(\d+(?:\.\d+)?)\s*[kK]/;
  // USD range full: $80,000 - $120,000
  const usdRange  = /\$\s*([\d,]+)\s*[-–—]\s*\$?\s*([\d,]+)/;
  // USD range word: $80k to $120k
  const usdKTo    = /\$\s*(\d+(?:\.\d+)?)\s*[kK]\s+to\s+\$?\s*(\d+(?:\.\d+)?)\s*[kK]/i;
  // USD single k: up to $90k / $90k
  const usdSingleK = /\$\s*(\d+(?:\.\d+)?)\s*[kK]/;
  // USD single full: $90,000
  const usdSingle  = /\$\s*([\d,]+)/;
  // COP range: COP 5.000.000 - 8.000.000 / $5.000.000 COP
  const copRange   = /(?:cop|pesos?)\s*([\d.,]+)\s*[-–—]\s*([\d.,]+)/i;

  let m: RegExpMatchArray | null;

  if ((m = text.match(usdKTo)))    return { min: normalizeAmount(m[1]!, true),  max: normalizeAmount(m[2]!, true),  currency: 'USD', raw: m[0] };
  if ((m = text.match(usdKRange))) return { min: normalizeAmount(m[1]!, true),  max: normalizeAmount(m[2]!, true),  currency: 'USD', raw: m[0] };
  if ((m = text.match(usdRange)))  return { min: normalizeAmount(m[1]!, false), max: normalizeAmount(m[2]!, false), currency: 'USD', raw: m[0] };
  if ((m = text.match(usdSingleK)))return { min: normalizeAmount(m[1]!, true),  currency: 'USD', raw: m[0] };
  if ((m = text.match(usdSingle))) {
    const val = normalizeAmount(m[1]!, false);
    if (val < 500) return undefined; // skip noise like "$5"
    return { min: val, currency: 'USD', raw: m[0] };
  }
  if ((m = text.match(copRange)))  return { min: normalizeAmount(m[1]!, false), max: normalizeAmount(m[2]!, false), currency: 'COP', raw: m[0] };

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

  // Explicit on-site / presencial
  if (/\bon[\s-]?site\s+required|\bmust\s+be\s+on[\s-]?site|\bpresencial\b|\bin[\s-]?office\s+required/.test(text)) return true;

  // Days-in-office patterns: "3 days a week in office", "2-3 days on site", "3x per week on-site"
  if (/\b[2-5]\s*[-–]?\s*[2-5]?\s*days?\s*(a\s*week|per\s*week|\/week|in[\s-]?(the\s*)?office|on[\s-]?site)\b/.test(text)) return true;
  if (/\b[2-5]\s*x\s*(a\s*week|per\s*week|\/week)\s*(in[\s-]?(the\s*)?office|on[\s-]?site)/.test(text)) return true;

  // Flexible hybrid (exige días en oficina)
  if (/flexible\s+hybrid|hybrid\s+(work|model|role|schedule|position|arrangement)/.test(text)) return true;

  // Location field already says hybrid
  if (/h[íi]brid[ao]?/.test(job.location.toLowerCase())) return true;

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

  if (job.sourceLocation === 'United States') {
    const usPresenceRequired = /must\s+be\s+authorized\s+to\s+work|authorized\s+to\s+work\s+in\s+the\s+u\.?s|u\.?s\.?\s+citizen(ship)?\s+required|green\s+card\s+required|must\s+reside\s+in\s+the\s+u\.?s|only\s+u\.?s\.?\s+residents?|legally\s+authorized\s+to\s+work\s+in\s+the\s+(u\.?s\.?|united\s+states)|must\s+be\s+(based|located)\s+in\s+the\s+(u\.?s\.?|united\s+states)|u\.?s\.?[\s-]based\s+candidates?\s+only|no\s+(visa\s+)?sponsorship\s+(available|provided|offered)|sponsorship\s+(is\s+)?not\s+(available|provided|offered)/.test(desc);
    if (usPresenceRequired) return { excluded: true, reason: 'requiere presencia/autorización en EEUU' };
  }

  // Penalizar trabajos que requieren estar en horarios EST/PST sin mencionar Colombia
  const estTimezoneOnly = /\best\s*(?:time\s*)?zone|eastern\s+time|new\s+york\s+time|hours\s+est|office\s+hours.*est/.test(desc);
  if (estTimezoneOnly && !isColombian(job)) {
    return { excluded: true, reason: 'requiere EST timezone (no colombiano)' };
  }

  const countryRestrictions = [
    { pattern: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?m[eé]xico|exclusivo\s+m[eé]xico|only\s+(for\s+)?mexico/i, country: 'México' },
    { pattern: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?argentina|exclusivo\s+argentina/i, country: 'Argentina' },
    { pattern: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?chile|exclusivo\s+chile/i, country: 'Chile' },
    { pattern: /solo\s+(para\s+)?(residentes?\s+(en\s+)?)?per[uú]|exclusivo\s+per[uú]/i, country: 'Perú' },
  ];
  for (const r of countryRestrictions) {
    if (r.pattern.test(desc)) return { excluded: true, reason: `restricción a ${r.country}` };
  }

  return { excluded: false, reason: '' };
}
