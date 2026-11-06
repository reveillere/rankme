import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

// Fails the test on any uncaught page error or React render error, which
// is how a broken dependency upgrade usually shows up.
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // The browser's own log line for a non-2xx response, e.g. the mocked
    // 401 from /api/auth/me. Not an app error.
    if (text.startsWith('Failed to load resource')) return;
    errors.push(text);
  });
  return errors;
}

export const skipAboutDialog = (page) =>
  page.addInitScript(() => localStorage.setItem('rankme:hideAboutOnStart', 'true'));

// Every test gets the mocked API, and fails on an unmocked API call or a
// page error.
export function installGuards() {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.unhandled = await mockApi(page);
    testInfo.errors = collectErrors(page);
  });

  // Playwright needs the fixtures argument destructured, even when empty.
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, testInfo) => {
    expect(testInfo.unhandled, 'API calls not mocked in e2e/mockApi.js').toEqual([]);
    expect(testInfo.errors, 'page errors').toEqual([]);
  });
}
