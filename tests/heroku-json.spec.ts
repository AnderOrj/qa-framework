import { test, expect } from '@playwright/test';

test.describe('The Internet - UI tests', () => {
  test('Login exitoso en /login', async ({ page }) => {
    await page.goto('https://the-internet.herokuapp.com/login');
    await page.fill('#username', 'tomsmith');
    await page.fill('#password', 'SuperSecretPassword!');
    await page.click('button[type="submit"]');
    await expect(page.locator('#flash')).toContainText('You logged into a secure area!');
    await expect(page.locator('a.button.secondary.radius')).toBeVisible();
  });

  test('Checkboxes: seleccionar y deseleccionar', async ({ page }) => {
    await page.goto('https://the-internet.herokuapp.com/checkboxes');
    const checkbox1 = page.locator('input[type="checkbox"]').nth(0);
    const checkbox2 = page.locator('input[type="checkbox"]').nth(1);

    await expect(checkbox1).not.toBeChecked();
    await expect(checkbox2).toBeChecked();

    await checkbox1.check();
    await checkbox2.uncheck();

    await expect(checkbox1).toBeChecked();
    await expect(checkbox2).not.toBeChecked();
  });

  test('Dropdown: seleccionar opción', async ({ page }) => {
    await page.goto('https://the-internet.herokuapp.com/dropdown');
    const dropdown = page.locator('#dropdown');
    await dropdown.selectOption('1');
    await expect(dropdown).toHaveValue('1');
  });

  test('Drag and Drop: mover elemento', async ({ page }) => {
    await page.goto('https://the-internet.herokuapp.com/drag_and_drop');
    const source = page.locator('#column-a');
    const target = page.locator('#column-b');
    await source.dragTo(target);
    await expect(page.locator('#column-a header')).toHaveText('B');
    await expect(page.locator('#column-b header')).toHaveText('A');
  });

  test('File Upload: subir archivo', async ({ page }) => {
    await page.goto('https://the-internet.herokuapp.com/upload');
    await page.setInputFiles('#file-upload', './test-file.txt');
    await page.click('#file-submit');
    await expect(page.locator('#uploaded-files')).toContainText('test-file.txt');
  });
});

test.describe('JSONPlaceholder - API tests', () => {
  const apiBase = 'https://jsonplaceholder.typicode.com';

  test('GET /posts devuelve 100 posts', async () => {
    const response = await fetch(`${apiBase}/posts`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(100);
  });

  test('GET /users/1 devuelve usuario válido', async () => {
    const response = await fetch(`${apiBase}/users/1`);
    expect(response.status).toBe(200);
    const user = await response.json();
    expect(user).toMatchObject({
      id: 1,
      username: 'Bret',
      email: expect.any(String),
    });
  });

  test('POST /posts crea un nuevo post', async () => {
    const payload = {
      title: 'foo',
      body: 'bar',
      userId: 1,
    };
    const response = await fetch(`${apiBase}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject(payload);
    expect(result.id).toBeDefined();
  });

  test('PUT /posts/1 actualiza un post', async () => {
    const payload = { id: 1, title: 'updated title', body: 'updated body', userId: 1 };
    const response = await fetch(`${apiBase}/posts/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.title).toBe('updated title');
  });

  test('DELETE /posts/1 elimina un post', async () => {
    const response = await fetch(`${apiBase}/posts/1`, { method: 'DELETE' });
    expect(response.status).toBe(200);
  });
});
