// Phase 2 in the browser on a phone-sized screen: sign in, yarn inward,
// beam creation, warp/weft consumption with live stock checks.
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SCREENSHOTS; // optional folder for review screenshots

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

async function pick(page: Page, label: string, option: string | RegExp) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill(typeof option === 'string' ? option : '');
  await page.getByRole('option', { name: option }).first().click();
}

test.describe.configure({ mode: 'serial' });

test('signed-out visitors are sent to sign in, and bad passwords are refused', async ({ page }) => {
  await page.goto('/yarn');
  await expect(page).toHaveURL(/\/login\?next=%2Fyarn/);
  await page.getByLabel('Email').fill('entry76@test.local');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong email or password' })).toBeVisible();
  await shot(page, '01-login-error');
});

test('data entry: yarn inward → beam → warp and weft consumption', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  await expect(page.getByText('Data entry · L-76')).toBeVisible();
  await shot(page, '02-home');

  // --- Yarn inward A-101 -------------------------------------------------
  await page.getByRole('link', { name: '+ Inward' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Required').first()).toBeVisible(); // validation before saving
  await page.getByLabel('Lot no').fill('a-101');
  await pick(page, 'Yarn quality', 'Mono 0.25 White');
  await page.getByLabel('Kgs received').fill('1000');
  await expect(page.getByLabel('Received at')).toHaveValue(/.+/);
  await expect(page.getByLabel('Received at').locator('option')).toHaveCount(1); // L-76 staff: only L-76
  await page.getByLabel('Challan no').fill('CH-501');
  await shot(page, '03-inward-form');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page).toHaveURL(/\/yarn\?saved=A-101/);
  await expect(page.getByText('Lot A-101 saved')).toBeVisible();
  const lotCard = page.getByRole('link', { name: /A-101/ });
  await expect(lotCard).toContainText('1,000.000');
  await shot(page, '04-yarn-list');

  // Duplicate lot no → message under the field, values kept
  await page.goto('/yarn/new');
  await page.getByLabel('Lot no').fill('A-101');
  await pick(page, 'Yarn quality', 'Mono 0.25 White');
  await page.getByLabel('Kgs received').fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('This lot no already exists')).toBeVisible();
  await expect(page.getByLabel('Kgs received')).toHaveValue('5');
  await expect(page.getByLabel('Yarn quality', { exact: true })).toContainText('Mono 0.25 White');

  // --- Beam B-001 ---------------------------------------------------------
  await page.goto('/beams/new');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Beam number').fill('b-001');
  await page.getByLabel('Fabric quality number').selectOption({ label: 'Mono White' });
  // its only specification is picked automatically and shown
  await expect(page.getByLabel('Specification', { exact: true }).locator('option:checked')).toContainText('MONOWHITE-S1');
  await expect(page.getByTestId('spec-details')).toContainText('Mono 0.25 White');
  await page.getByLabel('Counter meter (m)').fill('3000');
  await shot(page, '05-new-beam');
  await page.getByRole('button', { name: 'Save beam card' }).click();

  await expect(page).toHaveURL(/\/beams\/[0-9a-f-]+\?saved=1/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beam B-001');
  await expect(page.getByText('Beam card B-001 saved')).toBeVisible();
  await expect(page.getByText('259.560')).toBeVisible(); // planned warp kg

  // --- Warp 400 + weft 300 from A-101 ------------------------------------
  await pick(page, 'Yarn lot', /A-101/);
  await expect(page.getByText('1,000.000 kg available')).toBeVisible();
  await page.getByLabel('Kgs').fill('400');
  await page.getByRole('button', { name: 'Add yarn' }).click();
  await expect(page.getByText('Yarn added')).toBeVisible();
  await expect(page.getByLabel('Kgs')).toHaveValue('');

  await page.getByRole('group', { name: 'Used for' }).getByText('Weft').click();
  await expect(page.getByRole('radio', { name: 'Weft' })).toBeChecked();
  await pick(page, 'Yarn lot', /A-101/);
  await expect(page.getByText('600.000 kg available')).toBeVisible(); // live balance after the warp line
  await page.getByLabel('Kgs').fill('300');
  await page.getByRole('button', { name: 'Add yarn' }).click();
  await expect(page.getByText('Yarn added')).toBeVisible();

  const table = page.getByRole('table', { name: 'Planned vs actual (kg)' });
  await expect(table.getByRole('row', { name: /Warp/ })).toContainText('400.000');
  await expect(table.getByRole('row', { name: /Weft/ })).toContainText('300.000');
  await expect(table.getByRole('row', { name: /Total/ })).toContainText('700.000');
  await expect(table.getByRole('row', { name: /Warp/ })).toContainText('+54.11%'); // 400 vs 259.56 planned → flagged
  await expect(table.getByRole('row', { name: /Warp/ }).locator('[data-flag]')).toBeVisible();

  // --- Over-drawing is blocked in the form ------------------------------
  await pick(page, 'Yarn lot', /A-101/);
  await expect(page.getByText('300.000 kg available')).toBeVisible();
  await page.getByLabel('Kgs').fill('300.5');
  await expect(page.getByText('Only 300.000 kg left in this lot')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add yarn' })).toBeDisabled();

  // Data entry users cannot delete lines
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await shot(page, '06-beam-detail');

  // --- Lot ledger ---------------------------------------------------------
  await page.goto('/yarn');
  await page.getByRole('link', { name: /A-101/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lot A-101');
  await expect(page.getByText('300.000').first()).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Warp · B-001' })).toContainText('-400.000');
  await shot(page, '07-lot-ledger');
});

test('the database still blocks over-drawing if two people race for the same yarn', async ({ page, browser }) => {
  await signIn(page, 'sup76@test.local');
  await page.goto('/beams');
  await page.getByRole('link', { name: /B-001/ }).click();
  await pick(page, 'Yarn lot', /A-101/);
  await expect(page.getByText('300.000 kg available')).toBeVisible();
  await page.getByLabel('Kgs').fill('200');

  // Meanwhile someone else uses 150 kg of A-101 on the same beam.
  const other = await browser.newPage();
  await signIn(other, 'owner@test.local');
  await other.goto(page.url());
  await pick(other, 'Yarn lot', /A-101/);
  await other.getByLabel('Kgs').fill('150');
  await other.getByRole('button', { name: 'Add yarn' }).click();
  await expect(other.getByText('Yarn added')).toBeVisible();
  await other.close();

  // Our stale form still thinks 300 kg is there — the server says no.
  await page.getByRole('button', { name: 'Add yarn' }).click();
  await expect(page.getByText('Not enough yarn in lot A-101 — only 150.000 kg available.')).toBeVisible();
  await expect(page.getByLabel('Kgs')).toHaveValue('200');
  await shot(page, '08-race-blocked');
});

test('supervisor can delete a consumption line and the stock comes back', async ({ page }) => {
  await signIn(page, 'sup76@test.local');
  await page.goto('/beams');
  await page.getByRole('link', { name: /B-001/ }).click();
  page.once('dialog', (d) => d.accept());
  const warpCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Warp' }) });
  await warpCard.getByRole('button', { name: 'Delete' }).last().click(); // the owner's 150 kg line
  await expect(warpCard.getByText('400.000 kg')).toBeVisible();
  await page.goto('/yarn');
  await expect(page.getByRole('link', { name: /A-101/ })).toContainText('300.000');
});

test('masters: supervisor adds a yarn quality that appears in the inward picker', async ({ page }) => {
  await signIn(page, 'sup76@test.local');
  await page.goto('/masters/yarn-qualities');
  await page.getByRole('link', { name: '+ Add' }).click();
  await page.getByLabel('Name').fill('Mono 0.20 Blue');
  await page.getByLabel('Denier').fill('270');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByRole('link', { name: /Mono 0.20 Blue/ })).toContainText('270 D');
  await shot(page, '09-masters');

  await page.goto('/yarn/new');
  await page.getByLabel('Yarn quality', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill('blue');
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('Mono 0.20 Blue');
});
