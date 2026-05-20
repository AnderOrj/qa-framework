# CLAUDE.md - Memoria del Proyecto

## Contexto del Proyecto

- **Stack:** Node.js + TypeScript + Playwright
- **Propósito:** Framework de automatización de tests con QA + IA
- **Autor:** Ingeniero de sistemas con experiencia en testing
- **Versión:** 1.0.0

## Estructura

- `tests/` → Casos de prueba (archivos `.spec.ts`)
- `utils/` → Helpers y configuración
- `fixtures/` → Datos de prueba
- `playwright.config.ts` → Configuración de Playwright

## Archivos Clave

- `utils/config.ts` → Lee variables de entorno (BASE_URL, API_TOKEN, etc)
- `utils/api-helper.ts` → Clase para requests GET, POST, PUT, DELETE
- `playwright.config.ts` → Configuración de navegadores y reporters

## Convenciones

- Tests nombrados en español con descripción clara
- Archivos de test con sufijo `.spec.ts`
- Usar `test.describe()` para agrupar tests relacionados
- Variables sensibles en `.env` (nunca commitear)

## Comandos útiles

```bash
npm test              # Correr tests
npm run test:headed   # Con navegador visible
npm run test:ui       # UI interactivo
npm run test:debug    # Debug mode
npm run report        # Ver reporte HTML
```

## Próximos pasos

1. Definir endpoints a probar
2. Escribir primeros tests en `tests/`
3. Integrar con CI/CD (GitHub Actions, Jenkins, etc)
4. Expandir APIHelper si hace falta (auth headers, retry logic, etc)

---

**Última actualización:** 2026-05-06
