import { test, expect } from '@playwright/test';
import { AUTHOR, COLLEAGUE, STRUCTURE, HAL_ID } from './mockApi.js';
import { installGuards, skipAboutDialog } from './guards.js';

installGuards();

test.beforeEach(async ({ page }) => {
  await skipAboutDialog(page);
});

test('create a DBLP team from two searched authors and open its merged publications', async ({ page }) => {
  await page.goto('/teams');
  await page.getByRole('button', { name: 'New team' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Team name').fill('My team');
  await dialog.getByRole('checkbox', { name: 'DBLP' }).check();
  await dialog.getByRole('button', { name: 'Continue' }).click();

  const search = dialog.getByPlaceholder('Author name');
  for (const author of [AUTHOR, COLLEAGUE]) {
    await search.fill('Ada');
    await page.getByText(`PID: ${author.pid}`).click();
    await expect(dialog.getByText(`${author.name} (pid: ${author.pid})`)).toBeVisible();
  }
  await expect(dialog.getByText('Members (2)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save team' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText('2 members')).toBeVisible();
  await page.getByText('My team').click();
  await expect(page).toHaveURL(/\/team\/team-/);
  await expect(page.getByText('DBLP records of My team')).toBeVisible();
  await expect(page.getByText('Team of 2 members')).toBeVisible();
  await expect(page.getByText('Showing all 4 deduplicated records')).toBeVisible();
  await expect(page.getByText('Testing Things at Scale.')).toBeVisible();
});

test('the structures tab offers a HAL structure search', async ({ page }) => {
  await page.goto('/structures');
  await expect(page.getByText('Search a structure on HAL')).toBeVisible();
});

test('a HAL structure page lists its ranked publications', async ({ page }) => {
  await page.goto(`/structure/${STRUCTURE.id}`);
  await expect(page.getByText(`HAL records of ${STRUCTURE.name}`)).toBeVisible();
  await expect(page.getByText('Showing all 3 records')).toBeVisible();
  await expect(page.getByText('Testing Things at Scale')).toBeVisible();
  await expect(page.getByText('Update completed!')).toBeVisible();
});

test('a DBLP to HAL cross-check sorts publications into missing, to review and confirmed', async ({ page }) => {
  await page.goto(`/crosscheck/dblp/${AUTHOR.pid}/hal/${HAL_ID}`);
  await expect(page.getByText(`DBLP → HAL cross-check for ${AUTHOR.name}`)).toBeVisible();
  await expect(page.getByText('Missing from HAL (1)')).toBeVisible();
  await expect(page.getByText('Automated Things.')).toBeVisible();
  await expect(page.getByText('To review (1)')).toBeVisible();
  await expect(page.getByText('Confirmed automatically (1)')).toBeVisible();
});

test('the settings, categories and help dialogs open without errors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'settings' }).click();
  const settings = page.getByRole('dialog');
  await expect(settings.getByText('Conference ranking')).toBeVisible();
  for (const tab of ['Match corrections', 'Identity links', 'Rankings']) {
    await settings.getByRole('tab', { name: tab }).click();
  }
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await page.getByRole('button', { name: 'publication categories' }).click();
  await expect(page.getByText('Publication categories')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('dialog').getByText('RankMe help')).toBeVisible();
});
