import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { AppliedJob } from '../utils/types.js';

const ROOT     = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN_FILE  = path.join(ROOT, 'applied-jobs.json');
const OUT_FILE = path.join(ROOT, 'dashboard', 'applied.html');

function statusMeta(status: string): { label: string; color: string; bg: string } {
  const s = status.toLowerCase();
  if (!status)                                  return { label: 'Sin estado',        color: '#94a3b8', bg: '#f1f5f9' };
  if (/no longer|closed|expired/i.test(s))      return { label: 'Cerrada',           color: '#dc2626', bg: '#fef2f2' };
  if (/viewed|recruiter viewed/i.test(s))       return { label: 'Vista por reclutador', color: '#7c3aed', bg: '#f5f3ff' };
  if (/in review|under review|reviewing/i.test(s)) return { label: 'En revisión',    color: '#d97706', bg: '#fffbeb' };
  if (/interview|entrevista/i.test(s))          return { label: 'Entrevista',        color: '#059669', bg: '#ecfdf5' };
  if (/offer|oferta/i.test(s))                  return { label: '🎉 Oferta',         color: '#16a34a', bg: '#dcfce7' };
  if (/rejected|rechazado/i.test(s))            return { label: 'Rechazado',         color: '#6b7280', bg: '#f9fafb' };
  if (/posted|active|accepting/i.test(s))       return { label: 'Activa',            color: '#2563eb', bg: '#eff6ff' };
  return { label: status.substring(0, 40),      color: '#64748b', bg: '#f8fafc' };
}

function locationTag(loc: string): string {
  const l = loc.toLowerCase();
  if (/remote/i.test(l))  return '🌐 Remote';
  if (/hybrid/i.test(l))  return '🏢 Hybrid';
  return '📍 ' + loc;
}

