import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg'};
const server = http.createServer((req,res) => {
  console.log('REQ', req.url.slice(0,90));
  let pathname; try { pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, pathname==='/'?'index.html':pathname.slice(1));
  if (!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(r=>server.listen(4180,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context = await browser.newContext({viewport:{width:393,height:873},serviceWorkers:'allow'});
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0,150)));
await page.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.origin !== 'http://127.0.0.1:4180') return route.abort();
  return route.continue();
});
await page.goto('http://127.0.0.1:4180/', {waitUntil:'domcontentloaded',timeout:30000});
await page.waitForFunction(async () => {
  if (!navigator.serviceWorker.controller) return false;
  const keys = await caches.keys();
  const key = keys.find(k => k.includes('unified-qr-intro'));
  if (!key) return false;
  const cache = await caches.open(key);
  return (await cache.keys()).length >= 5;
}, null, {timeout:30000});
console.log('sw ready');
await context.setOffline(true);
page.on('requestfailed', r => console.log('OFFLINE REQFAIL:', r.url().slice(0,110), r.failure()?.errorText));
try {
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});
} catch(e) {
  console.log('RELOAD THREW:', e.message.split('\n')[0]);

}
await page.waitForTimeout(4000);
console.log(await page.evaluate(() => JSON.stringify({
  engine: !!window.ValerianEngine, ui: !!window.ValerianUI,
  splash: window.__valerianSplashDismissed,
  readyState: document.readyState,
  scripts: [...document.scripts].map(s => (s.src||'inline').slice(0,90))
})));
await browser.close(); server.close();
