/**
 * PSM-OS E2E Tests (Playwright)
 * Run: npx playwright test tests/e2e/login.spec.js
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.PSM_BASE_URL || 'http://localhost:8080';
const TEST_USER = process.env.PSM_TEST_USER || 'teste@psm.com';
const TEST_PASS = process.env.PSM_TEST_PASS || 'senha123';

test.describe('Login flow', () => {
  test('carrega index sem erros', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Apenas erros criticos (ignora warnings CSP benignos)
    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('Content Security Policy') &&
      !e.includes('Could not load')
    );
    expect(critical).toEqual([]);
  });

  test('login form visible', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('input[type=email],input[name=email],#login-email')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type=password],#login-password')).toBeVisible();
  });

  test('login Firebase flow', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('button[type=submit],#login-btn');

    // Espera autenticacao
    await page.waitForFunction(() => {
      return document.body.innerText.includes('Dashboard') ||
             document.body.innerText.includes('Arena PSM') ||
             document.querySelector('[data-logged-in]');
    }, { timeout: 15000 });

    expect(await page.evaluate(() => !!window.psmCurrentUser)).toBe(true);
  });

  test('remember password AES-GCM', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.check('#remember-me');
    await page.click('#login-btn');

    await page.waitForTimeout(2000);
    const stored = await page.evaluate(() => localStorage.getItem('psm_remember_pw'));
    expect(stored).toMatch(/^(aes:|enc:)/);  // Nao deve comecar com 'b64:' (plaintext)
  });
});

test.describe('Offline queue', () => {
  test('persists writes while offline', async ({ page, context }) => {
    await page.goto(BASE_URL);
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    await page.waitForTimeout(3000);

    // Simula offline
    await context.setOffline(true);

    // Tenta escrever
    await page.evaluate(() => {
      if (window.psmOffline) {
        return window.psmOffline.enqueue({ path: '/test', data: { v: 1 } });
      }
    });

    const queued = await page.evaluate(() => {
      return window.psmOffline && window.psmOffline.status().queued;
    });
    expect(queued).toBeGreaterThan(0);

    // Volta online
    await context.setOffline(false);
    await page.waitForTimeout(5000);

    // Fila deve esvaziar
    const drained = await page.evaluate(() => window.psmOffline.status().queued);
    expect(drained).toBe(0);
  });
});

test.describe('TV mode', () => {
  test('TV mode entra e sai sem memory leak', async ({ page }) => {
    await page.goto(BASE_URL);
    // ... login primeiro
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    await page.waitForTimeout(3000);

    const beforeHeap = await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize);

    // Entra TV 3x para testar leak
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.arenaTV && window.arenaTV());
      await page.waitForTimeout(2000);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    const afterHeap = await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize);

    // Heap nao deve crescer >50% (indicativo de leak)
    if (beforeHeap && afterHeap) {
      expect(afterHeap).toBeLessThan(beforeHeap * 1.5);
    }
  });
});

test.describe('Service Worker', () => {
  test('SW registra e cache funciona', async ({ page }) => {
    await page.goto(BASE_URL);
    const swActive = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!(reg && reg.active);
    });
    expect(swActive).toBe(true);
  });
});

test.describe('Backup', () => {
  test('Drive OAuth modal abre', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.fill('#login-email', TEST_USER);
    await page.fill('#login-password', TEST_PASS);
    await page.click('#login-btn');
    await page.waitForTimeout(3000);

    // Trigger backup Drive
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await page.evaluate(() => window.psmBackup && window.psmBackup.drive());
    const popup = await popupPromise;

    // Modal OAuth abriu
    expect(popup).toBeTruthy();
    if (popup) {
      expect(popup.url()).toContain('accounts.google.com');
      await popup.close();
    }
  });
});
