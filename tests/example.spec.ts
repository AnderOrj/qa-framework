import { test, expect } from '@playwright/test';
import { APIHelper } from '../utils/api-helper.js';

test.describe('Example Test Suite', () => {
  let api: APIHelper;

  test.beforeEach(async () => {
    api = new APIHelper();
  });

  test('Example: Obtener datos de API', async () => {
    const response = await api.get('/api/users');
    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
  });

  test('Example: Crear usuario vía API', async () => {
    const newUser = {
      name: 'Test User',
      email: 'test@example.com',
    };
    const response = await api.post('/api/users', newUser);
    expect(response.ok).toBe(true);
  });

  test('Example: Navegar a página', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).toBeDefined();
  });
});
