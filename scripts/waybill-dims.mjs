// Measure waybill product-field geometry for a given tree (current or baseline).
// Usage: node scripts/waybill-dims.mjs <rootDir> <port>
// Prints one JSON line: per product-container: article height, stats strip height,
// and each stat-box width/height. Used to prove the clipping fix shrank fonts
// instead of growing fields (user constraint: never enlarge the fields).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(process.argv[2] || 'www');
const port = Number(process.argv[3] || 4178);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.css':'text/css'};
const server = http.createServer((req,res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2.75,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.on('pageerror', e => console.error('pageerror:', e.message)); page.on('console', m => { if (m.type()==='error') console.error('console.error:', m.text()); });
  await page.goto('http://127.0.0.1:'+port+'/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});

  await page.evaluate(async () => {
    const engine = window.ValerianEngine, stamp = Date.now();
    const p1 = await engine.addProduct({name:'Old Spice (Epic Legend)',category:'عطور',productType:'عطر',size:'100 مل',stockUnit:'قطعة',price:3438,offerPrice:1710,isOffer:true,averageCost:2000,stock:20,minimumStock:1});
    const p2 = await engine.addProduct({name:'Prestige Black تقسيم',category:'عطور',productType:'عطر',size:'50 مل',stockUnit:'قطعة',price:500,offerPrice:400,isOffer:true,averageCost:250,stock:15,minimumStock:1});
    if(!p1?.ok || !p2?.ok) throw new Error('seed products');
    await engine.addShippingCompany('شركة شحن تجريبية');
    const customer = {name:'عميل تجريبي',phone:'01000000001',address:'البلد'};
    const created = await engine.createOrder({mode:'reservation',items:[{id:p1.product.id,qty:1},{id:p2.product.id,qty:1}],customer,deposit:1916,shippingCompany:'شركة شحن تجريبية'});
    if(!created?.ok) throw new Error('seed order');
    const dispatched = await engine.dispatchOrder({orderId:created.order.id,tracking:'TRK-'+stamp});
    if(!dispatched?.ok) throw new Error('dispatch failed');
    window.__seededOrderId = String(created.order.id);
  });
  // Separate evaluate (matches doc-exports-check): lets appState settle before render.
  await page.evaluate(async (orderId) => {
    window.printMobileWaybill(orderId);
    await new Promise(r=>setTimeout(r,800));
  }, await page.evaluate(() => window.__seededOrderId));
  await page.waitForSelector('#previewSheetBody .product-container', {timeout:20000});
  const dims = await page.evaluate(() => {
    return [...document.querySelectorAll('#previewSheetBody .product-container')].map(article => {
      const ar = article.getBoundingClientRect();
      const stats = article.querySelector('.product-stats').getBoundingClientRect();
      return {
        articleH: +ar.height.toFixed(2),
        statsH: +stats.height.toFixed(2),
        statsW: +stats.width.toFixed(2),
        cells: [...article.querySelectorAll('.stat-box')].map(div => {
          const r = div.getBoundingClientRect();
          return {w:+r.width.toFixed(2), h:+r.height.toFixed(2)};
        })
      };
    });
  });
  console.log(JSON.stringify({root, dims}));
} finally {
  await browser.close();
  server.close();
}
