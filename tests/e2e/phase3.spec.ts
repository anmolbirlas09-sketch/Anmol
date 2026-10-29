// Phase 3 in the browser: load beams on looms, fabric take-off, grey stock,
// finishing a beam — the §8 steps 5–9 numbers, through the screens.
import { expect, test, type Page } from '@playwright/test';
import { admin } from '../db/db';

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

async function pick(page: Page, label: string, search: string, option: string | RegExp = search) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill(search);
  await page.getByRole('listbox').getByRole('option', { name: option }).first().click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // §8 steps 1–3 (yarn + beams), entered directly so this file stands alone.
  await admin(async (c) => {
    await c.query(`
      with f76 as (select id from factories where code = 'L-76'), f75 as (select id from factories where code = 'L-75'),
      a as (insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received)
            select 'P-101', id, (select id from f76), 1000 from yarn_qualities where name = 'Mono 0.25 White' returning id),
      b as (insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received)
            select 'P-202', id, (select id from f75), 500 from yarn_qualities where name = 'Mono 0.25 Black' returning id),
      b1 as (insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m)
             select 'P-001', id, (select id from f76), 3000 from fabric_qualities where name = 'Mono White' returning id),
      b2 as (insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m)
             select 'P-002', id, (select id from f75), 2000 from fabric_qualities where name = 'White/Black' returning id),
      b3 as (insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m)
             select 'P-003', id, (select id from f76), 500 from fabric_qualities where name = 'Mono White' returning id)
      insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs)
      select (select id from b1), (select id from a), 'warp'::yarn_usage_type, 400 union all
      select (select id from b1), (select id from a), 'weft', 300 union all
      select (select id from b2), (select id from a), 'warp', 250 union all
      select (select id from b2), (select id from b), 'weft', 200`);
  }, process.env.E2E_DB ?? 'weaving_e2e');
});

test('5. load beams; a stale form cannot double-load a loom', async ({ page, browser }) => {
  // The owner opens the load form first and picks L76-05 for P-002…
  const owner = await browser.newPage();
  await signIn(owner, 'owner@test.local');
  await owner.goto('/looms/load');
  await pick(owner, 'Beam', 'P-002', /P-002/);
  await pick(owner, 'Free loom', 'L76-05', 'L76-05');

  // …meanwhile data entry at L-76 loads P-001 on L76-05.
  await signIn(page, 'entry76@test.local');
  await page.goto('/looms/load');
  await pick(page, 'Beam', 'P-001', /P-001/);
  await expect(page.getByText('Warp 400.000 kg · Weft 300.000 kg')).toBeVisible();
  await pick(page, 'Free loom', 'L76-05', 'L76-05');
  await shot(page, '10-load-form');
  await page.getByRole('button', { name: 'Load on loom' }).click();
  await expect(page).toHaveURL(/\/looms\/[0-9a-f-]+\?loaded=1/);
  await expect(page.getByText('Beam P-001 loaded on L76-05')).toBeVisible();

  // The owner's stale form is refused by the database.
  await owner.getByRole('button', { name: 'Load on loom' }).click();
  await expect(owner.getByText('Loom L76-05 already has beam P-001 running. Finish or unload it first.')).toBeVisible();
  await shot(owner, '11-double-load-blocked');

  // P-002 goes on L75-12 instead — L-76 looms are listed first for an L-76 beam, so search.
  await pick(owner, 'Free loom', 'L75-12', 'L75-12');
  await owner.getByRole('button', { name: 'Load on loom' }).click();
  await expect(owner.getByText('Beam P-002 loaded on L75-12')).toBeVisible();

  // Loom grid: 2 running, 66 idle.
  await owner.goto('/looms?factory=all');
  await expect(owner.locator('[data-status="running"]')).toHaveCount(2);
  await expect(owner.locator('[data-status="idle"]')).toHaveCount(66);
  await expect(owner.getByText('1 running of 36')).toBeVisible();
  await expect(owner.getByText('1 running of 32')).toBeVisible();
  await shot(owner, '12-loom-grid');
  await owner.close();
});

