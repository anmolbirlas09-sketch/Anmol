// Phase 4: dashboard cards, loom grid sheet, factory toggle, and live updates
// pushed to an open dashboard when someone else enters data.
import { expect, test, type Page } from '@playwright/test';
import { admin } from '../db/db';
import { fillProduction } from './production-helpers';

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !name.includes('sheet') });
};

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/** '1,23,456.78 m' → 123456.78 (first number in the text). */
const firstNumber = (s: string) => Number((/[\d,]+\.\d+|[\d,]+/.exec(s)?.[0] ?? '0').replace(/,/g, ''));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // A prepared beam with yarn, ready to load (independent of other spec files).
  await admin(async (c) => {
    await c.query(`
      with f76 as (select id from factories where code = 'L-76'),
      lot as (insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received)
              select 'D-401', id, (select id from f76), 800 from yarn_qualities where name = 'Mono 0.25 White' returning id),
      beam as (insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m)
               select 'D-001', id, (select id from f76), 1500 from fabric_qualities where name = 'Mono White' returning id)
      insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs)
      select (select id from beam), (select id from lot), 'warp'::yarn_usage_type, 200 union all
      select (select id from beam), (select id from lot), 'weft'::yarn_usage_type, 150`);
  }, process.env.E2E_DB ?? 'weaving_e2e');
});

test('the dashboard updates live while someone else loads a beam and records a take-off', async ({ page, browser }) => {
  await signIn(page, 'owner@test.local');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  const runningBefore = firstNumber((await page.getByTestId('stat-looms').textContent()) ?? '');
  const todayBefore = firstNumber((await page.getByTestId('stat-today').locator('.text-xl').textContent()) ?? '');
  await expect(page.getByTestId('stat-looms')).toContainText('/ 68');
  const tile = page.getByRole('button', { name: /^L76-20,/ });
  await expect(tile).toHaveAttribute('data-status', 'idle');
  await shot(page, '17-dashboard-before');

  // Someone at L-76, on their own phone:
  const floor = await browser.newPage();
  await signIn(floor, 'entry76@test.local');
  await floor.goto('/looms/load');
  await floor.getByLabel('Beam', { exact: true }).click();
  await floor.getByRole('combobox', { name: 'Search' }).fill('D-001');
  await floor.getByRole('listbox').getByRole('option', { name: /D-001/ }).click();
  await floor.getByLabel('Free loom', { exact: true }).click();
  await floor.getByRole('combobox', { name: 'Search' }).fill('L76-20');
  await floor.getByRole('listbox').getByRole('option', { name: 'L76-20' }).click();
  await floor.getByRole('button', { name: 'Load on loom' }).click();
  await expect(floor.getByText('Beam D-001 loaded on L76-20')).toBeVisible();

  // …the owner's dashboard turns L76-20 green without a reload.
  await expect(tile).toHaveAttribute('data-status', 'running', { timeout: 10_000 });
  await expect(page.getByTestId('stat-looms')).toContainText(`${runningBefore + 1} / 68`);

  await fillProduction(floor, { meters: '100', wasted: '0', roll: '50', weighed: '50' });
  await floor.getByRole('button', { name: 'Save production' }).click();
  await expect(floor.getByText('Saved: 100.00 m usable in 2 rolls from L76-20')).toBeVisible();

  await expect
    .poll(async () => firstNumber((await page.getByTestId('stat-today').locator('.text-xl').textContent()) ?? ''), { timeout: 10_000 })
    .toBeCloseTo(todayBefore + 100, 2);
  await expect(page.getByRole('status').filter({ hasText: 'updated' })).toBeVisible();

  // Tap the tile → sheet with the beam and its numbers.
  await tile.click();
  const sheet = page.getByRole('dialog', { name: 'L76-20' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('D-001');
  await expect(sheet).toContainText('Mono White');
  await expect(sheet).toContainText('100.00 m · 50.000 kg');
  await expect(sheet).toContainText('200.000 kg'); // warp
  await expect(sheet).toContainText('150.000 kg'); // weft
  await expect(sheet.getByRole('link', { name: 'Production' })).toHaveAttribute('href', /\/takeoff\?loom=/);
  await shot(page, '18-dashboard-sheet');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();

  // Finishing the beam elsewhere frees the loom on the open /looms page too.
  await page.goto('/looms?factory=all');
  const loomLink = page.getByRole('link', { name: /^L76-20,/ });
  await expect(loomLink).toHaveAttribute('data-status', 'running');
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  await floor.goto('/looms');
  await floor.getByRole('link', { name: /^L76-20,/ }).click();
  floor.once('dialog', (d) => d.accept());
  await floor.getByRole('button', { name: 'Mark beam finished' }).click();
  await expect(floor.getByText('No beam running')).toBeVisible();
  await expect(loomLink).toHaveAttribute('data-status', 'idle', { timeout: 10_000 });
  await floor.close();
});

test('factory toggle and factory staff defaults', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.getByRole('link', { name: 'L-75', exact: true }).click();
  await expect(page.getByTestId('stat-looms')).toContainText('/ 32');
  await expect(page.getByRole('region', { name: 'L-76' })).toHaveCount(0);
  await expect(page.getByText('Lots received at this factory.')).toBeVisible();
  await shot(page, '19-dashboard-l75');

  // L-76 staff land on their own factory, and the sheet hides actions for other factories.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, 'entry76@test.local');
  await expect(page.getByTestId('stat-looms')).toContainText('/ 36');
  await page.getByRole('link', { name: 'All', exact: true }).click();
  await expect(page.getByTestId('stat-looms')).toContainText('/ 68');
  await page.getByRole('button', { name: /^L75-01,/ }).click();
  const sheet = page.getByRole('dialog', { name: 'L75-01' });
  await expect(sheet.getByRole('link', { name: 'Open loom' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Load beam' })).toHaveCount(0);
});
