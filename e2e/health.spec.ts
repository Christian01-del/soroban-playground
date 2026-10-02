import { test, expect } from '@playwright/test';

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:5000';

test.describe('Soroban Playground — smoke tests', () => {
  test('frontend home page loads', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/.+/);
  });

  test('backend health endpoint returns ok', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/health`);
    expect(res.ok()).toBeTruthy();
  });

  test('frontend renders without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Allow known benign warnings but fail on real errors
    const realErrors = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error promise rejection')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('backend compile endpoint exists', async ({ request }) => {
    // HEAD request — just verify the route is registered (not a 404)
    const res = await request.post(`${BACKEND_URL}/api/compile`, {
      data: { code: '' },
      headers: { 'Content-Type': 'application/json' },
      failOnStatusCode: false,
    });
    // 400 (validation error) is fine — it means the route exists
    expect(res.status()).not.toBe(404);
  });
});