test('6–7. take-offs build grey stock; wastage shows on the beam', async ({ page, browser }) => {
  await signIn(page, 'entry76@test.local');
  await page.goto('/takeoff');
  await pick(page, 'Loom', 'L76-05', 'L76-05');
  await expect(page.getByTestId('takeoff-beam')).toContainText('Beam P-001 · Mono White');
  await expect(page.getByTestId('takeoff-beam')).toContainText('0.00 m so far of ~2,912.62 m expected');
  await page.getByLabel('Meters').fill('1200');
  await page.getByLabel('Kgs').fill('650');
  await expect(page.getByText('1.846 m / kg')).toBeVisible();
  await page.getByLabel('Shift').selectOption('day');
  await page.getByLabel('Roll / piece no').fill('R-1');
  await shot(page, '13-takeoff-form');
  await page.getByRole('button', { name: 'Save take-off' }).click();
  await expect(page.getByText('Saved 1,200.00 m / 650.000 kg from L76-05')).toBeVisible();
  await expect(page.getByLabel('Meters')).toHaveValue('');
  await expect(page.getByTestId('takeoff-beam')).toContainText('1,200.00 m so far'); // refreshed
  await expect(page.getByRole('listitem').filter({ hasText: 'P-001' }).first()).toContainText('1,200.00 m');

  // Owner records L75-12 from the loom page.
  const owner = await browser.newPage();
  await signIn(owner, 'owner@test.local');
  await owner.goto('/looms?factory=all');
  await owner.getByRole('link', { name: /^L75-12,/ }).click();
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText('L75-12');
  await owner.getByLabel('Meters').fill('800');
  await owner.getByLabel('Kgs').fill('420');
  await owner.getByRole('button', { name: 'Save take-off' }).click();
  await expect(owner.getByText('Saved 800.00 m / 420.000 kg from L75-12')).toBeVisible();
  await shot(owner, '14-loom-page');

  // Grey stock: 2,000 m / 1,070 kg, split by quality and factory.
  await owner.goto('/grey');
  await expect(owner.getByTestId('grey-total')).toContainText('2,000.00');
  await expect(owner.getByTestId('grey-total')).toContainText('1,070.000');
  const list = owner.getByRole('list', { name: 'By fabric quality' });
  const mono = list.getByRole('listitem').filter({ has: owner.getByRole('heading', { name: 'Mono White' }) });
  const wb = list.getByRole('listitem').filter({ has: owner.getByRole('heading', { name: 'White/Black' }) });
  await expect(mono.first()).toContainText('1,200.00 m');
  await expect(mono.first()).toContainText('650.000 kg');
  await expect(mono.getByRole('listitem').filter({ hasText: 'L-76' })).toContainText('1,200.00 m · 650.000 kg');
  await expect(wb.first()).toContainText('800.00 m');
  await expect(wb.getByRole('listitem').filter({ hasText: 'L-75' })).toContainText('800.00 m · 420.000 kg');
  await shot(owner, '15-grey-stock');

  // L-75 only
  await owner.getByRole('link', { name: 'L-75' }).click();
  await expect(owner.getByTestId('grey-total')).toContainText('800.00');
  await owner.close();

  // 7. Beam P-001 wastage
  await page.goto('/beams?q=P-001');
  await page.getByRole('link', { name: /P-001/ }).click();
  const y = page.getByTestId('beam-yield');
  await expect(y).toContainText('50.000 kg');
  await expect(y).toContainText('(7.14%)');
  await expect(y).toContainText('1.846');
  await shot(page, '16-beam-yield');
});

test('9. finishing a beam frees its loom; "last fabric" finishes in the same step', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  await page.goto('/looms');
  await page.getByRole('link', { name: /^L76-05,/ }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Mark beam finished' }).click();
  await expect(page.getByText('No beam running')).toBeVisible();
  await page.goto('/looms');
  await expect(page.getByRole('link', { name: /^L76-05,/ })).toHaveAttribute('data-status', 'idle');

  // Supervisor-free path for the owner's beam: take-off with the finish box ticked.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, 'owner@test.local');
  await page.goto('/takeoff');
  await pick(page, 'Loom', 'L75-12', 'L75-12');
  await page.getByLabel('Meters').fill('5');
  await page.getByLabel('Kgs').fill('2');
  await page.getByText('This was the last fabric — mark the beam finished').click();
  await page.getByRole('button', { name: 'Save take-off' }).click();
  await expect(page.getByText('Beam P-002 finished; the loom is free')).toBeVisible();
  await expect(page.getByText('No looms are running. Load a beam first.')).toBeVisible();
});

test('finishing via take-off on a loom page confirms on that page', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  await page.goto('/looms/load');
  await pick(page, 'Beam', 'P-003', /P-003/);
  await pick(page, 'Free loom', 'L76-07', 'L76-07');
  await page.getByRole('button', { name: 'Load on loom' }).click();
  await expect(page.getByText('Beam P-003 loaded on L76-07')).toBeVisible();
  await page.getByLabel('Meters').fill('100');
  await page.getByLabel('Kgs').fill('50');
  await page.getByText('This was the last fabric — mark the beam finished').click();
  await page.getByRole('button', { name: 'Save take-off' }).click();
  await expect(page.getByText('Beam P-003 finished; the loom is free')).toBeVisible();
  await expect(page.getByText('No beam running')).toBeVisible();
});

test('data entry cannot delete take-offs; supervisor can, and grey stock follows', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  await page.goto('/takeoff');
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, 'owner@test.local');
  await page.goto('/takeoff');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('listitem').filter({ hasText: 'L75-12' }).filter({ hasText: '5.00 m' }).getByRole('button', { name: 'Delete' }).click();
  await page.goto('/grey');
  await expect(page.getByTestId('grey-total')).toContainText('2,100.00'); // 1,200 + 800 + P-003's 100
});
