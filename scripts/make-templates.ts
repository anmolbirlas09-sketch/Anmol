// Writes the Excel import templates in templates/ with the sample masters from
// supabase/seed.sql. The app's "Download template" link builds the same file
// with your live masters (qualities, factories, suppliers) in the dropdowns.
//   npm run templates
import { writeFile } from 'node:fs/promises';
import { templateWorkbook } from '../src/lib/importer';

const masters = {
  yarnQualities: ['Mono 0.25 White', 'Mono 0.25 Black', 'Mono 0.30 Green', 'PP Multifilament 1500D Natural'].map((name) => ({ id: name, name })),
  fabricQualities: ['Mono White', 'White/Black', 'Green Shade Net'].map((name) => ({ id: name, name })),
  factories: [{ id: 'L-76', code: 'L-76' }, { id: 'L-75', code: 'L-75' }],
  suppliers: [{ id: 's', name: 'Sample Yarn Suppliers Pvt Ltd' }],
  specifications: [
    { id: 'a', spec_code: 'MONOWHITE-S1', fabric_quality_id: 'Mono White' },
    { id: 'b', spec_code: 'WHITEBLACK-S1', fabric_quality_id: 'White/Black' },
    { id: 'c', spec_code: 'GREENSHADENET-S1', fabric_quality_id: 'Green Shade Net' },
  ],
};

for (const kind of ['yarn', 'grey'] as const) {
  const path = `templates/opening-${kind}-stock-template.xlsx`;
  await writeFile(path, Buffer.from(await templateWorkbook(kind, masters).xlsx.writeBuffer()));
  console.log('wrote', path);
}
