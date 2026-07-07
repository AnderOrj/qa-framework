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
  <style>
    body { font-family: Arial, sans-serif; color: #333; background: #f5f5f5; }
    .container { max-width: 900px; margin: 20px auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #1f2937; border-bottom: 3px solid #0066cc; padding-bottom: 10px; }
    .summary { background: #dcfce7; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #16a34a; }
    .company-section { margin: 30px 0; }
    .company-title { color: #16a34a; font-size: 18px; font-weight: bold; margin: 20px 0 10px 0; border-left: 4px solid #16a34a; padding-left: 10px; }
    .job-card { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; background: #fafafa; }
    .job-card:hover { background: #f0f7ff; border-color: #0066cc; }
    .job-title { font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 5px; }
    .job-title a { color: #0066cc; text-decoration: none; }
    .job-title a:hover { text-decoration: underline; }
    .job-meta { display: flex; gap: 15px; flex-wrap: wrap; font-size: 14px; color: #666; margin: 8px 0; }
    .job-score { display: inline-block; background: #d4edda; color: #155724; padding: 3px 8px; border-radius: 3px; font-weight: bold; }
    .top-badge { display: inline-block; background: #fbbf24; color: #78350f; padding: 4px 8px; border-radius: 3px; font-size: 12px; font-weight: bold; margin-left: 8px; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🇨🇴 Resumen QA Jobs - Colombia</h1>

    <div class="summary">
      <p><strong>✅ ${colombianJobsToday.length} ofertas colombianas encontradas hoy</strong></p>
      <p><strong>📅 ${today.toLocaleDateString('es-CO')}</strong></p>
    </div>
`;

const topJobs = colombianJobsToday.filter(j => (j.score || 0) >= 65);
const mediumJobs = colombianJobsToday.filter(j => (j.score || 0) >= 35 && (j.score || 0) < 65);
const otherJobs = colombianJobsToday.filter(j => (j.score || 0) < 35);

if (topJobs.length > 0) {
  html += '<div class="company-section"><div class="company-title">⭐⭐⭐ Muy Relevantes (' + topJobs.length + ')</div>';
  topJobs.forEach(job => {
    const modality = getModality(job);
    html += `
    <div class="job-card">
      <div class="job-title"><a href="${job.link}" target="_blank">${job.title}</a> <span class="top-badge">TOP</span></div>
      <div class="job-meta">
        <span>🏢 ${job.company}</span>
        <span>📌 ${job.location}</span>
        <span>${modality.emoji} ${modality.text}</span>
        <span class="job-score">${stars(job.score)} ${job.score} pts</span>
      </div>
    </div>`;
  });
  html += '</div>';
}

if (mediumJobs.length > 0) {
  html += '<div class="company-section"><div class="company-title">⭐⭐ Relevantes (' + mediumJobs.length + ')</div>';
  mediumJobs.forEach(job => {
    const modality = getModality(job);
    html += `
    <div class="job-card">
      <div class="job-title"><a href="${job.link}" target="_blank">${job.title}</a></div>
      <div class="job-meta">
        <span>🏢 ${job.company}</span>
        <span>📌 ${job.location}</span>
        <span>${modality.emoji} ${modality.text}</span>
        <span class="job-score">${stars(job.score)} ${job.score} pts</span>
      </div>
    </div>`;
  });
  html += '</div>';
}

if (otherJobs.length > 0) {
  html += '<div class="company-section"><div class="company-title">⭐ Para Revisar (' + otherJobs.length + ')</div>';
  otherJobs.forEach(job => {
    const modality = getModality(job);
    html += `
    <div class="job-card">
      <div class="job-title"><a href="${job.link}" target="_blank">${job.title}</a></div>
      <div class="job-meta">
        <span>🏢 ${job.company}</span>
        <span>📌 ${job.location}</span>
        <span>${modality.emoji} ${modality.text}</span>
        <span class="job-score">${stars(job.score)} ${job.score} pts</span>
      </div>
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
