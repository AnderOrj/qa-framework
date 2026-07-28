import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import fs from 'fs';
import type { Job } from './utils/types.js';
import { isColombian, isHybridOrOnSite } from './utils/filters.js';

dotenv.config();

const jobs: Job[] = JSON.parse(fs.readFileSync('./jobs.json', 'utf-8'));

const today = new Date();
today.setHours(0, 0, 0, 0);

const colombianJobsToday = jobs
  .filter(job => {
    const posted = new Date(job.datePosted);
    posted.setHours(0, 0, 0, 0);
    return posted.getTime() === today.getTime() && isColombian(job);
  })
  .sort((a, b) => (b.score || 0) - (a.score || 0));

if (colombianJobsToday.length === 0) {
  console.log('📭 No hay jobs colombianos nuevos hoy');
  process.exit(0);
}

const stars = (score: number | undefined) => {
  if (!score) return '⭐';
  if (score >= 65) return '⭐⭐⭐';
  if (score >= 35) return '⭐⭐';
  return '⭐';
};

const getModality = (job: Job) => {
  const all = (job.location + ' ' + (job.description || '')).toLowerCase();
  if (/remoto|remote/.test(all)) return { emoji: '🌐', text: 'Remoto' };
  if (isHybridOrOnSite(job)) {
    if (/híbrido|hybrid/.test(all)) return { emoji: '🏢', text: 'Híbrido' };
    return { emoji: '📍', text: 'On-Site' };
  }
  return { emoji: '❓', text: 'No especificado' };
};

const groupByCompany = (jobs: Job[]) => {
  const grouped: Record<string, Job[]> = {};
  jobs.forEach(job => {
    if (!grouped[job.company]) grouped[job.company] = [];
    grouped[job.company].push(job);
  });
  return grouped;
};

let html = `
<html dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
      line-height: 1.5;
      font-size: 16px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border-radius: 12px;
    }
    h1 {
      color: #0f766e;
      border-bottom: 3px solid #14b8a6;
      padding-bottom: 15px;
      margin-bottom: 20px;
      font-size: 24px;
    }
    .summary {
      background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 25px;
      border-left: 5px solid #10b981;
    }
    .summary p {
      color: #065f46;
      font-weight: 600;
      margin: 5px 0;
      font-size: 15px;
    }
    .company-section { margin: 25px 0; }
    .company-title {
      color: #0f766e;
      font-size: 16px;
      font-weight: 700;
      margin: 25px 0 15px 0;
      border-left: 4px solid #14b8a6;
      padding-left: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .job-card {
      border: 1px solid #e5e7eb;
      padding: 16px;
      margin: 12px 0;
      border-radius: 8px;
      background: white;
      border-left: 4px solid #14b8a6;
      page-break-inside: avoid;
    }
    .job-title {
      font-size: 16px;
      font-weight: 700;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .job-title a {
      color: #0d9488;
      text-decoration: none;
      font-weight: 600;
    }
    .job-title a:hover {
      text-decoration: underline;
    }
    .top-badge {
      display: inline-block;
      background: #fbbf24;
      color: #78350f;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      margin-left: 8px;
    }
    .job-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      font-size: 13px;
      color: #374151;
      margin: 10px 0;
      font-weight: 500;
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .job-description {
      background: #f9fafb;
      padding: 12px;
      border-radius: 6px;
      margin: 12px 0 0 0;
      font-size: 14px;
      color: #374151;
      line-height: 1.6;
      border: 1px solid #f3f4f6;
    }
    .job-description strong {
      display: block;
      color: #1f2937;
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .job-score {
      display: inline-block;
      background: #dbeafe;
      color: #0c4a6e;
      padding: 4px 10px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 13px;
    }
    .footer {
      text-align: center;
      color: #6b7280;
      font-size: 12px;
      margin-top: 30px;
      border-top: 1px solid #e5e7eb;
      padding-top: 20px;
    }
    @media (max-width: 600px) {
      .container { padding: 12px; }
      h1 { font-size: 20px; }
      .job-meta { grid-template-columns: 1fr; gap: 8px; }
      .job-card { padding: 12px; margin: 10px 0; }
      .job-title { font-size: 15px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🇨🇴 Resumen QA Jobs - Colombia</h1>

    <div class="summary">
      <p>✅ ${colombianJobsToday.length} ofertas colombianas encontradas hoy</p>
      <p>📅 ${today.toLocaleDateString('es-CO')}</p>
    </div>
`;

const topJobs = colombianJobsToday.filter(j => (j.score || 0) >= 65);
const mediumJobs = colombianJobsToday.filter(j => (j.score || 0) >= 35 && (j.score || 0) < 65);
const otherJobs = colombianJobsToday.filter(j => (j.score || 0) < 35);

