import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve('www');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('www/index.html is missing');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const relative = pathname === '/' ? 'index.html' : (pathname.startsWith('/') ? pathname.slice(1) : pathname);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const file = target;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, {'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const errors = [];
  for (const mode of ['dark','light']) {
    const context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    await context.addInitScript(value => localStorage.setItem('valerian-theme-preference-v2', value), mode);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(mode + ': ' + error.message));
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== 'http://127.0.0.1:4173' && u.hostname !== 'cdn.jsdelivr.net') return route.abort();
      return route.continue();
    });
    await page.goto('http://127.0.0.1:4173/', {waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
    // The branded splash intentionally runs for 4.3 seconds; do not screenshot it as the app UI.
    await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});
    await page.waitForTimeout(500);
    await page.screenshot({path:'www/visual-'+mode+'.png',fullPage:true,animations:'disabled'});
    if (mode === 'light') {
      const settingsButton = page.locator('[aria-label="الإعدادات"]');
      if (await settingsButton.count() !== 1) throw new Error('Primary settings button is missing');
      await settingsButton.click();
      await page.waitForFunction(() => !document.getElementById('settingsSheet')?.classList.contains('hidden'));
      if (await page.locator('#settingsSheetQrEditor').count() !== 1) throw new Error('QR platform editor is missing from the primary settings sheet');
      await page.locator('#settingsSheet').getByText('＋ إضافة منصة').click();
      const label = page.locator('#settingsSheetQrEditor [data-sheet-qr-label]').last();
      const url = page.locator('#settingsSheetQrEditor [data-sheet-qr-url]').last();
      await label.fill('Smoke Test');
      await url.fill('https://example.com/valerian-smoke');
      await page.locator('#settingsSheet').getByText('حفظ روابط QR').click();
      await page.waitForFunction(() => window.ValerianEngine?.getSnapshot?.().settings?.invoiceQrLinks?.some(x => x.label === 'Smoke Test' && x.url === 'https://example.com/valerian-smoke'));
      const saved = await page.evaluate(() => window.ValerianEngine.getSnapshot().settings.invoiceQrLinks);
      console.log(JSON.stringify({qrSettings:'ok',savedPlatforms:saved.length}));
      const invoiceCheck = await page.evaluate(async () => {
        window.__valerianOpenThermalReceiptPreview({
          id:'VAL-SMOKE-QR',date:'2026-11-20',mode:'reservation',status:'حجز مسبق',
          name:'عميل الاختبار',phone:'01000000000',address:'القاهرة',
          grandTotal:1000,depositAmount:300,remainingAmount:700,
          items:[{id:'smoke-product',name:'Perfume QR Test',size:'100 ml',qty:1,price:1000,total:1000}]
        });
        const until=Date.now()+20000;
        while(Date.now()<until&&!document.querySelector('#previewSheetBody .valerian-share-qr img')) await new Promise(r=>setTimeout(r,150));
        const qrImages=document.querySelectorAll('#previewSheetBody .valerian-share-qr img');
        if(!qrImages.length)throw new Error('Invoice preview did not render any QR image');
        const blob=await window.__valerianCreatePreviewImageBlob();
        if(!blob||blob.size<10000)throw new Error('Invoice export image is empty or unexpectedly small');
        const bitmap=await createImageBitmap(blob);
        const pixelCanvas=document.createElement('canvas');pixelCanvas.width=bitmap.width;pixelCanvas.height=bitmap.height;
        const pixelContext=pixelCanvas.getContext('2d',{willReadFrequently:true});pixelContext.drawImage(bitmap,0,0);
        const pixels=pixelContext.getImageData(0,0,bitmap.width,bitmap.height).data;
        let visibleSamples=0;
        for(let y=24;y<bitmap.height-24;y+=4){for(let x=24;x<bitmap.width-24;x+=4){const p=(y*bitmap.width+x)*4;const r=pixels[p],g=pixels[p+1],b=pixels[p+2];if((r<225||g<215||b<195||Math.max(r,g,b)-Math.min(r,g,b)>24)&&pixels[p+3]>0)visibleSamples++;}}
        const dimensionsValid=bitmap.width===1080&&bitmap.height<=2100&&bitmap.height>=900;
        const visibleContentValid=visibleSamples>=1500;
        const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.readAsDataURL(blob);});
        return {qrImages:qrImages.length,exportBytes:blob.size,width:bitmap.width,height:bitmap.height,visibleSamples,dimensionsValid,visibleContentValid,dataUrl};
      });
      fs.writeFileSync('www/visual-invoice-export.png',Buffer.from(invoiceCheck.dataUrl.split(',')[1],'base64'));
      delete invoiceCheck.dataUrl;
      await page.screenshot({path:'www/visual-invoice.png',fullPage:true,animations:'disabled'});
      console.log(JSON.stringify({invoiceExport:invoiceCheck.visibleContentValid&&invoiceCheck.dimensionsValid?'ok':'failed',...invoiceCheck}));
      if(!invoiceCheck.dimensionsValid)throw new Error('Invoice export canvas is not content-fitted: '+invoiceCheck.width+'x'+invoiceCheck.height);
      if(!invoiceCheck.visibleContentValid)throw new Error('Invoice export appears blank or missing rendered poster content; visible pixel samples: '+invoiceCheck.visibleSamples);
    }
    const status = await page.evaluate(() => ({
      title:document.title,
      engine:!!window.ValerianEngine,
      ui:!!window.ValerianUI,
      theme:document.documentElement.getAttribute('data-valerian-theme'),
      bodyHeight:document.body.scrollHeight,
      width:document.documentElement.scrollWidth
    }));
    console.log(JSON.stringify({mode,...status}));
    await context.close();
  }
  if (errors.length) throw new Error('Browser page errors: ' + errors.join(' | '));
  console.log('VISUAL_SMOKE_OK');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
