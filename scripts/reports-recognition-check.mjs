import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
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
let browser;
try {
  browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== 'http://127.0.0.1:4174' && u.hostname !== 'cdn.jsdelivr.net') return route.abort();
    return route.continue();
  });
  await page.goto('http://127.0.0.1:4174/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});
  const result = await page.evaluate(async () => {
    const engine = window.ValerianEngine, stamp = Date.now();
    const readTiles = () => {
      window.ValerianUI.hydrate(engine.getSnapshot());
      window.renderMoreReports();
      const num = id => Number(String(document.getElementById(id).textContent).replace(/[^0-9.-]/g,'')) || 0;
      return { sales: num('repMobileSales'), deposits: num('repMobileDeposits') };
    };
    const added = await engine.addProduct({name:'REPORTS CHECK '+stamp,category:'مستلزمات',productType:'مستلزمات',size:'قطعة',stockUnit:'قطعة',price:1000,averageCost:400,stock:5,minimumStock:1});
    if(!added?.ok) throw new Error('product');
    const company = 'شركة تقارير '+stamp;
    await engine.addShippingCompany(company);
    const customer = {name:'عميل تقارير',phone:'01099998888',address:'القاهرة'};
    const created = await engine.createOrder({mode:'reservation',items:[{id:added.product.id,qty:1}],customer,deposit:300,shippingCompany:company});
    if(!created?.ok) throw new Error('order');
    const afterReservation = readTiles();
    await engine.dispatchOrder({orderId:created.order.id,tracking:'TRK-'+stamp});
    const afterDispatch = readTiles();
    await engine.deliverOrder({orderId:created.order.id,method:'نقدي'});
    const afterDelivery = readTiles();
    return { afterReservation, afterDispatch, afterDelivery };
  });
  console.log(JSON.stringify(result));
  const failures = [];
  if (result.afterReservation.sales !== 0) failures.push('reservation counted in sales before dispatch');
  if (result.afterReservation.deposits !== 300) failures.push('reservation deposit missing from pending deposits');
  if (result.afterDispatch.sales !== 0) failures.push('SHIPPED ORDER COUNTED IN SALES BEFORE RECEIPT CONFIRMATION');
  if (result.afterDispatch.deposits !== 300) failures.push('shipped order deposit dropped from pending deposits');
  if (result.afterDelivery.sales !== 1000) failures.push('delivered order missing from sales');
  if (result.afterDelivery.deposits !== 0) failures.push('delivered order still counted as pending deposit');
  if (errors.length) throw new Error('Browser page errors: ' + errors.join(' | '));
  if (failures.length) { console.error('REPORTS_RECOGNITION_FAILED: ' + failures.join(' | ')); process.exitCode = 1; }
  else console.log('REPORTS_RECOGNITION_OK');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
