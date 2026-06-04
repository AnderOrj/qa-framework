import { createPage } from './utils/browser.js';

async function main() {
  const jobUrl = process.argv[2] || 'https://www.linkedin.com/jobs/view/4401478883/';

  const session = await createPage();
  try {
    await session.page.goto(jobUrl, { waitUntil: 'load' });
    await session.page.waitForTimeout(4000);

    const title = (await session.page.locator('h1').first().textContent().catch(() => ''))?.trim() || '';

    const descText = await session.page.evaluate(
      '(document.querySelector(".jobs-description__content") || document.querySelector("article") || document.body).innerText.slice(0, 10000)'
    ) as string;

    const bodyLines = descText.split('\n').map((l: string) => l.trim()).filter(Boolean);

    console.log(`\nTítulo: ${title}`);
    console.log('Primeras líneas:');
    bodyLines.slice(0, 30).forEach((l: string) => console.log(' ', l));
    console.log('\n--- DESCRIPCIÓN COMPLETA ---\n');
    console.log(descText);
  } finally {
    await session.close();
  }
}

main().catch(console.error);
