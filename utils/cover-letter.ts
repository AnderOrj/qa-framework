import Anthropic from '@anthropic-ai/sdk';
import type { Job, CvProfile } from './types.js';
import { logInfo, logError } from './logger.js';
import { sendEmailTo } from './notifications.js';
import { loadCvProfile } from './scoring.js';

function buildCvSummary(profile: CvProfile): string {
  const parts: string[] = [];
  if (profile.name || profile.title) parts.push(`${profile.name ?? ''} — ${profile.title ?? ''}`.trim());
  if (profile.yearsOfExperience || profile.location || profile.languages) {
    parts.push([profile.yearsOfExperience ? `${profile.yearsOfExperience} años de experiencia` : '', profile.location, profile.languages].filter(Boolean).join(' | '));
  }
  if (profile.summary) parts.push(profile.summary);
  parts.push(`Skills: ${profile.skills.join(', ')}`);
  return parts.join('\n');
}

export async function generateAndSendCoverLetter(job: Job): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logInfo('Cover letter: ANTHROPIC_API_KEY no configurado — skip');
    return;
  }

  const to = process.env.EMAIL_COVER_LETTER ?? '';
  if (!to) {
    logInfo('Cover letter: EMAIL_COVER_LETTER no configurado — skip');
    return;
  }

  const profile = loadCvProfile();
  if (!profile) {
    logInfo('Cover letter: cv-profile.json no encontrado — skip');
    return;
  }

  try {
    logInfo(`Cover letter: generando para "${job.title}" @ ${job.company}...`);

    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
    const message = await client.messages.create({
      model,
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `Generate a professional cover letter in English for the following job opening.

CANDIDATE PROFILE:
${buildCvSummary(profile)}

JOB OPENING:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description: ${(job.description ?? 'Not available').substring(0, 1200)}

INSTRUCTIONS:
- Maximum 250 words
- Professional but warm tone
- Highlight skills most relevant to THIS specific role
- Mention remote work capability and US client experience when relevant
- End with a clear call-to-action
- Do NOT include date, address, or signature
- Start directly with "Dear Hiring Team," or a specific salutation if company name suggests it
- Focus on impact and results, not just responsibilities`,
      }],
    });

    const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
    if (!text) {
      logInfo('Cover letter: respuesta vacía de Claude — skip');
      return;
    }

    await sendEmailTo(
      to,
      `📝 Cover Letter: ${job.title} @ ${job.company} (${job.score ?? 0} pts ⭐⭐⭐)`,
      buildCoverLetterHtml(job, text),
    );

    logInfo(`Cover letter enviada a ${to}: "${job.title}" @ ${job.company}`);
  } catch (error) {
    logError('generateAndSendCoverLetter', error);
  }
}

function buildCoverLetterHtml(job: Job, letter: string): string {
  const ts = new Date().toLocaleString('es-CO');
  const letterHtml = letter
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => `<p style="margin:0 0 12px;color:#374151;line-height:1.75;font-size:14px">${l}</p>`)
    .join('');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:680px;margin:auto;background:#f8fafc;padding:20px">
      <div style="background:linear-gradient(135deg,#0077B5 0%,#005c8e 100%);color:#fff;padding:18px 22px;border-radius:10px;margin-bottom:16px">
        <div style="font-size:18px;font-weight:700">📝 Cover Letter Generada con IA</div>
        <div style="font-size:12px;opacity:0.85;margin-top:4px">${ts}</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;margin-bottom:14px">
        <div style="font-size:15px;font-weight:700;color:#1e293b">${job.title}</div>
        <div style="font-size:13px;color:#64748b;margin-top:3px">${job.company} · ${job.location}</div>
        <div style="margin-top:8px">
          <span style="background:#dcfce7;color:#15803d;border:1px solid #16a34a;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">⭐⭐⭐ ${job.score ?? 0} pts</span>
          <a href="${job.link}" style="display:inline-block;margin-left:8px;background:#0077B5;color:#fff;padding:4px 12px;border-radius:5px;text-decoration:none;font-size:12px;font-weight:600">Ver oferta →</a>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:22px 24px">
        ${letterHtml}
      </div>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;margin-top:12px;font-size:12px;color:#92400e">
        💡 Generada automáticamente por Claude AI. Revisá y personalizá antes de enviar.
      </div>
      <div style="text-align:center;font-size:11px;color:#94a3b8;padding-top:12px">
        LinkedIn Scraper · Anderson Orjuela · Bogotá, Colombia
      </div>
    </div>`;
}
