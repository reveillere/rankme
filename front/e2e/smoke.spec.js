import { test, expect } from '@playwright/test';
import { AUTHOR } from './mockApi.js';
import { installGuards, skipAboutDialog } from './guards.js';

installGuards();

test('first visit shows the About dialog, which can be closed', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('pulls their publication list');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Search author on DBLP' })).toBeVisible();
});

test('search an author on DBLP and open their ranked publications', async ({ page }) => {
  await skipAboutDialog(page);
  await page.goto('/');
  const box = page.getByPlaceholder('Author name');
  await box.fill('Ada');
  await box.press('Enter');

  await expect(page.getByText(`PID: ${AUTHOR.pid}`)).toBeVisible();
  await page.getByText(AUTHOR.name).first().click();

  await expect(page).toHaveURL(`/dblp/${AUTHOR.pid}`);
  await expect(page.getByText(`DBLP records of ${AUTHOR.name}`)).toBeVisible();
  await expect(page.getByText('Showing all 4 records')).toBeVisible();
  await expect(page.getByText('Testing Things at Scale.')).toBeVisible();
  await expect(page.getByText('International Conference on Software Engineering (ICSE)')).toBeVisible();
  await expect(page.getByText('Update completed!')).toBeVisible();
});

test('an author page opens directly from its URL', async ({ page }) => {
  await skipAboutDialog(page);
  await page.goto(`/dblp/${AUTHOR.pid}`);
  await expect(page.getByText(`DBLP records of ${AUTHOR.name}`)).toBeVisible();
  await expect(page.getByText('Testing Things at Scale.')).toBeVisible();
});

test('a DBLP search with no match says so', async ({ page }) => {
  await skipAboutDialog(page);
  await page.goto('/');
  const box = page.getByPlaceholder('Author name');
  await box.fill('nobody');
  await box.press('Enter');
  await expect(page.getByText('No result!')).toBeVisible();
});

test('the HAL tab switches the search to HAL', async ({ page }) => {
  await skipAboutDialog(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'HAL' }).click();
  await expect(page.getByRole('heading', { name: 'Search author on HAL' })).toBeVisible();
  const box = page.getByPlaceholder('Author name');
  await box.fill('nobody');
  await box.press('Enter');
  await expect(page.getByText('No result!')).toBeVisible();
});

test('the admin page loads its own chunk and asks for a token', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByText('Admin dashboard')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
});
