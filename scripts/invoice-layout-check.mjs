import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const server = http.createServer((req,res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(4174, '127.0.0.1', resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures = [];
try {
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2.75,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.on('pageerror', e => failures.push('pageerror: '+e.message));
  await page.goto('http://127.0.0.1:4174/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});

  async function captureCase(tag, order) {
    const result = await page.evaluate(async (order) => {
      window.__valerianOpenThermalReceiptPreview(order);
      const until=Date.now()+20000;
      while(Date.now()<until && !document.querySelector('#previewSheetBody .valerian-share-qr img')) await new Promise(r=>setTimeout(r,150));
      const rect = sel => { const n=document.querySelector(sel); if(!n) return null; const r=n.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}; };
      const paper = rect('#previewSheetBody > .valerian-invoice-paper');
      const summary = rect('#previewSheetBody .summary-container');
      const gold = rect('#previewSheetBody .total-gold-bar');
      const qr = rect('#previewSheetBody .social-qr-card');
      const heading = rect('#previewSheetBody .social-heading');
      const footer = rect('#previewSheetBody .receipt-footer');
      const t0 = performance.now();
      const blob = await window.__valerianCreatePreviewImageBlob();
      const ms = Math.round(performance.now()-t0);
      const bitmap = await createImageBitmap(blob);
      // The document must reach the bottom edge of the image: sample the lowest strip
      // for the footer's ink so a clipped export fails loudly.
      const pc = document.createElement('canvas'); pc.width = bitmap.width; pc.height = bitmap.height;
      const pctx = pc.getContext('2d', {willReadFrequently:true}); pctx.drawImage(bitmap, 0, 0);
      const strip = pctx.getImageData(0, Math.floor(bitmap.height*0.965), bitmap.width, bitmap.height - Math.floor(bitmap.height*0.965)).data;
      let bottomInk = 0;
      for (let i = 0; i < strip.length; i += 16) { const r=strip[i],g=strip[i+1],b=strip[i+2]; if (Math.max(r,g,b)-Math.min(r,g,b)>12 || r<210) bottomInk++; }
      const dataUrl = await new Promise(res=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.readAsDataURL(blob);});
      return {paper,summary,gold,qr,heading,footer,ms,bytes:blob.size,imgW:bitmap.width,imgH:bitmap.height,bottomInk,dataUrl};
    }, order);
    fs.writeFileSync('www/check-invoice-'+tag+'.png', Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    delete result.dataUrl;
    console.log(tag, JSON.stringify(result));
    // No-overlap assertions in the preview DOM
    if (!(result.gold.bottom <= result.summary.bottom + 0.5)) failures.push(tag+': gold bar spills below summary card');
    if (!(result.summary.bottom <= result.qr.top + 0.5)) failures.push(tag+': summary card overlaps QR card');
    if (!(result.heading.top >= result.qr.top && result.heading.bottom <= result.qr.bottom)) failures.push(tag+': QR heading outside QR card');
    if (!(result.qr.bottom <= result.footer.top + 0.5)) failures.push(tag+': QR card overlaps footer');
    const scale = Math.max(2, Math.min(4, Math.max(2.75, 3), 9000 / Math.max(result.paper.width, result.paper.height)));
    const tolW = Math.max(2, Math.round(result.paper.width*scale*0.0015));
    const tolH = Math.max(2, Math.round(result.paper.height*scale*0.0015));
    if (Math.abs(result.imgW - Math.round(result.paper.width*scale)) > tolW) failures.push(tag+': export width mismatch '+result.imgW+' vs '+result.paper.width+'*'+scale);
    if (Math.abs(result.imgH - Math.round(result.paper.height*scale)) > tolH) failures.push(tag+': export height mismatch '+result.imgH+' vs '+result.paper.height+'*'+scale);
    if (result.ms > 15000) failures.push(tag+': capture too slow under throttle: '+result.ms+'ms');
    if (result.bottomInk < 50) failures.push(tag+': export bottom strip looks empty — footer likely clipped (ink='+result.bottomInk+')');
    return result;
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate:4});

  await captureCase('single', {id:'VAL-QA-1001',date:'2026-11-21',mode:'reservation',status:'حجز مسبق',name:'عميل تجريبي',phone:'01000000000',address:'عنوان تجريبي',grandTotal:6976,depositAmount:2093,remainingAmount:4883,items:[{id:'p1',name:'منتج تجريبي (اختبار)',size:'100 مل',qty:2,price:3438,total:6876}]});
  await captureCase('multi-long', {id:'VAL-20261121-000987',date:'2026-11-21',mode:'sale',status:'تم البيع',name:'اسم تجريبي طويل جدا لاختبار التفاف النص',phone:'01000000000',address:'عنوان تجريبي طويل لاختبار التفاف النص داخل الفاتورة - الدور الرابع - شقة 12',grandTotal:19850,depositAmount:19850,remainingAmount:0,items:[
    {id:'p1',name:'منتج تجريبي (اختبار) Limited Edition',size:'100 مل',qty:2,price:3438,total:6876},
    {id:'p2',name:'Dior Sauvage Elixir',size:'60 مل',qty:1,price:6200,total:6200},
    {id:'p3',name:'تقسيم عطر عود ملكي فاخر',size:'10 مل',qty:3,price:450,total:1350},
    {id:'p4',name:'Creed Aventus',size:'100 مل',qty:1,price:5424,total:5424}
  ]});
  await page.screenshot({path:'www/check-invoice-preview.png',fullPage:false});
} finally {
  await browser.close(); server.close();
}
if (failures.length) { console.error('INVOICE_LAYOUT_FAILED: '+failures.join(' | ')); process.exitCode = 1; }
else console.log('INVOICE_LAYOUT_OK');
