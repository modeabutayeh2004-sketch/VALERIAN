import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const requiredFiles = ['index.html', 'service-worker.js', 'manifest.webmanifest'];

await mkdir(dist, { recursive: true });

for (const file of requiredFiles) {
  try {
    await copyFile(resolve(root, file), resolve(dist, file));
    console.log(`Prepared: ${file}`);
  } catch (error) {
    console.error(`Could not prepare ${file}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  console.log('VALERIAN web bundle is ready in ./dist');
}
