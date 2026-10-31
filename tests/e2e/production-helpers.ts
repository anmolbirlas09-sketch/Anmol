import type { Page } from '@playwright/test';

/** Fill the metre-first production form (steps 2–4, plus optional weights). */
export async function fillProduction(
  page: Page,
  v: { meters: string; wasted?: string; roll?: string; weighed?: string; gsm?: string; width?: string; warp?: string; weft?: string },
) {
  await page.getByLabel('Production metres').fill(v.meters);
  await page.getByLabel('Roll length (m)').fill(v.roll ?? '100');
  await page.getByLabel('Wasted metres').fill(v.wasted ?? '0');
  if (v.weighed || v.gsm || v.width || v.warp || v.weft) {
    const details = page.locator('details').filter({ hasText: 'Weight (optional)' });
    if (!(await details.getAttribute('open'))) await details.locator('summary').click();
    if (v.gsm) await page.getByLabel('GSM').fill(v.gsm);
    if (v.width) await page.getByLabel('Fabric width (m)').fill(v.width);
    if (v.weighed) await page.getByLabel('Actual weighed fabric weight (kg)').fill(v.weighed);
    if (v.warp) await page.getByLabel('Warp yarn used (kg)').fill(v.warp);
    if (v.weft) await page.getByLabel('Weft yarn used (kg)').fill(v.weft);
  }
}
