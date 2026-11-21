import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((req,res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, pathname==='/'?'index.html':pathname.slice(1));
  if (!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(r=>server.listen(4175,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
page.on('console', m => { if (m.type()==='error'||m.type()==='warning') console.log('CONSOLE', m.type(), m.text().slice(0,200)); });
page.on('requestfailed', r => console.log('REQFAIL:', r.url().slice(0,120)));
await page.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.origin !== 'http://127.0.0.1:4175') return route.abort();
  return route.continue();
});
await page.goto('http://127.0.0.1:4175/', {waitUntil:'domcontentloaded',timeout:30000});
for (let i=0;i<12;i++) {
  const st = await page.evaluate(() => ({engine:!!window.ValerianEngine, ui:!!window.ValerianUI, splash:window.__valerianSplashDismissed, ready:document.readyState}));
  console.log('t+'+i*5+'s', JSON.stringify(st));
  if (st.engine && st.ui) break;
  await page.waitForTimeout(5000);
}
await browser.close(); server.close();
