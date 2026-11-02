// Phase 5 in the browser: dispatch, reports + Excel/PDF downloads, opening
// stock import, stock adjustment, owner settings and role-based menus.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { admin } from '../db/db';

// Plain require: Playwright's ESM loader cannot link some of exceljs's CommonJS dependencies.
const ExcelJS = createRequire(import.meta.url)('exceljs') as typeof import('exceljs');

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const DB = process.env.E2E_DB ?? 'weaving_e2e';

async function signIn(page: Page, email: string, password = 'password123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

async function pick(page: Page, label: string, search: string, option: string | RegExp = search) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill(search);
  await page.getByRole('listbox').getByRole('option', { name: option }).first().click();
}

const firstNumber = (s: string) => Number((/[\d,]+\.\d+|[\d,]+/.exec(s)?.[0] ?? '0').replace(/,/g, ''));

async function xlsxFile(sheet: string, header: string[], rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return { name: 'opening.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Grey stock to dispatch from, independent of other files: Green Shade Net at L-75.
  await admin((c) => c.query(`
    insert into stock_adjustments (item_type, fabric_quality_id, factory_id, meters, kgs, reason, is_opening)
    select 'grey_fabric', fq.id, f.id, 2000, 1070, 'Opening stock', true
    from fabric_qualities fq, factories f where fq.name = 'Green Shade Net' and f.code = 'L-75'`), DB);
});

test('8. dispatch reduces grey stock; over-dispatch is stopped', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/grey?factory=all');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Green Shade Net' }) });
  await expect(card.first()).toContainText('2,000.00 m');

  await page.getByRole('link', { name: 'Dispatch', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grey dispatch');
  await page.getByLabel('From factory').selectOption({ label: 'L-75' });
  await pick(page, 'Fabric quality · Specification', 'Green', /Green Shade Net · GREENSHADENET-S1/);
  await expect(page.getByText('2,000.00 m · 1,070.000 kg in stock')).toBeVisible();

  await page.getByLabel('Meters').fill('2000.01');
  await page.getByLabel('Kgs').fill('1');
  await expect(page.getByText('More than in stock at this factory')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save dispatch' })).toBeDisabled();

  await page.getByLabel('Meters').fill('500');
  await page.getByLabel('Kgs').fill('270');
  await page.getByLabel('Party / destination').fill('Shah Processors');
  await page.getByLabel('Challan no').fill('DC-501');
  await shot(page, '20-dispatch-form');
  await page.getByRole('button', { name: 'Save dispatch' }).click();
  await expect(page.getByText('Dispatched 500.00 m / 270.000 kg of Green Shade Net · GREENSHADENET-S1')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Shah Processors' })).toContainText('500.00 m');

  await page.goto('/grey?factory=all');
  await expect(card.first()).toContainText('1,500.00 m');
  await expect(card.first()).toContainText('800.000 kg');
});

test('reports: on screen, Excel and PDF', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/more');
  await page.getByRole('link', { name: 'Reports' }).click();
  await page.getByRole('link', { name: /Grey stock summary/ }).click();
  const table = page.getByRole('table', { name: 'Grey stock summary' });
  const row = table.getByRole('row').filter({ hasText: 'Green Shade Net' });
  await expect(row).toContainText('2,000.00'); // adjusted (opening)
  await expect(row).toContainText('500.00'); // dispatched
  await expect(row).toContainText('1,500.00'); // closing
  await shot(page, '21-report');

  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /^Excel/ }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^grey-summary_all_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile((await xlsx.path())!)) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  expect(ws.getCell('A1').value).toBe('Grey stock summary');
  const green = ws.getRows(5, ws.rowCount)!.find((r) => r.getCell(1).value === 'Green Shade Net')!;
  expect([green.getCell(2).value, green.getCell(12).value, green.getCell(13).value]).toEqual(['GREENSHADENET-S1', 1500, 800]); // Specification, closing m, kg

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /^PDF/ }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe('%PDF-');

  // Loom-wise monthly, one factory
  await page.goto('/reports');
  await page.getByLabel('Factory').selectOption({ label: 'L-76' });
  await page.getByLabel('Period').selectOption('month');
  await page.getByRole('button', { name: 'Show' }).click();
  await page.getByRole('link', { name: /Loom-wise production/ }).click();
  await expect(page.getByText(/· L-76$/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Loom-wise production' }).getByRole('row').filter({ hasText: 'L76-05' })).toBeVisible();
});

