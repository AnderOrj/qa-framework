# QA Framework con Playwright + TypeScript

## Setup

```bash
# Clonar/usar este directorio
cd qa-framework

# Copiar y editar variables de entorno
cp .env.example .env

# Las dependencias ya están instaladas en package.json
```

## Estructura

```
tests/             → Tus casos de prueba (.spec.ts)
utils/
  ├── config.ts    → Variables de entorno
  └── api-helper.ts → Utilidad para calls API
fixtures/          → Datos de prueba (si es necesario)
```

## Comandos

```bash
# Correr todos los tests
npm test

# Correr con navegador visible
npm run test:headed

# Debug mode interactivo
npm run test:debug

# UI visual (recomendado para desarrollo)
npm run test:ui

# Ver reporte HTML
npm run report
```

## Cómo agregar tests

1. Crear archivo en `tests/` con sufijo `.spec.ts`
2. Importar `test, expect` de `@playwright/test`
3. Escribir tu test
4. Ejecutar con `npm run test:ui` para ver en vivo

## Ejemplo rápido

```typescript
import { test, expect } from '@playwright/test';

test('Mi primer test', async ({ page }) => {
  await page.goto('https://example.com');
  const title = await page.title();
  expect(title).toContain('Example');
});
```

## LinkedIn Job Scraper

Scraper automático de ofertas QA en LinkedIn con notificaciones por correo.

### Funcionalidades

- **Búsqueda paginada** — Hasta 3 páginas por keyword/ubicación (75 resultados por combinación). Configurable con `MAX_PAGES_PER_SEARCH`.
- **Scoring de relevancia** — Cada oferta recibe un puntaje (0–100+) basado en seniority, herramientas, modalidad, señales LATAM/Colombia, y más. Score mínimo configurable con `MIN_SCORE`.
- **Filtro de ubicaciones** — Búsquedas en Colombia (todos los modalidades) y Estados Unidos (solo remoto). Las ofertas US sin señal internacional explícita se descartan automáticamente.
- **Deduplicación y pruning** — `jobs.json` no acumula duplicados y purga automáticamente ofertas con más de 20 días.
- **Detección de país** — Identifica el país de la oferta y excluye Brasil y roles con restricción de trabajo en EEUU.
- **Notificaciones por correo** — Emails HTML con tarjetas por oferta: título, empresa, descripción parseada en secciones, botón directo a LinkedIn, y badge de score con color.
- **Resumen diario** — Todos los días a las 8:00 AM envía las ofertas encontradas en el día, ordenadas por score.
- **Top 10 semanal** — Todos los viernes a las 5:00 PM envía las 10 mejores ofertas de los últimos 7 días.
- **WhatsApp opcional** — Notificaciones vía Twilio WhatsApp Sandbox. Se activa/desactiva con `WHATSAPP_ENABLED=true/false` sin tocar código.
- **Abort por sesión expirada** — Si LinkedIn redirige al login, el scraper se detiene, notifica por correo y pide renovar sesión con `npx tsx linkedin-login.ts`.
- **Log rotativo** — `scraper.log` se rota automáticamente si supera 5 MB o 7 días de antigüedad.

### Comandos del scraper

```bash
# Scheduler continuo (cron cada 2h de 7am a 7pm)
npx tsx linkedin-job-scraper.ts

# Búsqueda inmediata (una sola vez)
npx tsx linkedin-job-scraper.ts --once

# Resumen diario manual
npx tsx linkedin-job-scraper.ts --summary

# Top 10 semanal manual
npx tsx linkedin-job-scraper.ts --weekly

# Enviar correo de prueba con el último job
npx tsx linkedin-job-scraper.ts --test-email --to=tucorreo@ejemplo.com

# Renovar sesión de LinkedIn
npx tsx linkedin-login.ts
```

### Variables de entorno relevantes

| Variable | Descripción | Default |
|---|---|---|
| `MAX_PAGES_PER_SEARCH` | Páginas por keyword/ubicación (25 jobs/página) | `3` |
| `MIN_SCORE` | Score mínimo para incluir una oferta | `10` |
| `WHATSAPP_ENABLED` | Activar/desactivar notificaciones WhatsApp | `true` |
| `CRON_SCHEDULE` | Expresión cron para las búsquedas | `0 7-19/2 * * *` |

---

## Usar con Claude Code

En VS Code, abre terminal y:

```bash
# Claude te ayudará a escribir tests
npx @anthropic-ai/claude-code
```

Luego puedes pedir:
- "Genera un test para login"
- "Analiza este endpoint y crea 5 casos de prueba"
- "Refactoriza estos tests para reutilizar código"
