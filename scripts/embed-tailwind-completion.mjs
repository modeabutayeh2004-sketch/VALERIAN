import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const htmlPath = resolve('www/index.html');
const cssPath = resolve('www/tailwind.audit.css');
const styleId = 'valerian-offline-tailwind-completion';

let html = await readFile(htmlPath, 'utf8');
const css = await readFile(cssPath, 'utf8');

// Remove a previous copy so repeated preview builds remain deterministic.
const existingOpen = `<style id="${styleId}">`;
const existingStart = html.indexOf(existingOpen);
if (existingStart >= 0) {
  const existingEnd = html.indexOf('</style>', existingStart);
  if (existingEnd < 0) throw new Error('Existing completion stylesheet is not closed.');
  html = html.slice(0, existingStart) + html.slice(existingEnd + '</style>'.length);
}

const originalOpen = '<style id="valerian-offline-tailwind">';
const originalStart = html.indexOf(originalOpen);
if (originalStart < 0) throw new Error('Embedded offline Tailwind stylesheet was not found.');
const originalEnd = html.indexOf('</style>', originalStart);
if (originalEnd < 0) throw new Error('Embedded offline Tailwind stylesheet is not closed.');

const completion = `\n<style id="${styleId}">\n/* Preview-only Tailwind v4.1.10 missing-utility completion. No preflight/reset. */\n${css}\n</style>`;
const insertAt = originalEnd + '</style>'.length;
html = html.slice(0, insertAt) + completion + html.slice(insertAt);

await writeFile(htmlPath, html, 'utf8');
console.log(`Embedded ${Buffer.byteLength(css)} bytes of offline utility completion into www/index.html.`);
