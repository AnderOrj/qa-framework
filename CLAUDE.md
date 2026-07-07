# CLAUDE.md — LinkedIn Job Scraper

## Propósito del proyecto

Scraper automatizado de ofertas QA en LinkedIn para Anderson Orjuela (Senior QA Engineer, Bogotá).
Busca, filtra, puntúa y notifica ofertas relevantes por WhatsApp y email. Genera cover letters con IA para los mejores matches.

## Stack

- **Runtime:** Node.js + TypeScript (ESM, `"type": "module"`)
- **Scraping:** Playwright (chromium headless, stealth mode)
- **Scheduler:** node-cron
- **Notificaciones:** nodemailer (Gmail SMTP) + Twilio (WhatsApp)
- **IA:** Anthropic SDK (Claude Haiku — cover letters)
- **Config:** dotenv (.env)

## Archivos clave

| Archivo | Rol |
|---|---|
| `linkedin-job-scraper.ts` | Entry point principal — orquesta todo |
| `linkedin-login.ts` | Login manual (headed) para guardar sesión |
| `utils/auto-login.ts` | Login automático headless cuando sesión expira |
| `utils/cover-letter.ts` | Genera cover letters con Claude Haiku |
| `utils/scoring.ts` | Algoritmo de scoring con regex (0–100+ pts) |
| `utils/filters.ts` | Detección de país, señales internacionales, exclusiones |
| `utils/notifications.ts` | sendEmail, sendEmailTo, sendWhatsApp, notifyNewJobs |
| `utils/store.ts` | CRUD de jobs.json con dedup y pruning de 20 días |
| `utils/scraper-config.ts` | Constantes: timeouts, delays, selectors, QA_KEYWORDS |
| `utils/types.ts` | Interfaces: Job, AppliedJob, CvProfile |
| `utils/email.ts` | HTML builder para emails de jobs y cover letters |
| `cv-profile.json` | Skills y exclusiones del CV (bonus en scoring) |
| `jobs.json` | Base de datos local (gitignored) |
| `linkedin-session.json` | Sesión de browser guardada (gitignored) |
| `.env` | Variables sensibles (gitignored) |

## Variables de entorno requeridas

```
LINKEDIN_EMAIL / LINKEDIN_PASSWORD  → auto-login cuando sesión expira
ANTHROPIC_API_KEY                   → generación de cover letters
EMAIL_COVER_LETTER                  → solo andersonorjuela@hotmail.es
EMAIL_TO                            → destinatarios de jobs (puede ser múltiple, comma-separated)
SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_PORT
SEARCH_KEYWORDS / SEARCH_LOCATIONS / SEARCH_LOCATIONS_REMOTE
CRON_SCHEDULE / MAX_PAGES_PER_SEARCH / MIN_SCORE
WHATSAPP_ENABLED / TWILIO_*
```

## Flujo principal (`runJobSearch`)

1. Búsqueda paralela por ubicación (`Promise.all`) → `searchOneLocation()`
2. Si sesión expira → `autoLogin()` → reintento 1 vez → si falla: notificación
3. Dedup por link + por (company|title)
4. Fetch de descripción (hasta 20 jobs)
5. Scoring = `scoreJob()` + `scoreAgainstCv()` (cv-profile.json)
6. Filtros: país, híbrido, score mínimo, exclusiones
7. `saveJobs()` → `notifyNewJobs()` (WhatsApp + email)
8. Cover letters (Claude Haiku) para top ⭐⭐⭐ nuevos, máx 3 → solo a `EMAIL_COVER_LETTER`

## Scoring ⭐

- ⭐⭐⭐ ≥ 65 pts — Muy relevante (genera cover letter)
- ⭐⭐ ≥ 35 pts — Relevante
- ⭐ < 35 pts — Revisar

## Comandos

```bash
npx tsx linkedin-job-scraper.ts --once      # Una búsqueda inmediata
npx tsx linkedin-job-scraper.ts             # Modo scheduler (cron)
npx tsx linkedin-job-scraper.ts --summary   # Resumen diario
npx tsx linkedin-job-scraper.ts --weekly    # Top 10 semanal
npx tsx linkedin-login.ts                   # Renovar sesión manualmente (headed)
```

## Convenciones

- Imports con `.js` extension (ESM)
- Credenciales solo en `.env` (gitignored — nunca commitear)
- Logs via `logInfo()` / `logError()` de `utils/logger.ts`
- Delays aleatorios entre requests para no parecer bot

## Optimizaciones para Colombia (2026-07-06)

### Mejoras de detección
- **Ciudades ampliadas:** Bogotá, Medellín, Cali, Barranquilla, Cartagena, Cúcuta, Bucaramanga, Santa Marta, Pereira, Manizales, Armenia
- **Empresas colombianas:** Rappi, Bancolombia, Davivienda, Platzi, Pragma, Gorilla Logic, Sofka, Encora, Toptal, y más
- **Función `isColombian()`:** Detecta rápidamente si un job es colombiano

### Mejoras de scoring
- **Colombia +50 pts** (antes: +20) — máxima prioridad
- **LATAM genérico +15 pts** (antes: +20) — penaliza si no menciona Colombia
- **EST timezone required -20 pts** — excluye trabajos que requieren EST sin ser colombianos
- **International team -15 pts** — a menos que sea nearshore o mencione Colombia

### Mejoras de filtrado
- **EST timezone exclusión:** Automáticamente rechaza trabajos que requieren EST a menos que sean colombianos
- **Mejor detección de restricciones internacionales**

### Búsquedas optimizadas
Actualiza tu `.env` con:
```
SEARCH_LOCATIONS=Bogotá,Medellín,Cali,Barranquilla,Cartagena,Cúcuta,Bucaramanga,Colombia
SEARCH_LOCATIONS_REMOTE=Bogotá (remote),Colombia (remote),Latin America (remote)
SEARCH_KEYWORDS=qa,quality assurance,quality engineer,testing,sdet,automation,analista qa,ingeniero qa,pruebas,automatización,calidad de software
```

## Última actualización

2026-07-06 — Optimizaciones para Colombia: detección mejorada, scoring agresivo, filtrados internacionales.
