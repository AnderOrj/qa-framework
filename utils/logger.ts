import * as fs from 'fs';
import { LOG_FILE } from './scraper-config.js';

export function logError(context: string, error: unknown) {
  const ts = new Date().toLocaleString('es-CO');
  const err = error as Record<string, unknown>;
  const code = err?.['code'] ?? err?.['status'] ?? 'N/A';
  const msg = error instanceof Error ? error.message : String(error);
  const line = `[${ts}] ✗ ${context} | code=${code} | ${msg}\n`;

  console.error(line.trim());
  fs.appendFileSync(LOG_FILE, line);

  // Twilio sandbox session expired codes
  if (code === 63016 || code === 21408 || String(msg).includes('opt in')) {
    const hint = `[${ts}] ⚠️  ACCIÓN REQUERIDA: sesión sandbox expirada. Envía "join <palabra>" al +14155238886 desde WhatsApp para reactivar.\n`;
    console.error(hint.trim());
    fs.appendFileSync(LOG_FILE, hint);
  }
}

export function logInfo(msg: string) {
  const ts = new Date().toLocaleString('es-CO');
  const line = `[${ts}] ✓ ${msg}\n`;
  console.log(line.trim());
  fs.appendFileSync(LOG_FILE, line);
}
