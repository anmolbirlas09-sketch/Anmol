// (Named to run after the phase suites, which assert exact stock totals.)
// Digital beam card + time-stamped production, end to end on a phone:
// empty card → complete later → load from the loom → readings at 5:10 / 7:25 PM →
// replace the beam → history and reports.
import { expect, test, type Page } from '@playwright/test';

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

async function pickOption(page: Page, label: string, text: string) {
  const sel = page.getByLabel(label, { exact: true });
  await sel.selectOption((await sel.locator('option', { hasText: text }).first().getAttribute('value'))!);
}

test.describe.configure({ mode: 'serial' });

test('an empty beam card can be saved, then completed later', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/beams/new');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Load new beam');
  for (const g of ['Beam identification', 'Fabric quality and specification', 'Warp and weft details', 'Measurements and weight', 'Weaving details', 'Beam dates', 'Loom assignment']) {
    await expect(page.getByRole('group', { name: g })).toBeVisible();
  }
  await shot(page, '31-beam-card-form');
  await page.getByRole('button', { name: 'Save beam card' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Beam CARD-\d+$/);
  await expect(page.getByTestId('card-missing')).toHaveText('20 of 20 card fields not filled in yet');

  await page.getByRole('link', { name: 'Complete missing information' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Beam number').fill('bc-77');
  await page.getByLabel('Total number of ends').fill('4200');
  await page.getByLabel('G.W. — gross weight (kg)').fill('260');
  await page.getByLabel('Weave').fill('Plain');
  await page.getByRole('button', { name: 'Save beam card' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beam BC-77');
  await expect(page.getByTestId('card-missing')).toHaveText('16 of 20 card fields not filled in yet');
  const card = page.getByTestId('beam-card');
  await expect(card.locator('[data-field="Total number of ends"]')).toHaveText('4200');
  await expect(card.locator('[data-field="Weave"]')).toHaveText('Plain');
  await expect(card.locator('[data-field="Rolling meter (m)"]')).toHaveText('Not set');
});

test('load a new beam from the loom; record readings with the actual time; metres from the counter', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  // tap the idle loom on the dashboard grid → "Load new beam"
  await page.getByRole('button', { name: /^L76-27\b/ }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Load new beam' }).click();
  await page.waitForLoadState('networkidle');
  // the loom is already chosen
  await expect(page.getByLabel('Loom number').locator('option:checked')).toContainText('L76-27');
  await page.getByLabel('Beam number').fill('bc-78');
  await page.getByLabel('Fabric quality number').selectOption({ label: 'Mono White' });
  await page.getByRole('button', { name: 'Save and load on loom' }).click();
  await expect(page.getByTestId('beam-loom')).toHaveText('On loom L76-27');
  await page.getByRole('link', { name: 'Production', exact: true }).click();

  // 5:10 PM: counter 1,085, 85 m typed (no earlier reading on this loom)
  await expect(page.getByTestId('takeoff-beam')).toContainText('Beam BC-78 · Mono White · MONOWHITE-S1');
  await page.getByLabel('Production time').fill('17:10');
  await expect(page.getByLabel('Shift')).toHaveValue('day');
  await page.getByLabel('Current counter meter reading').fill('1085');
  await expect(page.getByText('No earlier counter reading on this loom')).toBeVisible();
  await page.getByLabel('Production metres').fill('85');
  await page.getByRole('button', { name: 'Save production' }).click();
  await expect(page.getByText('Saved: 85.00 m usable from L76-27')).toBeVisible();

  // 7:25 PM: counter 1,172 → 87 m worked out, nothing else typed
  await page.getByLabel('Production time').fill('19:25');
  await page.getByLabel('Current counter meter reading').fill('1172');
  await expect(page.getByText(/^Previous reading 1,085\.00/)).toBeVisible();
  await expect(page.getByTestId('counter-meters')).toHaveText('87.00 m from the counter');
  await expect(page.getByTestId('fig-total')).toContainText('87.00 m');
  await shot(page, '32-production-counter');
  await page.getByRole('button', { name: 'Save production' }).click();
  await expect(page.getByText('Saved: 87.00 m usable from L76-27')).toBeVisible();

  // a lower reading is not saved as negative production
  await page.getByLabel('Current counter meter reading').fill('20');
  await expect(page.getByText('Lower than the previous reading.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save production' })).toBeDisabled();
  await page.getByLabel('Current counter meter reading').fill('');

  // history in time order with the time shown
  const list = page.getByRole('listitem').filter({ has: page.getByTestId('production-time') });
  await expect(list.first()).toContainText('7:25 PM');
  await expect(list.first().getByTestId('counter-row')).toContainText('Counter reading 1,172.00 · previous reading 1,085.00 · counter');
});

test('replace the running beam (finish it); history is kept on both beams and the loom', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  await page.goto('/beams?q=bc-78');
  await page.getByRole('link', { name: /BC-78/ }).click();
  await page.getByTestId('beam-loom').click();
  await page.getByRole('link', { name: 'Load new beam' }).first().click();
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Beam number').fill('bc-79');
  await expect(page.getByText('L76-27 is running beam BC-78. What should happen to it?')).toBeVisible();
  // data entry can finish the running beam; unloading it unfinished is for a supervisor
  await expect(page.getByLabel('Take beam BC-78 off unfinished (it can be loaded again later)')).toHaveCount(0);
  await page.getByLabel('Beam BC-78 is finished (fully woven)').check();
  await page.getByRole('button', { name: 'Save and load on loom' }).click();
  await expect(page.getByTestId('beam-loom')).toHaveText('On loom L76-27');

  await page.goto('/beams?q=bc-78');
  await page.getByRole('link', { name: /BC-78/ }).click();
  const hist = page.getByRole('list', { name: 'Loading and unloading history' });
  await expect(hist.locator('[data-event]')).toHaveCount(2);
  await expect(hist.locator('[data-event="finished"]')).toContainText('172.00 m woven by then');
  await expect(page.getByTestId('beam-card').locator('[data-field="Beam finish date – actual"]')).not.toHaveText('Not set');
  await shot(page, '33-beam-history');
});

test('shift-wise and daily reports, with time filters', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/reports');
  await page.getByRole('link', { name: /Shift-wise production/ }).click();
  const t = page.getByRole('table', { name: 'Shift-wise production' });
  await expect(t.getByRole('row').filter({ hasText: 'L76-27' })).toContainText('172.00');

  await page.goto('/reports/production?loom=&beam=BC-78&tfrom=19:00&tto=20:00');
  const r = page.getByRole('table', { name: 'Production register' });
  await expect(r.getByRole('row').filter({ hasText: 'BC-78' })).toHaveCount(1);
  await expect(r.getByRole('row').filter({ hasText: 'BC-78' })).toContainText('7:25 PM');

  await page.goto('/reports/daily?group=beam');
  await expect(page.getByRole('table', { name: 'Daily production' }).getByRole('row').filter({ hasText: 'BC-78' })).toContainText('172.00');
  await shot(page, '34-daily-report');
});

test('leave the loom free for the other suites: finish BC-79', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/beams?q=bc-79');
  await page.getByRole('link', { name: /BC-79/ }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Mark beam finished' }).click();
  await expect(page.getByText(/^Finished \d{2}-\d{2}-\d{4}/)).toBeVisible();
});