export function generateAppliedDashboard(): void {
  if (!fs.existsSync(IN_FILE)) {
    console.warn(`⚠️  applied-jobs.json no encontrado. Corre: npx tsx linkedin-applied-jobs.ts`);
    return;
  }

  const jobs: AppliedJob[] = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));
  const updatedAt = new Date().toLocaleString('es-CO');

  const total     = jobs.length;
  const closed    = jobs.filter(j => /no longer|closed|expired/i.test(j.status)).length;
  const active    = jobs.filter(j => /posted|active|accepting/i.test(j.status)).length;
  const viewed    = jobs.filter(j => /viewed/i.test(j.status)).length;
  const interview = jobs.filter(j => /interview|entrevista/i.test(j.status)).length;

  const companies  = [...new Set(jobs.map(j => j.company))].sort();
  const statuses   = [...new Set(jobs.map(j => statusMeta(j.status).label))].sort();

  const jobsJson = JSON.stringify(jobs);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aplicaciones LinkedIn — Anderson</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f1f5f9;color:#1e293b;font-size:13px}
  header{background:linear-gradient(135deg,#0077B5 0%,#005c8e 100%);color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
  header h1{font-size:18px;font-weight:800}
  header .meta{font-size:11px;opacity:0.8;margin-top:2px}
  .stats{display:flex;gap:10px;padding:14px 24px;background:#fff;border-bottom:1px solid #e2e8f0;flex-wrap:wrap}
  .stat{text-align:center;padding:8px 14px;border-radius:8px;min-width:80px;border:1px solid #e2e8f0}
  .stat .n{font-size:22px;font-weight:800}
  .stat .l{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}
  .controls{padding:12px 24px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
  .controls input,.controls select{padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;outline:none;background:#f8fafc}
  .controls input:focus,.controls select:focus{border-color:#0077B5}
  .ctrl label{font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;display:block;margin-bottom:3px}
  #count{font-size:12px;color:#64748b;margin-left:auto;align-self:center}
  .grid{padding:16px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;border-left:4px solid var(--accent)}
  .card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.08)}
  .card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
  .card-title{font-size:13px;font-weight:700;color:#1e293b;line-height:1.3}
  .card-company{font-size:12px;color:#0077B5;font-weight:600;margin-top:3px}
  .status-badge{padding:3px 9px;border-radius:8px;font-size:10px;font-weight:700;white-space:nowrap;border:1px solid var(--accent)}
  .card-meta{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px;color:#64748b}
  .tag{background:#f1f5f9;padding:2px 7px;border-radius:6px;font-size:10px;color:#475569}
  .date-tag{background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600}
  .card-footer{margin-top:12px}
  .btn{background:#0077B5;color:#fff;padding:5px 12px;border-radius:6px;font-size:11px;text-decoration:none;font-weight:600;display:inline-block}
  .btn:hover{background:#005c8e}
  .empty{padding:40px;text-align:center;color:#94a3b8;grid-column:1/-1}
  .highlight{border-left-color:#059669 !important;background:#f0fdf4}
</style>
</head>
<body>

<header>
  <div>
    <h1>📨 Mis Aplicaciones LinkedIn</h1>
    <div class="meta">Actualizado: ${updatedAt}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:26px;font-weight:800">${total}</div>
    <div style="font-size:11px;opacity:0.8">aplicaciones</div>
  </div>
</header>

<div class="stats">
  <div class="stat" style="border-color:#bfdbfe"><div class="n" style="color:#2563eb">${total}</div><div class="l">Total</div></div>
  <div class="stat" style="border-color:#bfdbfe"><div class="n" style="color:#2563eb">${active}</div><div class="l">Activas</div></div>
  <div class="stat" style="border-color:#fecaca"><div class="n" style="color:#dc2626">${closed}</div><div class="l">Cerradas</div></div>
  <div class="stat" style="border-color:#ddd6fe"><div class="n" style="color:#7c3aed">${viewed}</div><div class="l">Vistas</div></div>
  <div class="stat" style="border-color:#a7f3d0"><div class="n" style="color:#059669">${interview}</div><div class="l">Entrevistas</div></div>
</div>

<div class="controls">
  <div class="ctrl">
    <label>Buscar</label>
    <input type="text" id="q" placeholder="cargo, empresa..." oninput="render()">
  </div>
  <div class="ctrl">
    <label>Empresa</label>
    <select id="company" onchange="render()">
      <option value="">Todas</option>
      ${companies.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
  </div>
  <div class="ctrl">
    <label>Estado</label>
    <select id="status" onchange="render()">
      <option value="">Todos</option>
      ${statuses.map(s => `<option value="${s}">${s}</option>`).join('')}
    </select>
  </div>
  <div class="ctrl">
    <label>Modalidad</label>
    <select id="mode" onchange="render()">
      <option value="">Todas</option>
      <option value="remote">Remote</option>
      <option value="hybrid">Hybrid</option>
      <option value="onsite">On-site</option>
    </select>
  </div>
  <div id="count"></div>
</div>

<div class="grid" id="grid"></div>

<script>
const JOBS = ${jobsJson};

function statusMeta(status) {
  const s = (status || '').toLowerCase();
  if (!status)                                    return { label: 'Sin estado',           color: '#94a3b8', bg: '#f1f5f9' };
  if (/no longer|closed|expired/i.test(s))        return { label: 'Cerrada',              color: '#dc2626', bg: '#fef2f2' };
  if (/viewed|recruiter viewed/i.test(s))         return { label: 'Vista por reclutador', color: '#7c3aed', bg: '#f5f3ff' };
  if (/in review|under review|reviewing/i.test(s))return { label: 'En revisión',          color: '#d97706', bg: '#fffbeb' };
  if (/interview|entrevista/i.test(s))            return { label: 'Entrevista',            color: '#059669', bg: '#ecfdf5' };
  if (/offer|oferta/i.test(s))                    return { label: '🎉 Oferta',             color: '#16a34a', bg: '#dcfce7' };
  if (/rejected|rechazado/i.test(s))              return { label: 'Rechazado',             color: '#6b7280', bg: '#f9fafb' };
  if (/posted|active|accepting/i.test(s))         return { label: 'Activa',               color: '#2563eb', bg: '#eff6ff' };
  return { label: status.substring(0, 40), color: '#64748b', bg: '#f8fafc' };
}

function render() {
  const q       = document.getElementById('q').value.toLowerCase();
  const company = document.getElementById('company').value;
  const status  = document.getElementById('status').value;
  const mode    = document.getElementById('mode').value;

  const filtered = JOBS.filter(j => {
    if (q && !(j.title + j.company + (j.location||'')).toLowerCase().includes(q)) return false;
    if (company && j.company !== company) return false;
    if (status && statusMeta(j.status).label !== status) return false;
    if (mode) {
      const loc = (j.location||'').toLowerCase();
      if (mode === 'remote' && !/remote/i.test(loc)) return false;
      if (mode === 'hybrid' && !/hybrid/i.test(loc)) return false;
      if (mode === 'onsite' && /remote|hybrid/i.test(loc)) return false;
    }
    return true;
  });

  document.getElementById('count').textContent = filtered.length + ' aplicaciones';

  const grid = document.getElementById('grid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty">Sin resultados con estos filtros</div>';
    return;
  }

  grid.innerHTML = filtered.map(j => {
    const sm    = statusMeta(j.status);
    const isInterview = /interview|entrevista/i.test(j.status);
    const loc   = (j.location||'').toLowerCase();
    const modTag = /remote/i.test(loc) ? '🌐 Remote' : /hybrid/i.test(loc) ? '🏢 Hybrid' : '📍 ' + (j.location || '');

    return \`
      <div class="card \${isInterview ? 'highlight' : ''}" style="--accent:\${sm.color}">
        <div class="card-top">
          <div>
            <div class="card-title">\${j.title}</div>
            <div class="card-company">\${j.company}</div>
          </div>
          <div class="status-badge" style="color:\${sm.color};background:\${sm.bg};border-color:\${sm.color}30">\${sm.label}</div>
        </div>
        <div class="card-meta">
          <span class="tag">\${modTag}</span>
          \${j.appliedDate ? \`<span class="date-tag">📅 \${j.appliedDate}</span>\` : ''}
        </div>
        <div class="card-footer">
          <a class="btn" href="\${j.link}" target="_blank">Ver oferta →</a>
        </div>
      </div>\`;
  }).join('');
}

render();
</script>
</body>
</html>`;

  fs.writeFileSync(OUT_FILE, html, 'utf-8');
  console.log(`✓ Dashboard de aplicaciones generado: ${OUT_FILE} (${total} aplicaciones)`);
}

// Run standalone
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateAppliedDashboard();
}
