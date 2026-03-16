import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const distTestDir = path.resolve('dist/test');
const packageJsonPath = path.join(distTestDir, 'package.json');

await mkdir(distTestDir, { recursive: true });
await writeFile(packageJsonPath, `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

console.log(`[test-dist] Wrote ${packageJsonPath}`);
