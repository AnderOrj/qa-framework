import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SESSION_FILE = path.join(ROOT, 'linkedin-session.json');
export const JOBS_FILE    = path.join(ROOT, 'jobs.json');
export const LOG_FILE     = path.join(ROOT, 'scraper.log');
export const CV_PROFILE_FILE = path.join(ROOT, 'cv-profile.json');

export const TIMEOUTS = {
  page:       60_000,
  modal:      30_000,
  navigation: 20_000,
  jobCard:    15_000,
} as const;

export const DELAYS = {
  page:        { min: 2500, max: 4500 },
  scroll:      { min: 1500, max: 3000 },
  between:     { min: 1000, max: 2500 },
  description: { min:  800, max: 1500 },
  modal:       { min:  400, max:  800 },
  whatsapp:    1500,
} as const;

export const SELECTORS = {
  dismissModal: [
    'button[aria-label="Dismiss"]',
    'button[data-tracking-control-name="public_jobs_contextual-sign-in-modal_modal_dismiss"]',
    'button.modal__dismiss',
    'button[aria-label="Cerrar"]',
  ] as const,
  description: [
    '.jobs-description-content__text',
    '.jobs-description__content',
    '.description__text--rich',
    '.show-more-less-html__markup',
  ] as const,
} as const;
