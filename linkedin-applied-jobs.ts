import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createPage, validateSession, randomDelay } from './utils/browser.js';
import { logInfo } from './utils/logger.js';
import type { AppliedJob } from './utils/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getAppliedJobs(): Promise<AppliedJob[]> {
  const session = await createPage();
  const { page } = session;

  try {
    logInfo('Validando sesión LinkedIn...');
    const valid = await validateSession(page);
    if (!valid) {
      console.error('❌ Sesión expirada. Corre: npx tsx linkedin-login.ts');
      process.exit(1);
    }

    logInfo('Abriendo Job Tracker...');
    await page.goto('https://www.linkedin.com/jobs-tracker/', { waitUntil: 'load' });

    await page.waitForFunction(
      () => document.body.innerText.includes('Applied'),
      { timeout: 20000 }
    );

    logInfo('Seleccionando tab "Applied"...');
    await page.locator('label').filter({ hasText: /^Applied/ }).first().click();

    // Wait for job cards to appear instead of fixed timeout
    await page.waitForFunction(
      () => document.querySelector('a[href*="/jobs/view/"]') !== null,
      { timeout: 15000 }
    ).catch(() => randomDelay(3000, 3000));

    await page.screenshot({ path: path.join(__dirname, 'applied-screenshot.png') });

    logInfo('Extrayendo jobs página por página...');
    const allJobs: AppliedJob[] = [];
    const seen = new Set<string>();

    const extractCurrentPage = async (): Promise<AppliedJob[]> => {
      return page.evaluate(() => {
        const links = Array.from(
          document.querySelectorAll('a[href*="/jobs/view/"]')
        ) as HTMLAnchorElement[];

        const pageSeen = new Set<string>();
        const results: Array<{
          title: string; company: string; location: string;
          link: string; appliedDate: string; status: string;
        }> = [];

        links.forEach(a => {
          const link = a.href.split('?')[0] ?? '';
          if (pageSeen.has(link)) return;
          pageSeen.add(link);

          const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
          const nodes: string[] = [];
          let n: Node | null;
          while ((n = walker.nextNode())) {
            const t = n.textContent?.trim();
            if (t) nodes.push(t);
          }

          const title = nodes[0] ?? '';
          const companyLocation = nodes[1] ?? '';
          const appliedRaw = nodes[2] ?? '';
          const statusRaw = nodes[3]?.replace(/^\(|\)$/g, '').trim() ?? '';

          const dotIdx = companyLocation.indexOf(' · ');
          const company = dotIdx !== -1 ? companyLocation.slice(0, dotIdx).trim() : companyLocation;
          const location = dotIdx !== -1 ? companyLocation.slice(dotIdx + 3).trim() : '';

          if (title) results.push({ title, company, location, link, appliedDate: appliedRaw, status: statusRaw });
        });

        return results;
      });
    };

    const page1Jobs = await extractCurrentPage();
    page1Jobs.forEach(j => { if (!seen.has(j.link)) { seen.add(j.link); allJobs.push(j); } });
    logInfo(`Página 1: ${page1Jobs.length} jobs → Total: ${allJobs.length}`);

    let pageNum = 2;
    while (true) {
      const nextPageBtn = page.locator(`button[aria-label="Page ${pageNum}"]`).first();
      const visible = await nextPageBtn.isVisible().catch(() => false);
      if (!visible) break;

      await nextPageBtn.click();
      await page.waitForFunction(
        () => document.querySelector('a[href*="/jobs/view/"]') !== null,
        { timeout: 15000 }
      ).catch(() => randomDelay(3000, 3000));

      const pageJobs = await extractCurrentPage();
      pageJobs.forEach(j => { if (!seen.has(j.link)) { seen.add(j.link); allJobs.push(j); } });
      logInfo(`Página ${pageNum}: ${pageJobs.length} jobs → Total: ${allJobs.length}`);
      pageNum++;
    }

    return allJobs;
  } finally {
    await session.close();
  }
}

async function main() {
  const jobs = await getAppliedJobs();

  if (jobs.length === 0) {
    console.log('\n⚠️  No se pudo extraer aplicaciones automáticamente.');
    console.log('   Revisa applied-screenshot.png');
    return;
  }

  console.log(`\n✅ ${jobs.length} aplicaciones encontradas:\n`);
  console.log('='.repeat(70));

  jobs.forEach((job, i) => {
    console.log(`\n#${i + 1}`);
    console.log(`  Cargo:    ${job.title}`);
    console.log(`  Empresa:  ${job.company}`);
    if (job.location)    console.log(`  Lugar:    ${job.location}`);
    if (job.appliedDate) console.log(`  Aplicado: ${job.appliedDate}`);
    if (job.status)      console.log(`  Estado:   ${job.status}`);
    if (job.link)        console.log(`  Link:     ${job.link}`);
  });

  console.log('\n' + '='.repeat(70));

  const outFile = path.join(__dirname, 'applied-jobs.json');
  fs.writeFileSync(outFile, JSON.stringify(jobs, null, 2));
  logInfo(`Guardado en applied-jobs.json`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
