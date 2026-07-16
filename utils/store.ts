import * as fs from 'fs';
import { JOBS_FILE } from './scraper-config.js';
import type { Job } from './types.js';
import { logInfo } from './logger.js';

export function loadJobs(): Job[] {
  if (!fs.existsSync(JOBS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')) as Job[];
  } catch {
    return [];
  }
}

export function dedupJobs(jobs: Job[]): Job[] {
  const seenLinks = new Set<string>();
  const seenKeys = new Set<string>();
  return jobs.filter(j => {
    if (j.link && seenLinks.has(j.link)) return false;
    const key = `${j.company.toLowerCase().trim()}|${j.title.toLowerCase().trim()}`;
    if (seenKeys.has(key)) return false;
    if (j.link) seenLinks.add(j.link);
    seenKeys.add(key);
    return true;
  });
}

export function getNewJobs(incoming: Job[]): Job[] {
  const existing = loadJobs();
  const seenLinks = new Set(existing.map(j => j.link));
  const seenKeys  = new Set(existing.map(j => `${j.company.toLowerCase().trim()}|${j.title.toLowerCase().trim()}`));
  return incoming.filter(j => {
    if (j.link && seenLinks.has(j.link)) return false;
    const key = `${j.company.toLowerCase().trim()}|${j.title.toLowerCase().trim()}`;
    return !seenKeys.has(key);
  });
}

export function saveJobs(newJobs: Job[]): void {
  const now = new Date().toISOString();
  const withTimestamp = newJobs.map(j => ({ ...j, savedAt: j.savedAt ?? now }));
  const existing = loadJobs();
  const deduped = dedupJobs([...existing, ...withTimestamp]);
  fs.writeFileSync(JOBS_FILE, JSON.stringify(pruneOld(deduped), null, 2));
}

export function markNotified(links: string[]): void {
  const linkSet = new Set(links);
  const jobs = loadJobs().map(j =>
    linkSet.has(j.link) ? { ...j, notifiedAt: new Date().toISOString() } : j
  );
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function pruneOld(jobs: Job[]): Job[] {
  const cutoff = Date.now() - 20 * 24 * 60 * 60 * 1000;
  const before = jobs.length;
  const pruned = jobs.filter(j => !j.savedAt || new Date(j.savedAt).getTime() >= cutoff);
  if (pruned.length < before) {
    logInfo(`Purga jobs.json: eliminadas ${before - pruned.length} ofertas con más de 20 días (quedan ${pruned.length})`);
  }
  return pruned;
}
