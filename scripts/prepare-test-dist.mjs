import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('dist-test');
const packageJsonPath = path.join(outDir, 'package.json');

await mkdir(outDir, { recursive: true });
await writeFile(packageJsonPath, `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

console.log(`[test-dist] Wrote ${packageJsonPath}`);
