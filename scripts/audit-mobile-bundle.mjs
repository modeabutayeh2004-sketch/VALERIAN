import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];
const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const requireFile = (p) => {
  if (!exists(p)) failures.push('Missing required file: ' + p);
};

for (const file of [
  'index.html',
  'engine-runtime.js',
  'service-worker.js',
  'manifest.webmanifest',
  'assets/valerian-icon.jpg',
  'android-native/NativeFileBridge.java',
  'scripts/prepare-web.mjs',
  'scripts/patch-android-native.mjs',
  'scripts/generate-android-icons.mjs'
]) requireFile(file);

if (failures.length) {
  console.error('Mobile bundle audit failed before content checks.');
  failures.forEach((item) => console.error(' - ' + item));
  process.exit(1);
}

const pkg = JSON.parse(read('package.json'));
const capacitor = JSON.parse(read('capacitor.config.json'));
const html = read('index.html');
const runtime = read('engine-runtime.js');
const worker = read('service-worker.js');
const prepare = read('scripts/prepare-web.mjs');
const bridge = read('android-native/NativeFileBridge.java');

if (capacitor.appId !== 'com.valerian.business') failures.push('Unexpected Capacitor appId.');
if (capacitor.appName !== 'VALERIAN') failures.push('Unexpected Capacitor appName.');
if (capacitor.webDir !== 'www') failures.push('Capacitor webDir must remain www.');
if (!pkg.scripts?.['build:web']) failures.push('package.json is missing build:web.');
if (!pkg.scripts?.['audit:mobile']) failures.push('package.json is missing audit:mobile.');

const engineScriptCount = (html.match(/<script\b[^>]*src=["'][^"']*engine-runtime\.js(?:\?[^"']*)?["'][^>]*>/gi) || []).length;
if (engineScriptCount !== 1) failures.push('Expected exactly one engine-runtime.js script tag; found ' + engineScriptCount + '.');
if (!html.includes('waitForEngineBridge') || !html.includes('runEngine(')) failures.push('Mobile UI is missing its engine connection/command bridge.');
if (!runtime.includes('window.ValerianEngine=Object.freeze')) failures.push('Business runtime does not expose the expected ValerianEngine API.');
if (!runtime.includes('const ready') && !runtime.includes('ready=')) warnings.push('Could not statically confirm the runtime readiness promise.');

for (const file of ['index.html', 'engine-runtime.js', 'service-worker.js']) {
  if (!prepare.includes("'" + file + "'")) failures.push('Web preparation does not copy ' + file + ' into www.');
}
if (!prepare.includes("'assets/valerian-icon.jpg'")) failures.push('Web preparation does not copy the VALERIAN source icon.');

const shell = worker.match(/const APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!shell) {
  failures.push('Could not read the service-worker APP_SHELL list.');
} else {
  const entries = [...shell[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  for (const entry of entries) {
    const pathname = entry.split('?')[0].replace(/^\.\//, '');
    const target = pathname || 'index.html';
    if (!exists(path.join('www', target))) failures.push('Service-worker pre-cache target is not produced by the web build: ' + entry);
  }
}

for (const method of ['saveImage', 'printHtml', 'printImage']) {
  const methodPattern = new RegExp('@JavascriptInterface\\s+public\\s+(?:boolean|void)\\s+' + method + '\\s*\\(');
  if (!methodPattern.test(bridge)) failures.push('Android native bridge is missing ' + method + '().');
}

// Protect the off-screen legacy ERP DOM until every business-engine dependency is migrated.
const hostOpen = /<div\b[^>]*\bid=["']valerian-legacy-engine-host["'][^>]*>/i.exec(html);
if (!hostOpen) {
  failures.push('The legacy engine DOM host is missing.');
} else {
  const divTags = /<\/?div\b[^>]*>/gi;
  divTags.lastIndex = hostOpen.index + hostOpen[0].length;
  let depth = 1;
  let hostEnd = -1;
  let tag;
  while ((tag = divTags.exec(html))) {
    if (/^<\/div/i.test(tag[0])) {
      depth--;
      if (depth === 0) {
        hostEnd = tag.index;
        break;
      }
    } else if (/^<div\b/i.test(tag[0]) && !/\/\s*>$/.test(tag[0])) {
      depth++;
    }
  }
  if (hostEnd < 0) {
    failures.push('Could not safely determine the end of the legacy engine DOM host.');
  } else {
    const hostHtml = html.slice(hostOpen.index + hostOpen[0].length, hostEnd);
    const allIds = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const hostIds = new Set([...hostHtml.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
    const duplicates = [...new Set(allIds.filter((id, index) => allIds.indexOf(id) !== index))];
    if (duplicates.length) failures.push('Duplicate HTML IDs detected: ' + duplicates.slice(0, 12).join(', '));
    const runtimeIds = [...new Set([...runtime.matchAll(/document\.getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))];
    const htmlIdSet = new Set(allIds);
    const missingIds = runtimeIds.filter((id) => !htmlIdSet.has(id));
    const outsideHost = runtimeIds.filter((id) => id !== 'valerian-legacy-engine-host' && htmlIdSet.has(id) && !hostIds.has(id));
    if (missingIds.length > 2) failures.push('Business runtime references missing HTML IDs: ' + missingIds.slice(0, 12).join(', '));
    if (missingIds.length) warnings.push('Two generated runtime elements are not static HTML IDs: ' + missingIds.join(', '));
    if (outsideHost.length) warnings.push('Some business-engine DOM dependencies are outside the legacy host: ' + outsideHost.slice(0, 12).join(', '));
    const insideHostCount = runtimeIds.filter((id) => hostIds.has(id)).length;
    console.log(' - Legacy engine DOM map: ' + hostIds.size + ' hosted IDs; ' + runtimeIds.length + ' unique literal engine lookups; ' + insideHostCount + ' resolve inside the host');
  }
}

const duplicateImportDefinitions = (runtime.match(/createImportInvoice\s*:/g) || []).length;
const legacyDomLookups = (runtime.match(/document\.getElementById\s*\(/g) || []).length;
if (duplicateImportDefinitions > 1) warnings.push('Runtime defines createImportInvoice ' + duplicateImportDefinitions + ' times; the last object property wins and needs deliberate reconciliation.');
if (legacyDomLookups > 0) warnings.push('Business runtime still performs ' + legacyDomLookups + ' direct DOM lookups; do not remove legacy DOM dependencies until they are mapped.');
if (/<script\s+src=["']https:\/\/cdn\.tailwindcss\.com/i.test(html)) warnings.push('The page still references the Tailwind CDN; verify offline behavior before removing it.');

if (failures.length) {
  console.error('VALERIAN mobile bundle audit: FAILED');
  failures.forEach((item) => console.error(' - ' + item));
  process.exit(1);
}

console.log('VALERIAN mobile bundle audit: PASSED');
console.log(' - UI entry point: index.html (' + html.length.toLocaleString() + ' characters)');
console.log(' - Business runtime: engine-runtime.js (' + runtime.length.toLocaleString() + ' characters)');
console.log(' - Capacitor app identity and web output: valid');
console.log(' - Service-worker pre-cache targets: present in www');
console.log(' - Android image/print bridge methods: present');
warnings.forEach((item) => console.warn('WARNING: ' + item));