test('import opening yarn stock: problems are listed by row, then a clean file imports', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/import');
  const yarn = page.getByRole('form', { name: 'Opening yarn stock' });

  const [tpl] = await Promise.all([page.waitForEvent('download'), yarn.locator('..').getByRole('link', { name: /Download template/ }).first().click()]);
  expect(tpl.suggestedFilename()).toBe('opening-yarn-template.xlsx');

  const header = ['Lot No', 'Yarn Quality', 'Factory', 'Kgs', 'Date'];
  await yarn.getByLabel('Excel file (.xlsx)').setInputFiles(await xlsxFile('Opening yarn', header, [
    ['OPN-1', 'Mono 0.25 White', 'L-76', 400, '01-10-2026'],
    ['OPN-2', 'Mono Purple', 'L-76', 100],
  ]));
  await yarn.getByRole('button', { name: 'Check file' }).click();
  await expect(yarn.getByText('1 problem found.')).toBeVisible();
  await expect(yarn.getByRole('list', { name: 'Problems' })).toContainText('Row 3Unknown yarn quality "Mono Purple"');
  await expect(yarn.getByRole('button', { name: /^Import/ })).toHaveCount(0);
  await shot(page, '22-import-errors');

  await yarn.getByLabel('Excel file (.xlsx)').setInputFiles(await xlsxFile('Opening yarn', header, [
    ['OPN-1', 'Mono 0.25 White', 'L-76', 400, '01-10-2026'],
    ['OPN-2', 'Mono 0.25 Black', 'L-76', 100],
  ]));
  await yarn.getByRole('button', { name: 'Check file' }).click();
  await expect(yarn.getByText('Ready to import: 2 rows')).toBeVisible();
  await yarn.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(yarn.getByText('Imported 2 rows')).toBeVisible();

  await page.goto('/yarn?q=OPN-1');
  await expect(page.getByRole('link', { name: /OPN-1/ })).toContainText('400.000');
  await expect(page.getByRole('link', { name: /OPN-1/ })).toContainText('01-10-2026');
});

test('supervisor adjusts a lot; data entry sees no adjust, import or settings', async ({ page }) => {
  await signIn(page, 'sup76@test.local');
  await page.goto('/yarn?q=OPN-2');
  await page.getByRole('link', { name: /OPN-2/ }).click();
  await page.getByLabel('Kgs (+ add / − remove)').fill('-2.5');
  await page.getByLabel('Reason').fill('Physical count');
  await page.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(page.getByText('Adjustment saved')).toBeVisible();
  await expect(page.getByText('97.500').first()).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Adjustment' })).toContainText('-2.500');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, 'entry76@test.local');
  await page.goto(page.url().replace(/\/$/, '') + '/yarn?q=OPN-2');
  await page.getByRole('link', { name: /OPN-2/ }).click();
  await expect(page.getByText('Adjust this lot')).toHaveCount(0);
  await page.goto('/more');
  await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Import opening stock' })).toHaveCount(0);
  await page.goto('/settings/users');
  await expect(page.getByText('Only the owner can change settings.')).toBeVisible();
});

test('owner activates a new sign-up and puts a loom into maintenance', async ({ page, browser }) => {
  // A new person signs up and waits.
  const newbie = await browser.newPage();
  await newbie.goto('/signup');
  await newbie.getByLabel('Your name').fill('Suresh');
  await newbie.getByLabel('Email').fill('suresh@test.local');
  await newbie.getByLabel('Password').fill('suresh-pass-1');
  await newbie.getByRole('button', { name: 'Create account' }).click();
  await expect(newbie.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();

  await signIn(page, 'owner@test.local');
  await page.goto('/settings');
  await page.getByRole('link', { name: /Users/ }).click();
  const form = page.getByRole('form', { name: 'suresh@test.local' });
  await expect(page.getByRole('listitem').filter({ hasText: 'suresh@test.local' })).toContainText('Waiting for approval');
  await form.getByLabel('Role').selectOption('supervisor');
  await form.getByLabel('Factory').selectOption({ label: 'L-75' });
  await form.getByLabel('Active').check();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved')).toBeVisible();
  // The form keeps showing what was saved
  await expect(form.getByLabel('Role')).toHaveValue('supervisor');
  await expect(form.getByLabel('Factory').locator('option:checked')).toHaveText('L-75');
  await page.reload();
  await expect(page.getByRole('form', { name: 'suresh@test.local' }).getByLabel('Role')).toHaveValue('supervisor');
  await shot(page, '23-settings-users');

  await newbie.reload();
  await expect(newbie.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(newbie.getByText('Supervisor · L-75')).toBeVisible();
  await newbie.close();

  // The owner cannot lock themselves out.
  const mine = page.getByRole('form', { name: 'owner@test.local' });
  await expect(mine.getByLabel('Role')).toBeDisabled();

  // Loom maintenance shows on the dashboard.
  await page.goto('/settings/looms');
  const loom = page.getByRole('form', { name: 'L76-35' });
  await loom.getByLabel('Status').selectOption('maintenance');
  await loom.getByRole('button', { name: 'Save' }).click();
  await expect(loom.getByText('Saved')).toBeVisible();
  await page.goto('/?factory=all');
  await expect(page.getByRole('button', { name: /^L76-35,/ })).toHaveAttribute('data-status', 'maintenance');
  await expect(page.getByTestId('stat-looms')).toContainText('1 maintenance');

  // Variance threshold
  await page.goto('/settings/general');
  await page.getByLabel('Variance threshold (±%)').fill('7.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByLabel('Variance threshold (±%)')).toHaveValue('7.5');
  await page.goto('/reports/variance');
  await expect(page.getByText('Red when variance exceeds ±7.5%')).toBeVisible();
});

test('a form that fails validation keeps the chosen factory and quality', async ({ page }) => {
  await signIn(page, 'owner@test.local');
  await page.goto('/yarn/new');
  await page.getByLabel('Received at').selectOption({ label: 'L-75' });
  await pick(page, 'Yarn quality', 'Mono 0.25 Black');
  await page.getByLabel('Kgs received').fill('0'); // invalid
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Must be more than 0')).toBeVisible();
  await expect(page.getByLabel('Received at').locator('option:checked')).toHaveText('L-75');
  await expect(page.getByLabel('Yarn quality', { exact: true })).toContainText('Mono 0.25 Black');
});
