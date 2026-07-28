import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadJobs } from '../utils/store.js';
import { scoreJob, scoreStars } from '../utils/scoring.js';

const ROOT      = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE  = path.join(ROOT, 'dashboard', 'index.html');

function salaryBadge(job: Record<string, unknown>): string {
  const s = job.salary as { raw?: string } | undefined;
  if (!s?.raw) return '';
  return `<span class="salary-badge">${s.raw}</span>`;
}

function scoreColor(score: number): string {
  if (score >= 65) return '#16a34a';
  if (score >= 35) return '#2563eb';
  return '#94a3b8';
}

function starBadge(score: number): string {
  if (score >= 65) return '⭐⭐⭐';
  if (score >= 35) return '⭐⭐';
  return '⭐';
}

export function generateDashboard(): void {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear  = now.getFullYear();

  const jobs = loadJobs()
    .filter(j => {
      if (!j.savedAt) return false;
      const d = new Date(j.savedAt);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    })
    .map(j => ({ ...j, score: j.score ?? scoreJob(j) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const updatedAt = new Date().toLocaleString('es-CO');
  const top3      = jobs.slice(0, 3);
  const companies = [...new Set(jobs.map(j => j.company))].sort();
  const locations = [...new Set(jobs.map(j => j.sourceLocation ?? j.location).filter(Boolean))].sort();

  const jobsJson = JSON.stringify(jobs);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>QA Job Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f1f5f9;color:#1e293b;font-size:13px}
  header{background:linear-gradient(135deg,#1a2744 0%,#2563eb 100%);color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
  header h1{font-size:18px;font-weight:800}
  header .meta{font-size:11px;opacity:0.8}
  .stats{display:flex;gap:12px;padding:16px 24px;background:#fff;border-bottom:1px solid #e2e8f0;flex-wrap:wrap}
  .stat{text-align:center;padding:8px 16px;background:#f8fafc;border-radius:8px;min-width:80px}
  .stat .n{font-size:22px;font-weight:800;color:#1a2744}
  .stat .l{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}
  .controls{padding:12px 24px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .controls input,.controls select{padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;outline:none;background:#f8fafc}
  .controls input:focus,.controls select:focus{border-color:#2563eb}
  .controls label{font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px}
  .grid{padding:16px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;border-left:4px solid var(--accent);transition:box-shadow 0.15s}
  .card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.08)}
  .card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px}
  .card-title{font-size:13px;font-weight:700;color:#1e293b;line-height:1.3}
  .card-company{font-size:12px;color:#4a90d9;font-weight:600;margin-top:2px}
  .score-badge{background:#1a2744;color:#fff;padding:3px 9px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap}
  .card-meta{font-size:11px;color:#64748b;margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .tag{background:#f1f5f9;padding:2px 7px;border-radius:6px;font-size:10px}
  .salary-badge{background:#dcfce7;color:#166534;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700}
  .card-desc{font-size:11px;color:#475569;margin-top:8px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card-footer{margin-top:10px;display:flex;justify-content:space-between;align-items:center}
  .btn{background:#0077B5;color:#fff;padding:5px 12px;border-radius:6px;font-size:11px;text-decoration:none;font-weight:600;display:inline-block}
  .btn:hover{background:#005c8e}
  .stars{font-size:11px}
  .top3{padding:0 24px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
  .top3-label{padding:12px 24px 4px;font-size:11px;font-weight:700;color:#1a2744;text-transform:uppercase;letter-spacing:0.6px}
  .top-card{background:linear-gradient(135deg,#1a2744 0%,#1e3a5f 100%);color:#fff;border-radius:10px;padding:14px 16px}
  .top-card .t{font-size:13px;font-weight:700}
  .top-card .c{font-size:11px;opacity:0.8;margin-top:2px}
  .top-card .s{font-size:20px;font-weight:800;margin-top:8px}
  .top-card a{color:#7eb8f7;font-size:11px}
  .empty{padding:40px;text-align:center;color:#94a3b8;grid-column:1/-1}
  #count{font-size:12px;color:#64748b;margin-left:auto}
</style>
</head>
<body>
<header>
  <div>
    <h1>🎯 QA Job Dashboard</h1>
    <div class="meta">Actualizado: ${updatedAt}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:22px;font-weight:800">${jobs.length}</div>
    <div style="font-size:11px;opacity:0.8">ofertas totales</div>
  </div>
</header>

<div class="stats">
  <div class="stat"><div class="n">${jobs.filter(j => (j.score ?? 0) >= 65).length}</div><div class="l">⭐⭐⭐ Top</div></div>
  <div class="stat"><div class="n">${jobs.filter(j => (j.score ?? 0) >= 35 && (j.score ?? 0) < 65).length}</div><div class="l">⭐⭐ Buenas</div></div>
  <div class="stat"><div class="n">${jobs.filter(j => j.salary).length}</div><div class="l">Con salario</div></div>
  <div class="stat"><div class="n">${jobs.filter(j => j.notifiedAt).length}</div><div class="l">Notificadas</div></div>
  <div class="stat"><div class="n">${companies.length}</div><div class="l">Empresas</div></div>
</div>

${top3.length > 0 ? `
<div class="top3-label">🏆 Top 3 del momento</div>
<div class="top3">
  ${top3.map((j, i) => `
  <div class="top-card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:11px;opacity:0.7">#${i + 1}</span>
      <span style="font-size:20px;font-weight:800">${j.score ?? 0} pts</span>
    </div>
    <div class="t">${j.title}</div>
    <div class="c">${j.company} · ${j.location}</div>
    <div style="margin-top:8px"><a href="${j.link}" target="_blank">Ver oferta →</a></div>
  </div>`).join('')}
</div>` : ''}

<div class="controls">
  <div>
    <label>Buscar</label><br>
    <input type="text" id="q" placeholder="título, empresa..." oninput="render()">
  </div>
  <div>
    <label>Empresa</label><br>
    <select id="company" onchange="render()">
      <option value="">Todas</option>
      ${companies.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
  </div>
  <div>
    <label>Ubicación</label><br>
    <select id="loc" onchange="render()">
      <option value="">Todas</option>
      ${locations.map(l => `<option value="${l}">${l}</option>`).join('')}
    </select>
  </div>
  <div>
    <label>Score mínimo</label><br>
    <select id="minScore" onchange="render()">
      <option value="0">Cualquiera</option>
      <option value="35">⭐⭐ ≥ 35</option>
      <option value="65">⭐⭐⭐ ≥ 65</option>
    </select>
  </div>
  <div>
    <label>Con salario</label><br>
    <select id="salary" onchange="render()">
      <option value="">Todos</option>
      <option value="yes">Solo con salario</option>
    </select>
  </div>
  <div id="count"></div>
</div>

<div class="grid" id="grid"></div>

<script>
const JOBS = ${jobsJson};

function render() {
  const q        = document.getElementById('q').value.toLowerCase();
  const company  = document.getElementById('company').value;
  const loc      = document.getElementById('loc').value;
  const minScore = Number(document.getElementById('minScore').value);
  const salOnly  = document.getElementById('salary').value === 'yes';

  const filtered = JOBS.filter(j => {
    if (q && !(j.title+j.company+j.location+(j.description||'')).toLowerCase().includes(q)) return false;
    if (company && j.company !== company) return false;
    if (loc && (j.sourceLocation ?? j.location) !== loc) return false;
    if ((j.score ?? 0) < minScore) return false;
    if (salOnly && !j.salary) return false;
    return true;
  });

  document.getElementById('count').textContent = filtered.length + ' ofertas';

  const grid = document.getElementById('grid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty">Sin resultados con estos filtros</div>';
    return;
  }

  grid.innerHTML = filtered.map(j => {
    const score  = j.score ?? 0;
    const accent = score >= 65 ? '#16a34a' : score >= 35 ? '#2563eb' : '#94a3b8';
    const stars  = score >= 65 ? '⭐⭐⭐' : score >= 35 ? '⭐⭐' : '⭐';
    const salary = j.salary ? \`<span class="salary-badge">\${j.salary.raw}</span>\` : '';
    const date   = j.datePosted ? \`<span class="tag">📅 \${j.datePosted}</span>\` : '';
    const src    = j.sourceLocation ? \`<span class="tag">\${j.sourceLocation}</span>\` : '';
    const desc   = j.description ? \`<div class="card-desc">\${j.description.substring(0,150)}</div>\` : '';
    const notif  = j.notifiedAt ? '<span class="tag" style="background:#dcfce7;color:#166534">✓ Notificada</span>' : '';
    return \`
      <div class="card" style="--accent:\${accent}">
        <div class="card-header">
          <div>
            <div class="card-title">\${stars} \${j.title}</div>
            <div class="card-company">\${j.company}</div>
          </div>
          <div class="score-badge">\${score} pts</div>
        </div>
        <div class="card-meta">
          <span class="tag">📍 \${j.location}</span>
          \${src}\${date}\${salary}\${notif}
        </div>
        \${desc}
        <div class="card-footer">
          <a class="btn" href="\${j.link}" target="_blank">Ver oferta →</a>
          <span style="font-size:10px;color:#94a3b8">\${j.savedAt ? new Date(j.savedAt).toLocaleDateString('es-CO') : ''}</span>
        </div>
      </div>\`;
  }).join('');
}

render();
</script>
</body>
</html>`;

  fs.writeFileSync(OUT_FILE, html, 'utf-8');
  console.log(`✓ Dashboard generado: ${OUT_FILE} (${jobs.length} jobs)`);
}

// Run standalone: npx tsx dashboard/generate.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  generateDashboard();
}