const renderJobCard = (job: Job) => {
  const modality = getModality(job);
  const description = job.description ? job.description.substring(0, 250).trim() : '';
  const descriptionHtml = description ? `<div class="job-description"><strong>Descripción:</strong>${description}${job.description && job.description.length > 250 ? '...' : ''}</div>` : '';
  return `
    <div class="job-card">
      <div class="job-title"><a href="${job.link}" target="_blank">${job.title}</a></div>
      <div class="job-meta">
        <div class="meta-item">🏢 <strong>${job.company}</strong></div>
        <div class="meta-item">📌 ${job.location}</div>
        <div class="meta-item">${modality.emoji} ${modality.text}</div>
        <div class="meta-item"><span class="job-score">${stars(job.score)} ${job.score} pts</span></div>
      </div>
      ${descriptionHtml}
    </div>`;
};

if (topJobs.length > 0) {
  html += '<div class="company-section"><div class="company-title">⭐⭐⭐ Muy Relevantes (' + topJobs.length + ')</div>';
  topJobs.forEach(job => {
    const modality = getModality(job);
    const description = job.description ? job.description.substring(0, 300).trim() : '';
    const descriptionHtml = description ? `<div class="job-description"><strong>Descripción:</strong> ${description}${job.description && job.description.length > 300 ? '...' : ''}</div>` : '';
    html += `
    <div class="job-card">
      <div class="job-title"><a href="${job.link}" target="_blank">${job.title}</a> <span class="top-badge">TOP</span></div>
      <div class="job-meta">
        <div class="meta-item">🏢 <strong>${job.company}</strong></div>
        <div class="meta-item">📌 ${job.location}</div>
        <div class="meta-item">${modality.emoji} ${modality.text}</div>
        <div class="meta-item"><span class="job-score">${stars(job.score)} ${job.score} pts</span></div>
      </div>
      ${descriptionHtml}
    </div>`;
  });
  html += '</div>';
}

if (mediumJobs.length > 0) {
  html += '<div class="company-section"><div class="company-title">⭐⭐ Relevantes (' + mediumJobs.length + ')</div>';
  mediumJobs.forEach(job => {
    const modality = getModality(job);
    const description = job.description ? job.description.substring(0, 250).trim() : '';
    const descriptionHtml = description ? `<div class="job-description"><strong>Descripción:</strong> ${description}${job.description && job.description.length > 250 ? '...' : ''}</div>` : '';
    html += `
    <div class="job-card">
      <div class="job-title"><a href="${job.link}" target="_blank">${job.title}</a></div>
      <div class="job-meta">
        <div class="meta-item">🏢 <strong>${job.company}</strong></div>
        <div class="meta-item">📌 ${job.location}</div>
        <div class="meta-item">${modality.emoji} ${modality.text}</div>
        <div class="meta-item"><span class="job-score">${stars(job.score)} ${job.score} pts</span></div>
      </div>
      ${descriptionHtml}
    </div>`;
  });
  html += '</div>';
}

if (otherJobs.length > 0) {
  html += '<div class="company-section"><div class="company-title">⭐ Para Revisar (' + otherJobs.length + ')</div>';
  otherJobs.forEach(job => {
    const modality = getModality(job);
    const description = job.description ? job.description.substring(0, 200).trim() : '';
    const descriptionHtml = description ? `<div class="job-description"><strong>Descripción:</strong> ${description}${job.description && job.description.length > 200 ? '...' : ''}</div>` : '';
    html += `
    <div class="job-card">
      <div class="job-title"><a href="${job.link}" target="_blank">${job.title}</a></div>
      <div class="job-meta">
        <div class="meta-item">🏢 <strong>${job.company}</strong></div>
        <div class="meta-item">📌 ${job.location}</div>
        <div class="meta-item">${modality.emoji} ${modality.text}</div>
        <div class="meta-item"><span class="job-score">${stars(job.score)} ${job.score} pts</span></div>
      </div>
      ${descriptionHtml}
    </div>`;
  });
  html += '</div>';
}

html += `
    <div class="footer">
      <p>LinkedIn QA Job Scraper | Colombia Focus | ${new Date().toLocaleString('es-CO')}</p>
    </div>
  </div>
</body>
</html>
`;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const mailOptions = {
  from: process.env.SMTP_USER,
  to: process.env.EMAIL_TO,
  subject: `🇨🇴 Resumen Diario: ${colombianJobsToday.length} jobs QA en Colombia - ${today.toLocaleDateString('es-CO')}`,
  html: html,
};

transporter.sendMail(mailOptions, (err, info) => {
  if (err) {
    console.error('❌ Error enviando resumen:', err);
    process.exit(1);
  } else {
    console.log('✅ Resumen enviado a:', mailOptions.to);
    console.log('📊 Jobs colombianos:', colombianJobsToday.length);
    console.log(`   ⭐⭐⭐ ${topJobs.length} muy relevantes`);
    console.log(`   ⭐⭐ ${mediumJobs.length} relevantes`);
    console.log(`   ⭐ ${otherJobs.length} para revisar`);
  }
});
