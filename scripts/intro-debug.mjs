import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const server = http.createServer((req,res) => {
  const target = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(r=>server.listen(4179,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const page = await browser.newPage();
await page.addInitScript(() => localStorage.setItem('valerian-theme-preference-v2','dark'));
await page.goto('http://127.0.0.1:4179/', {waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => {
  const f = document.getElementById('splashIntroFrame');
  return JSON.stringify({
    parentTheme: document.documentElement.getAttribute('data-valerian-theme'),
    frameSrc: f && f.src,
    frameBodyClass: f && f.contentDocument && f.contentDocument.body.className,
    frameHasBtn: !!(f && f.contentDocument && f.contentDocument.getElementById('btnV2')),
    ls: localStorage.getItem('valerian-theme-preference-v2')
  });
}));
await browser.close(); server.close();
