import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const server = http.createServer((req,res) => {
  const target = path.join(root, req.url.split('?')[0].slice(1) || 'index.html');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(r=>server.listen(4181,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage({viewport:{width:393,height:873},deviceScaleFactor:2,isMobile:true});
await page.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.origin !== 'http://127.0.0.1:4181') return route.abort();
  return route.continue();
});
await page.goto('http://127.0.0.1:4181/intro.html?embed=1', {waitUntil:'domcontentloaded'});
await page.waitForTimeout(8000);
await page.screenshot({path:'www/check-intro-settled-day.png'});
await page.evaluate(() => document.getElementById('btnV2').click());
await page.waitForTimeout(8000);
await page.screenshot({path:'www/check-intro-settled-night.png'});
await browser.close(); server.close();
console.log('SETTLED_CAPTURED');
