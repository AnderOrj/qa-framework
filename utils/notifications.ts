import nodemailer from 'nodemailer';
import twilio from 'twilio';
import type { Job } from './types.js';
import { buildJobsEmailHtml } from './email.js';
import { scoreStars } from './scoring.js';
import { logError, logInfo } from './logger.js';
import { DELAYS } from './scraper-config.js';

export async function sendEmail(subject: string, html: string): Promise<void> {
  const to = process.env.EMAIL_TO;
  if (!to) {
    console.warn('⚠️  sendEmail: EMAIL_TO no configurado — email no enviado.');
    return;
  }
  await sendEmailTo(to, subject, html);
}

export async function sendEmailTo(to: string, subject: string, html: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !to) {
    console.warn('⚠️  sendEmailTo: faltan vars SMTP en el entorno — email no enviado.');
    return;
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user, pass },
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const info = await transporter.sendMail({ from: `"LinkedIn Scraper QA" <${user}>`, to, subject, html });
      logInfo(`Email enviado a ${to}. ID: ${info.messageId}`);
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        logError('sendEmailTo (final attempt)', error);
      } else {
        const delay = 2000 * attempt;
        console.log(`⚠️  Intento ${attempt}/${maxRetries} falló — reintentando en ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}

export function formatWhatsAppMessages(jobs: Job[], label: string): string[] {
  if (jobs.length === 0) return [];

  const timestamp = new Date().toLocaleString('es-CO');
  const total = jobs.length;
  const messages: string[] = [];

  for (let i = 0; i < total; i += 10) {
    const block = jobs.slice(i, i + 10);
    const blockNum = Math.floor(i / 10) + 1;
    const totalBlocks = Math.ceil(total / 10);

    const summary = block.map((job, idx) => {
      const desc   = job.description ? `\n📝 ${job.description.substring(0, 60)}...` : '';
      const date   = job.datePosted  ? `\n📅 ${job.datePosted}` : '';
      const source = job.sourceLocation ? ` · 🌎 ${job.sourceLocation}` : '';
      return `${i + idx + 1}. ${scoreStars(job.score ?? 0)} *${job.title}*\n🏢 ${job.company}\n📍 ${job.location}${source}${date}${desc}\n🔗 ${job.link}`;
    }).join('\n\n');

    const blockLabel = totalBlocks > 1 ? ` [${blockNum}/${totalBlocks}]` : '';
    let msg = `🚀 *${label}* (${total} encontradas)${blockLabel}\n_${timestamp}_\n\n${summary}`;
    if (msg.length > 1500) msg = msg.substring(0, 1497) + '...';
    messages.push(msg);
  }

  return messages;
}

async function sendWhatsApp(messages: string[]): Promise<void> {
  const accountSid  = process.env.TWILIO_ACCOUNT_SID;
  const authToken   = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber  = process.env.TWILIO_WHATSAPP_FROM;
  const toNumbers   = (process.env.WHATSAPP_TO || '').split(',').map(n => n.trim()).filter(Boolean);

  if (!accountSid || !authToken || !fromNumber || toNumbers.length === 0) return;

  const client = twilio(accountSid, authToken);
  for (const toNumber of toNumbers) {
    for (const message of messages) {
      try {
        const result = await client.messages.create({ body: message, from: fromNumber, to: toNumber });
        logInfo(`WhatsApp enviado a ${toNumber}. SID: ${result.sid}`);
        if (messages.length > 1) await new Promise(r => setTimeout(r, DELAYS.whatsapp));
      } catch (error) {
        logError(`WhatsApp → ${toNumber}`, error);
      }
    }
  }
}

export async function notifyNewJobs(jobs: Job[], label: string): Promise<void> {
  if (jobs.length === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] No new jobs found.`);
    return;
  }

  console.log(`[${new Date().toLocaleTimeString()}] Sending ${jobs.length} jobs — ${label}`);
  jobs.forEach(job => console.log(`✓ ${job.title} at ${job.company} (${job.location})`));

  const whatsappEnabled = process.env.WHATSAPP_ENABLED !== 'false';
  if (whatsappEnabled) {
    await sendWhatsApp(formatWhatsAppMessages(jobs, label));
  } else {
    console.log('📵 WhatsApp desactivado (WHATSAPP_ENABLED=false) — solo correo.');
  }

  await sendEmail(
    `🚀 ${label} (${jobs.length} oferta${jobs.length !== 1 ? 's' : ''})`,
    buildJobsEmailHtml(jobs, label)
  );
}

export async function notifyError(message: string): Promise<void> {
  if (process.env.WHATSAPP_ENABLED !== 'false') {
    await sendWhatsApp([message]);
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

// Alertas críticas — siempre envía WhatsApp + email sin importar WHATSAPP_ENABLED
export async function notifyCritical(subject: string, message: string): Promise<void> {
  const ts = new Date().toLocaleString('es-CO');
  logInfo(`🚨 ALERTA CRÍTICA: ${subject}`);

  // WhatsApp siempre, independiente de WHATSAPP_ENABLED
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;
  const toNumbers  = (process.env.WHATSAPP_TO || '').split(',').map(n => n.trim()).filter(Boolean);

  if (accountSid && authToken && fromNumber && toNumbers.length > 0) {
    const twilio_ = twilio(accountSid, authToken);
    for (const to of toNumbers) {
      try {
        await twilio_.messages.create({ body: `🚨 *${subject}*\n_${ts}_\n\n${message}`, from: fromNumber, to });
        logInfo(`WhatsApp crítico enviado a ${to}`);
      } catch (e) {
        logError(`WhatsApp crítico → ${to}`, e);
      }
    }
  }

  await sendEmail(
    `🚨 CRÍTICO: ${subject}`,
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border:2px solid #dc2626;border-radius:8px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:16px 20px">
        <div style="font-size:18px;font-weight:800">🚨 ${subject}</div>
        <div style="font-size:12px;opacity:0.85;margin-top:4px">${ts}</div>
      </div>
      <div style="padding:20px;background:#fef2f2">
        <pre style="background:#fff;border:1px solid #fecaca;color:#991b1b;padding:14px;border-radius:6px;white-space:pre-wrap;font-size:13px;line-height:1.6;margin:0">${message}</pre>
      </div>
      <div style="padding:12px 20px;background:#fff;font-size:12px;color:#6b7280">
        Acción requerida: <code>npx tsx linkedin-login.ts</code> para renovar sesión
      </div>
    </div>`
  );
}
