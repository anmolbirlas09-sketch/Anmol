// Parent fabric quality with several specifications, end to end on a phone:
// masters → beam → loom → production → stock → dashboard → report.
import { expect, test, type Page } from '@playwright/test';
import { admin } from '../db/db';
import { fillProduction } from './production-helpers';

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

async function pickYarn(page: Page, label: string, name: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill(name);
  await page.getByRole('listbox').getByRole('option', { name: new RegExp(`^${name.replace('.', '\\.')}`) }).first().click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await admin((c) => c.query(`insert into yarn_qualities (name, denier) values ('PP 0.17', 210), ('PT 0.125', 150) on conflict do nothing`),
    process.env.E2E_DB ?? 'weaving_e2e');
});

test('owner creates Quality 101 with three specifications; reed and ends per inch are separate', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/masters/fabric-qualities/new');
  await page.getByLabel('Name').fill('Quality 101');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('region', { name: 'Specifications' })).toContainText('No specifications yet');

  const specs = [
    ['48', '52', 'PP 0.17', 'PP 0.17'],
    ['52', '56', 'PT 0.125', 'PP 0.17'],
    ['56', '60', 'PT 0.125', 'PT 0.125'],
  ];
  for (const [i, [reed, epi, warp, weft]] of specs.entries()) {
    await page.getByRole('link', { name: '+ Add specification' }).click();
    await expect(page.getByTestId('spec-code')).toHaveText('Assigned automatically when saved');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Reed').fill(reed);
    await page.getByLabel('Total ends per inch').fill(epi);
    await pickYarn(page, 'Warp yarn', warp);
    await pickYarn(page, 'Weft yarn', weft);
    if (i === 2) await shot(page, '27-spec-form');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Specification saved')).toBeVisible();
  }
  const list = page.getByRole('region', { name: 'Specifications' });
  await expect(list.locator('[data-spec]')).toHaveCount(3);
  await expect(list.locator('[data-spec="QUALITY101-S2"]')).toContainText('Reed 52');
  await expect(list.locator('[data-spec="QUALITY101-S2"]')).toContainText('Ends/inch 56');
  await expect(list.locator('[data-spec="QUALITY101-S2"]')).toContainText('Warp PT 0.125 · Weft PP 0.17');

  // Same combination again is refused
  await page.getByRole('link', { name: '+ Add specification' }).click();
  await expect(page.getByTestId('spec-code')).toHaveText('Assigned automatically when saved');
  await page.waitForLoadState('networkidle'); // let the form hydrate before typing
  await page.getByLabel('Reed').fill('48');
  await expect(page.getByLabel('Reed')).toHaveValue('48');
  await page.getByLabel('Total ends per inch').fill('52');
  await pickYarn(page, 'Warp yarn', 'PP 0.17');
  await pickYarn(page, 'Weft yarn', 'PP 0.17');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('already has a specification with the same reed')).toBeVisible();

  // Search by Specification ID
  await page.goto('/masters/fabric-qualities?q=quality101-s3');
  const card = page.locator('[data-quality="Quality 101"]');
  await expect(card.locator('[data-spec]')).toHaveCount(1);
  await expect(card).toContainText('QUALITY101-S3');
  await shot(page, '28-quality-list');
});

test('a beam of S2 is woven and recorded against S2, with its reed, ends and yarns shown', async ({ page }) => {
  await signIn(page, 'entry76@test.local');
  await page.goto('/beams/new');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Beam number').fill('q101-b2');
  await page.getByLabel('Fabric quality number').selectOption({ label: 'Quality 101' });
  const specSelect = page.getByLabel('Specification', { exact: true });
  await specSelect.selectOption((await specSelect.locator('option', { hasText: 'QUALITY101-S2' }).getAttribute('value'))!);
  await expect(page.getByTestId('spec-details')).toContainText('52');
  await expect(page.getByTestId('spec-details')).toContainText('56');
  await page.getByLabel('Counter meter (m)').fill('2000');
  // load it on a loom from the same card
  const loomSelect = page.getByLabel('Loom number');
  await loomSelect.selectOption((await loomSelect.locator('option', { hasText: 'L76-30' }).getAttribute('value'))!);
  await page.getByRole('button', { name: 'Save and load on loom' }).click();
  await expect(page.getByTestId('beam-spec')).toHaveText('QUALITY101-S2');
  await expect(page.getByTestId('beam-loom')).toHaveText('On loom L76-30');
  await page.getByRole('link', { name: 'Production', exact: true }).click();

  // Production entry on that loom: parent and specification come from the beam, details shown
  await expect(page.getByTestId('takeoff-beam')).toContainText('Beam Q101-B2 · Quality 101 · QUALITY101-S2');
  const d = page.getByTestId('takeoff-beam').getByTestId('spec-details');
  for (const t of ['52', '56', 'PP 0.17', 'PT 0.125']) await expect(d).toContainText(t);
  await fillProduction(page, { meters: '300', wasted: '12', roll: '100' });
  await shot(page, '29-production-spec');
  await page.getByRole('button', { name: 'Save production' }).click();
  await expect(page.getByText('Saved: 288.00 m usable in 3 rolls from L76-30')).toBeVisible();
});

test('stock, dashboard and report show the parent with its specifications', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/grey?factory=all');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Quality 101' }) });
  await expect(card.locator('[data-spec="QUALITY101-S2"]')).toContainText('288.00 m');

  await page.goto('/?factory=all');
  await page.getByTestId('toggle-specs').click();
  await expect(page.locator('tr[data-spec="QUALITY101-S2"]')).toContainText('288.00');

  await page.goto('/reports');
  await page.getByRole('link', { name: /Specification and quality summary/ }).click();
  // (report filter labels wrap their dropdowns, so match the label text partially)
  await page.getByLabel('Fabric quality').selectOption({ label: 'Quality 101' });
  await page.getByRole('button', { name: 'Show' }).click();
  const t = page.getByRole('table', { name: 'Specification and quality summary' });
  await expect(t.locator('tr[data-level="parent"]')).toContainText('3 specifications');
  await expect(t.locator('tr[data-level="spec"]')).toHaveCount(3);
  await expect(t.locator('tr[data-level="spec"]').filter({ hasText: 'QUALITY101-S2' })).toContainText('288.00');
  await shot(page, '30-spec-report');
  await page.getByLabel('Specifications').selectOption('0');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(t.locator('tr[data-level="spec"]')).toHaveCount(0);
});
