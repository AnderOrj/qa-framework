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
