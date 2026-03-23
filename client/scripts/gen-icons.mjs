import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, '../public/baguette.svg');
const svg = readFileSync(svgPath, 'utf-8');

for (const size of [192, 512]) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  const outPath = resolve(__dirname, `../public/baguette-${size}x${size}.png`);
  writeFileSync(outPath, pngBuffer);
  console.log(`Generated ${outPath}`);
}
