import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
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

try {
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const marker = "const VALERIAN_INVOICE_EMBLEM = 'data:image/png;base64,";
  const markerStart = html.indexOf(marker);
  if (markerStart < 0) throw new Error('Original VALERIAN emblem was not found in index.html');
  const dataStart = markerStart + marker.length;
  const dataEnd = html.indexOf("'", dataStart);
  if (dataEnd < 0) throw new Error('Original VALERIAN emblem data is incomplete');
  const emblemBase64 = html.slice(dataStart, dataEnd);

  const png = Buffer.from(emblemBase64, 'base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 414 414"><image href="data:image/png;base64,${emblemBase64}" x="-93" y="0" width="600" height="414" preserveAspectRatio="none"/></svg>`
  await writeFile(resolve(dist, 'valerian-icon.svg'), svg, 'utf8');
  console.log('Prepared: original VALERIAN symbol icon');

  // Capacitor creates the Android project first; the second prepare pass installs
  // the original brand symbol into native launcher resources without replacing app data.
  const androidRes = resolve(root, 'android/app/src/main/res');
  try {
    await mkdir(resolve(androidRes, 'drawable-nodpi'), { recursive: true });
    await writeFile(resolve(androidRes, 'drawable-nodpi/valerian_mark.png'), png);
    await mkdir(resolve(androidRes, 'drawable'), { recursive: true });
    await writeFile(resolve(androidRes, 'drawable/valerian_launcher_foreground.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<inset xmlns:android="http://schemas.android.com/apk/res/android" android:drawable="@drawable/valerian_mark" android:inset="12%" />\n`, 'utf8');
    await mkdir(resolve(androidRes, 'mipmap-anydpi-v26'), { recursive: true });
    const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/valerian_icon_background"/><foreground android:drawable="@drawable/valerian_launcher_foreground"/></adaptive-icon>\n`;
    await writeFile(resolve(androidRes, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive, 'utf8');
    await writeFile(resolve(androidRes, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive, 'utf8');
    await mkdir(resolve(androidRes, 'values'), { recursive: true });
    await writeFile(resolve(androidRes, 'values/valerian_icon_colors.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="valerian_icon_background">#080B10</color></resources>\n`, 'utf8');
    for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      const dir = resolve(androidRes, `mipmap-${density}`);
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, 'ic_launcher.png'), png);
      await writeFile(resolve(dir, 'ic_launcher_round.png'), png);
    }
    console.log('Prepared: native Android launcher icon from original VALERIAN symbol');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('Android project not created yet; native icon will be installed on the next prepare pass.');
  }
} catch (error) {
  console.error(`Could not prepare VALERIAN icon: ${error.message}`);
  process.exitCode = 1;
}

if (!process.exitCode) console.log('VALERIAN web bundle is ready in ./dist');
