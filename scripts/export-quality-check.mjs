import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const server = http.createServer((req,res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, pathname==='/'?'index.html':pathname.slice(1));
  if (!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(r=>server.listen(4177,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures = [];
try {
  // High-dpr phone (dpr 4), 6x CPU throttle: worst realistic export conditions
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:4,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.on('pageerror', e => failures.push('pageerror: '+e.message));
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== 'http://127.0.0.1:4177') return route.abort();
    return route.continue();
  });
  await page.goto('http://127.0.0.1:4177/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate:6});
  const result = await page.evaluate(async () => {
    window.__valerianOpenThermalReceiptPreview({id:'VAL-4X-QUALITY',date:'2026-11-21',mode:'sale',status:'تم البيع',name:'عميل جودة التصدير',phone:'01000000000',address:'القاهرة مدينة نصر',grandTotal:19850,depositAmount:19850,remainingAmount:0,items:[
      {id:'p1',name:'Old Spice (Epic Legend) Limited Edition',size:'100 مل',qty:2,price:3438,total:6876},
      {id:'p2',name:'Dior Sauvage Elixir',size:'60 مل',qty:1,price:6200,total:6200},
      {id:'p3',name:'تقسيم عطر عود ملكي فاخر',size:'10 مل',qty:3,price:450,total:1350},
      {id:'p4',name:'Creed Aventus',size:'100 مل',qty:1,price:5424,total:5424}]});
    const until=Date.now()+20000;
    while(Date.now()<until && !document.querySelector('#previewSheetBody .valerian-share-qr img')) await new Promise(r=>setTimeout(r,150));
    const mem0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const t0=performance.now();
    const blob = await window.__valerianCreatePreviewImageBlob();
    const ms = Math.round(performance.now()-t0);
    const bitmap = await createImageBitmap(blob);
    const mem1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    // Sharpness probe: crop a text-dense strip (summary area) at 100% zoom and count crisp edges
    const paper = document.querySelector('#previewSheetBody > .valerian-invoice-paper');
    const scale = bitmap.width / paper.getBoundingClientRect().width;
    const c = document.createElement('canvas'); c.width=bitmap.width; c.height=bitmap.height;
    const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(bitmap,0,0);
    const strip=ctx.getImageData(0, Math.floor(bitmap.height*0.3), bitmap.width, 200).data;
    let edges=0;
    for (let y=0;y<200;y++) for (let x=1;x<bitmap.width;x++) {
      const i=(y*bitmap.width+x)*4, j=(y*bitmap.width+x-1)*4;
      if (Math.abs(strip[i]-strip[j])>80) edges++;
    }
    const dataUrl = await new Promise(res=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.readAsDataURL(blob);});
    return {ms, scale, imgW:bitmap.width, imgH:bitmap.height, bytes:blob.size, heapDeltaMB:Math.round((mem1-mem0)/1048576), edges, dataUrl};
  });
  fs.writeFileSync('/tmp/export-4x.png', Buffer.from(result.dataUrl.split(',')[1],'base64'));
  delete result.dataUrl;
  console.log('EXPORT_4X', JSON.stringify(result));
  if (result.scale < 3.9) failures.push('scale did not reach 4x: '+result.scale);
  if (result.ms > 8000) failures.push('capture too slow under 6x throttle: '+result.ms+'ms');
  if (result.bytes > 20*1024*1024) failures.push('export too large: '+result.bytes);
  if (result.edges < 400) failures.push('export looks blank/soft, edge probe very low: '+result.edges);
  const maxSide = Math.max(result.imgW, result.imgH);
  if (maxSide > 9000) failures.push('side guard violated: '+maxSide);
} finally { await browser.close(); server.close(); }
if (failures.length) { console.log('FAILURES:', failures); process.exit(1); }
console.log('EXPORT_QUALITY_OK');
