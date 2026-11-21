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

  const result = await page.evaluate(async () => {
    const E = window.ValerianEngine;
    const prod = await E.addProduct({name:'منتج تجريبي (اختبار)', category:'عطور رجالية', size:'100 مل', productType:'عطور', price:3438, cost:1800, stock:0});
    if (!prod.ok) return {stage:'product', prod};
    const imp = await E.createImportInvoice({supplier:'مورد العطور', date:'2026-11-20', exchangeRate:50, paidAmount:9000, paymentMethod:'نقدي', lines:[{productId:prod.product.id, qty:5, unitForeign:36}]});
    if (!imp.ok) return {stage:'import', imp};
    const ord = await E.createOrder({mode:'reservation', items:[{id:prod.product.id, qty:2}],
      customer:{name:'عميل تجريبي', phone:'01000000000', address:'عنوان تجريبي'},
      shipping:100, deposit:2093, paymentMethod:'نقدي'});
    if (!ord.ok) return {stage:'order', ord};
    const order = ord.order;
    window.__valerianOpenThermalReceiptPreview(order);
    const until=Date.now()+20000;
    while(Date.now()<until && !document.querySelector('#previewSheetBody .valerian-share-qr img')) await new Promise(r=>setTimeout(r,150));
    const t0 = performance.now();
    const blob = await window.__valerianCreatePreviewImageBlob();
    const ms = Math.round(performance.now()-t0);
    const dataUrl = await new Promise(res=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.readAsDataURL(blob);});
    return {stage:'done', ms, bytes:blob.size, dataUrl,
      orderSummary:{subtotal:order.subtotal, shipping:order.shipping, grandTotal:order.grandTotal, depositAmount:order.depositAmount, remainingAmount:order.remainingAmount, status:order.status, id:order.id}};
  });
  if (result.stage !== 'done') { failures.push('engine flow failed: '+JSON.stringify(result).slice(0,500)); }
  else {
    fs.writeFileSync('www/check-invoice-accurate.png', Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    delete result.dataUrl;
    console.log(JSON.stringify(result, null, 1));
    const s = result.orderSummary;
    if (!(s.subtotal === 6876 && s.shipping === 100 && s.grandTotal === 6976 && s.depositAmount === 2093 && s.remainingAmount === 4883)) failures.push('engine totals unexpected: '+JSON.stringify(s));
  }
} finally {
  await browser.close(); server.close();
}
if (failures.length) { console.error('INVOICE_ACCURATE_FAILED: '+failures.join(' | ')); process.exitCode = 1; }
else console.log('INVOICE_ACCURATE_OK');
