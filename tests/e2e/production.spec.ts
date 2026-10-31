// Metre-first production entry on a phone: the 680-metre example end to end.
import { expect, test, type Page } from '@playwright/test';
import { admin } from '../db/db';

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: Page, name: string, fullPage = true) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // A Mono White beam running on L76-15 and another on L76-16.
  await admin(async (c) => {
    for (const [beam, loom] of [['MF-001', 'L76-15'], ['MF-002', 'L76-16']]) {
      await c.query(
        `with b as (insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m)
                    select $1, id, (select id from factories where code = 'L-76'), 3000 from fabric_qualities where name = 'Mono White' returning id)
         select load_beam((select id from b), (select id from looms where machine_no = $2))`,
        [beam, loom],
      );
    }
  }, process.env.E2E_DB ?? 'weaving_e2e');
});

test('680 m produced, 33 m wasted → 647 m usable, 4.85 %, 7 rolls; no KG needed', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  await page.goto('/takeoff');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Production entry');

  // Step 1
  await page.getByLabel('Loom', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill('L76-15');
  await page.getByRole('listbox').getByRole('option', { name: 'L76-15' }).click();
  await expect(page.getByLabel('Fabric quality', { exact: true }).locator('option:checked')).toHaveText('Mono White');

  // Steps 2–4
  await page.getByLabel('Total production (m)').fill('680');
  await page.getByLabel('Roll length (m)').fill('100');
  await page.getByLabel('How many metres of fabric were wasted?').fill('700');
  await expect(page.getByText('Wasted metres cannot be more than total production')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save production' })).toBeDisabled();
  await page.getByLabel('How many metres of fabric were wasted?').fill('33');

  // Step 5: automatic
  await expect(page.getByTestId('fig-total')).toContainText('680.00 m');
  await expect(page.getByTestId('fig-wasted')).toContainText('33.00 m');
  await expect(page.getByTestId('fig-net')).toContainText('647.00 m');
  await expect(page.getByTestId('fig-pct')).toContainText('4.85%');
  await expect(page.getByTestId('rolls-preview')).toHaveText('7 rolls: 6 × 100 m + 1 × 47 m');

  // No KG questions until a KG figure is entered
  await expect(page.getByRole('region', { name: 'Weight wastage' })).toHaveCount(0);
  await shot(page, '24-production-form');

  await page.getByRole('button', { name: 'Save production' }).click();
  await expect(page.getByText('Saved: 647.00 m usable in 7 rolls from L76-15')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'MF-001' }).first();
  await expect(row).toContainText('680.00 m');
  await expect(row).toContainText('Net usable 647.00 m · Wasted 33.00 m (4.85%)');
  await expect(row).toContainText('7 rolls');
});

test('optional weights: estimated vs actual, and KG wastage asked only when KG is entered', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  await page.goto('/takeoff');
  await page.getByLabel('Loom', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill('L76-16');
  await page.getByRole('listbox').getByRole('option', { name: 'L76-16' }).click();
  await page.getByLabel('Total production (m)').fill('250');
  await page.getByLabel('Roll length (m)').fill('50');
  await page.getByLabel('How many metres of fabric were wasted?').fill('0');

  await page.locator('details').filter({ hasText: 'Weight (optional)' }).locator('summary').click();
  await expect(page.getByTestId('estimated-kg')).toContainText('Enter GSM and width');
  await page.getByLabel('GSM').fill('65');
  await page.getByLabel('Fabric width (m)').fill('1.5');
  await expect(page.getByTestId('estimated-kg')).toContainText('24.375 kg');
  await expect(page.getByTestId('estimated-kg')).toContainText('estimated');

  await page.getByLabel('Warp yarn used (kg)').fill('15');
  const kg = page.getByRole('region', { name: 'Weight wastage' });
  await expect(kg).toBeVisible();
  await page.getByLabel('Weft yarn used (kg)').fill('12');
  await kg.getByLabel('What is the wastage percentage, if known?').fill('5');
  await expect(page.getByTestId('waste-kg-estimated')).toHaveText('1.350 kg');
  await kg.getByLabel('What is the actual fabric wastage in kg, if measured?').fill('1');
  await page.getByRole('button', { name: 'Save production' }).click();
  await expect(page.getByText('Enter the waste in kg or as a %, not both')).toBeVisible();
  await kg.getByLabel('What is the wastage percentage, if known?').fill('');
  await expect(page.getByTestId('weight-wastage-actual')).toHaveText('3.70%');
  await shot(page, '25-production-weights');
  await page.getByRole('button', { name: 'Save production' }).click();
  await expect(page.getByText('Saved: 250.00 m usable in 5 rolls from L76-16')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'MF-002' }).first()).toContainText('≈24.375 kg estimated');
});

test('reports: production register, beam register and roll tracking with filters', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/reports');
  await page.getByRole('link', { name: /Production register/ }).click();
  await page.getByLabel('Beam no').fill('mf-001');
  await page.getByRole('button', { name: 'Show' }).click();
  const t = page.getByRole('table', { name: 'Production register' });
  await expect(t.getByRole('row')).toHaveCount(3); // header + 1 entry + totals
  const r = t.getByRole('row').filter({ hasText: 'MF-001' });
  for (const v of ['680.00', '33.00', '647.00', '4.85%']) await expect(r).toContainText(v);
  await shot(page, '26-production-report');

  await page.goto('/reports/rolls?beam=MF-001');
  const rolls = page.getByRole('table', { name: 'Roll tracking' });
  await expect(rolls.getByRole('row').filter({ hasText: /L76-15-\d{6}-07/ })).toContainText('47.00');
  await expect(rolls.locator('tfoot')).toContainText('647.00');

  await page.goto('/reports/beam-register?beam=MF-002');
  const b = page.getByRole('table', { name: 'Beam register' }).getByRole('row').filter({ hasText: 'MF-002' });
  for (const v of ['250.00', '24.375', '27.000', '1.000']) await expect(b).toContainText(v);
});
