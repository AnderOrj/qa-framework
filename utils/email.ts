import type { Job } from './types.js';
import { scoreAccent } from './scoring.js';
import { REGEX_PATTERNS } from './regex-patterns.js';

export function parseJobDescription(raw: string): string {
  if (!raw.trim()) {
    return '<p style="color:#9ca3af;font-style:italic;margin:0">Sin descripción disponible.</p>';
  }

  // Insert line breaks before known section headers embedded in wall-of-text descriptions
  let text = raw.trim();
  text = text.replace(
    /([^\n])\s*(?=(?:Requisitos|Requirements|Responsabilidades|Funciones y responsabilidades|Responsibilities|Funciones|Deseables?|Nice[\s-]to[\s-]have|Habilidades(?: complementarias)?|Skills|Beneficios|Benefits|Ofrecemos|We offer|About the role|About us|Sobre nosotros|Position Description|Job Description|Descripción del (?:cargo|puesto|rol)|Qualifications|Perfil(?: requerido)?|Lo que buscamos|Lo que ofrecemos|Conocimientos?)[^:\n]{0,40}:)/gi,
    '$1\n\n'
  );

  const lines = text.replace(/\n{3,}/g, '\n\n').split('\n').map(l => l.trim()).filter(Boolean);
  const html: string[] = [];
  const bullets: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    const lis = bullets.map(b => `<li style="margin:5px 0;color:#374151;line-height:1.6;padding-left:2px">${b}</li>`).join('');
    html.push(`<ul style="margin:6px 0 12px 20px;padding:0">${lis}</ul>`);
    bullets.length = 0;
  };

  const sectionHeader = (t: string) =>
    `<p style="margin:16px 0 6px;font-size:11px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:2px solid #e2e8f0;padding-bottom:5px">${t}</p>`;

  const splitSentences = (t: string) =>
    t.split(/\.\s+(?=[A-ZÁÉÍÓÚÑ])/).map(s => s.trim().replace(/\.$/, '')).filter(Boolean);

  for (const line of lines) {
    const bulletMatch = line.match(/^[•\-\*·]\s+(.+)/) ?? line.match(/^\d+[.)]\s+(.+)/);
    if (bulletMatch) { bullets.push(bulletMatch[1] ?? line); continue; }

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

    if (line.endsWith(':') && line.length <= 80 && !line.includes('.')) {
      flushBullets();
      html.push(sectionHeader(line.slice(0, -1)));
      continue;
    }

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

function buildJobCard(job: Job): string {
  const score  = job.score ?? 0;
  const accent = scoreAccent(score);

  const meta: string[] = [];
  if (job.datePosted) meta.push(`📅 ${job.datePosted}`);
  if (job.detectedCountry) meta.push(`🌍 ${job.detectedCountry}`);
  if (job.sourceLocation && job.sourceLocation !== job.detectedCountry) meta.push(`🔍 ${job.sourceLocation}`);
  if (REGEX_PATTERNS.remote.test(job.location + ' ' + (job.description || ''))) meta.push('🌐 Remote');
  if (job.salary) meta.push(`💰 ${job.salary.raw}`);

  const metaHtml = meta.length > 0
    ? `<div style="margin-top:8px">${meta.map(t =>
        `<span style="display:inline-block;background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;font-size:11px;padding:2px 8px;border-radius:20px;margin:2px 4px 2px 0">${t}</span>`
      ).join('')}</div>`
    : '';

  return `
    <div style="border:1px solid #cbd5e1;border-left:4px solid ${accent.border};border-radius:0 8px 8px 0;margin-bottom:14px;overflow:hidden;background:#ffffff">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr>
            <td style="vertical-align:top;padding-right:14px">
              <div style="font-size:15px;font-weight:700;color:#1e293b;line-height:1.3">${job.title}</div>
              <div style="font-size:13px;color:#64748b;margin-top:4px">
                <strong style="color:#334155">${job.company}</strong>
                <span style="color:#94a3b8"> &nbsp;|&nbsp; </span>
                <span>${job.location}</span>
              </div>
              ${metaHtml}
            </td>
            <td style="vertical-align:top;width:130px;min-width:130px">
              <a href="${job.link}" style="display:block;background:#0077B5;color:#ffffff;padding:9px 0;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;text-align:center;white-space:nowrap">Ver oferta →</a>
              <div style="margin-top:6px;text-align:center">
                <span style="display:inline-block;background:${accent.badgeBg};color:${accent.badgeText};border:2px solid ${accent.border};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">${accent.stars} ${score} pts</span>
              </div>
            </td>
          </tr>
        </table>
      </div>
      <div style="padding:14px 16px;font-size:13px;background:#f8fafc;border-top:1px solid #e2e8f0">
        ${parseJobDescription(job.description || '')}
      </div>
    </div>`;
}

