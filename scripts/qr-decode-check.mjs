import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.json':'application/json'};
const server = http.createServer((req,res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, pathname==='/'?'index.html':pathname.slice(1));
  if (!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(r=>server.listen(4176,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures = [];
try {
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2.75,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.on('pageerror', e => failures.push('pageerror: '+e.message));
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== 'http://127.0.0.1:4176') return route.abort();
    return route.continue();
  });
  await page.goto('http://127.0.0.1:4176/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});

  // Worst case: 4 long social links
  const worstLinks = [
    {label:'فيسبوك', url:'https://www.facebook.com/valerian.perfumes.egypt.official.page'},
    {label:'انستجرام', url:'https://www.instagram.com/valerian_perfumes_official_egypt'},
    {label:'تيك توك', url:'https://www.tiktok.com/@valerian.perfumes.egypt.official'},
    {label:'واتساب', url:'https://wa.me/201066112586?text=مرحبا'}
  ];
  const result = await page.evaluate(async (worstLinks) => {
    const host = document.getElementById('settingsSheetQrEditor');
    const esc = v => v.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    host.innerHTML = worstLinks.map((l,i)=>'<div data-sheet-qr-row="'+i+'"><input data-sheet-qr-label value="'+esc(l.label)+'"><input data-sheet-qr-url value="'+esc(l.url)+'"></div>').join('');
    document.getElementById('settingsSheetEnableQr').checked = true;
    await window.ValerianEngine.saveSettingsSheetQrLinks();
    const check = window.ValerianEngine.getSnapshot().settings.invoiceQrLinks;
    if (!Array.isArray(check) || check.length !== 4) return {error:'settings not applied, got '+(check&&check.length)};
    const order = {id:'VAL-QA-1001',date:'2026-11-21',mode:'reservation',status:'حجز مسبق',name:'عميل تجريبي',phone:'01000000000',address:'عنوان تجريبي',grandTotal:6976,depositAmount:2093,remainingAmount:4883,items:[{id:'p1',name:'Old Spice (Epic Legend)',size:'100 مل',qty:2,price:3438,total:6876}]};
    window.__valerianOpenThermalReceiptPreview(order);
    const until=Date.now()+20000;
    while(Date.now()<until && !document.querySelector('#previewSheetBody .valerian-share-qr img')) await new Promise(r=>setTimeout(r,150));
    const img = document.querySelector('#previewSheetBody .valerian-share-qr img');
    if(!img) return {error:'no qr img'};
    const items = document.querySelectorAll('#previewSheetBody .valerian-share-qr-item').length;
    const paper = document.querySelector('#previewSheetBody > .valerian-invoice-paper');
    const r = img.getBoundingClientRect(); const pr = paper.getBoundingClientRect();
    const domCrop = {x:r.left-pr.left, y:r.top-pr.top, w:r.width, h:r.height, paperW:pr.width};
    // Export the whole invoice at production scale, then crop the QR at its rendered footprint
    const t0=performance.now();
    const blob = await window.__valerianCreatePreviewImageBlob();
    const ms = Math.round(performance.now()-t0);
    const bitmap = await createImageBitmap(blob);
    const scale = bitmap.width / domCrop.paperW;
    const crop = {x:Math.max(0,Math.floor(domCrop.x*scale)), y:Math.max(0,Math.floor(domCrop.y*scale)), w:Math.max(1,Math.floor(domCrop.w*scale)), h:Math.max(1,Math.floor(domCrop.h*scale))};
    const c = document.createElement('canvas'); c.width=crop.w; c.height=crop.h;
    c.getContext('2d').drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    return {items, ms, imgW:bitmap.width, imgH:bitmap.height, cropW:crop.w, cropH:crop.h, dataUrl:c.toDataURL('image/png')};
  }, worstLinks);
  if (result.error) { failures.push(result.error); }
  else {
    fs.writeFileSync('/tmp/qr-crop.png', Buffer.from(result.dataUrl.split(',')[1],'base64'));
    delete result.dataUrl;
    console.log('render:', JSON.stringify({...result, dataUrl:undefined}));
    const png = PNG.sync.read(fs.readFileSync('/tmp/qr-crop.png'));
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {inversionAttempts:'attemptBoth'});
    if (!code) failures.push('QR did not decode at rendered export size');
    else {
      console.log('decoded:', code.data.slice(0,120), '... len', code.data.length);
      // Verify the payload round-trips through links.html decode logic
      const linkPage = await context.newPage();
      await linkPage.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'http://127.0.0.1:4176') return route.abort();
        return route.continue();
      });
      await linkPage.goto('http://127.0.0.1:4176/links.html'+new URL(code.data).hash, {waitUntil:'domcontentloaded',timeout:15000});
      const rendered = await linkPage.evaluate(() => [...document.querySelectorAll('#links a')].map(a=>({label:a.textContent, href:a.href})));
      console.log('links page rendered:', JSON.stringify(rendered));
      if (rendered.length !== 4) failures.push('links page rendered '+rendered.length+' buttons, expected 4');
      for (const [i,w] of worstLinks.entries()) {
        if (!rendered[i] || !rendered[i].href.startsWith(w.url.split('?')[0].replace(/\/$/,''))) failures.push('link '+i+' mismatch: '+(rendered[i]&&rendered[i].href));
      }
      await linkPage.screenshot({path:'www/check-links-page.png'});
      await linkPage.close();
    }
  }
} finally { await browser.close(); server.close(); }
if (failures.length) { console.log('FAILURES:', failures); process.exit(1); }
console.log('QR_DECODE_OK');
