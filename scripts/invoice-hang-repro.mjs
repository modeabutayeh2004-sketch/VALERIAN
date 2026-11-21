import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(4174, '127.0.0.1', resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const context = await browser.newContext({
    viewport:{width:393,height:873},screen:{width:393,height:873},deviceScaleFactor:2.75,
    isMobile:true,hasTouch:true,
    userAgent:'Mozilla/5.0 (Linux; Android 13; 21081111RG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.200 Mobile Safari/537.36'
  });
  const page = await context.newPage();
  page.on('console', m => { if (m.type()==='error'||m.type()==='warning') console.log('[console.'+m.type()+']', m.text().slice(0,300)); });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0,300)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate:6});
  await page.goto('http://127.0.0.1:4174/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});
  await page.evaluate(() => {
    window.__valerianOpenThermalReceiptPreview({
      id:'VAL-QA-1001',date:'2026-11-21',mode:'reservation',status:'حجز مسبق',
      name:'عميل تجريبي',phone:'01000000000',address:'عنوان تجريبي',
      grandTotal:6976,depositAmount:300,remainingAmount:6676,
      items:[{id:'p1',name:'Old Spice (Epic Legend)',size:'100 مل',qty:2,price:3438,total:6876}]
    });
  });
  await page.waitForFunction(() => !!document.querySelector('#previewSheetBody .valerian-share-qr img'), null, {timeout:20000});
  const timing = await page.evaluate(async () => {
    const t0 = performance.now();
    const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT-90S')),90000));
    try {
      const blob = await Promise.race([window.__valerianCreatePreviewImageBlob(), timeout]);
      return {ok:true, ms:Math.round(performance.now()-t0), bytes:blob.size};
    } catch (e) {
      return {ok:false, ms:Math.round(performance.now()-t0), error:String(e && e.message || e)};
    }
  });
  console.log('RESULT', JSON.stringify(timing));
} finally {
  await browser.close(); server.close();
}