function sectionHeader(title: string, count: number, color: string, emoji: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:24px 0 12px;background:${color};border-radius:8px;border:1px solid #e2e8f0">
      <tr>
        <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#1e293b">${emoji} ${title}</td>
        <td style="padding:10px 16px;text-align:right;white-space:nowrap">
          <span style="background:#ffffff;color:#334155;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;border:1px solid #cbd5e1">${count} oferta${count !== 1 ? 's' : ''}</span>
        </td>
      </tr>
    </table>`;
}

export function buildJobsEmailHtml(jobs: Job[], label: string): string {
  const timestamp = new Date().toLocaleString('es-CO');

  const colombia = jobs.filter(j => j.sourceLocation === 'Colombia');
  const latam    = jobs.filter(j => j.sourceLocation && j.sourceLocation !== 'Colombia' && j.sourceLocation !== 'United States');
  const us       = jobs.filter(j => j.sourceLocation === 'United States');
  const other    = jobs.filter(j => !j.sourceLocation);

  const allCombined = [...colombia, ...latam, ...other, ...us];

  let sectionsHtml = '';

  if (colombia.length > 0) {
    sectionsHtml += sectionHeader('Colombia', colombia.length, '#e0f2fe', '🇨🇴');
    sectionsHtml += colombia.map(buildJobCard).join('');
  }
  if (latam.length > 0) {
    sectionsHtml += sectionHeader('LATAM / Remote', latam.length, '#f0fdf4', '🌎');
    sectionsHtml += latam.map(buildJobCard).join('');
  }
  if (other.length > 0) {
    sectionsHtml += other.map(buildJobCard).join('');
  }
  if (us.length > 0) {
    sectionsHtml += sectionHeader('United States (Remote)', us.length, '#fefce8', '🇺🇸');
    sectionsHtml += us.map(buildJobCard).join('');
  }

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#e8ecf1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
      <tr>
        <td align="center" style="padding:20px 10px">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:740px">
            <tr>
              <td style="background:linear-gradient(135deg,#0077B5 0%,#005c8e 100%);color:#ffffff;padding:20px 24px;border-radius:10px;mso-border-radius:10px">
                <div style="font-size:20px;font-weight:700;margin:0;color:#ffffff">🚀 ${label}</div>
                <div style="font-size:13px;color:#e0f0ff;margin-top:6px">
                  ${timestamp} &nbsp;·&nbsp; ${allCombined.length} oferta${allCombined.length !== 1 ? 's' : ''}
                </div>
                <div style="margin-top:10px;font-size:11px;color:#c8e4f8">
                  ${colombia.length > 0 ? `<span style="margin-right:14px">🇨🇴 Colombia: <strong style="color:#ffffff">${colombia.length}</strong></span>` : ''}
                  ${latam.length    > 0 ? `<span style="margin-right:14px">🌎 LATAM: <strong style="color:#ffffff">${latam.length}</strong></span>` : ''}
                  ${us.length       > 0 ? `<span>🇺🇸 US Remote: <strong style="color:#ffffff">${us.length}</strong></span>` : ''}
                </div>
                <div style="margin-top:8px;font-size:11px;color:#c8e4f8">
                  <span style="margin-right:12px">⭐⭐⭐ ≥ 65 pts &nbsp; Muy relevante</span>
                  <span style="margin-right:12px">⭐⭐ ≥ 35 pts &nbsp; Relevante</span>
                  <span>⭐ &lt; 35 pts &nbsp; Revisar</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding-top:0">
                ${sectionsHtml}
              </td>
            </tr>
            <tr>
              <td style="text-align:center;font-size:11px;color:#64748b;padding:12px 0 4px">
                LinkedIn Job Scraper · Anderson Orjuela · Bogotá, Colombia
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}
