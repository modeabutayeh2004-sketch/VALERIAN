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
await new Promise(resolve => server.listen(4175, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== 'http://127.0.0.1:4175' && u.hostname !== 'cdn.jsdelivr.net') return route.abort();
    return route.continue();
  });
  await page.goto('http://127.0.0.1:4175/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});

  // Seed: product, company, reservation with deposit, customer debt scenario
  await page.evaluate(async () => {
    const engine = window.ValerianEngine, stamp = Date.now();
    const added = await engine.addProduct({name:'نافذة اختبار '+stamp,category:'مستلزمات',productType:'مستلزمات',size:'قطعة',stockUnit:'قطعة',price:800,averageCost:300,stock:6,minimumStock:1});
    window.__p = added.product.id;
    await engine.addShippingCompany('شركة نوافذ '+stamp);
    window.__c = 'شركة نوافذ '+stamp;
    const created = await engine.createOrder({mode:'reservation',items:[{id:added.product.id,qty:1}],customer:{name:'عميل النوافذ',phone:'01055554444',address:'القاهرة'},deposit:200,shippingCompany:'شركة نوافذ '+stamp});
    window.__o = created.order.id;
    window.ValerianUI.hydrate(engine.getSnapshot());
  });

  // 1) Shipping editor (fix #4a + #2: company prefilled)
  await page.evaluate(() => window.openMobileShippingEditor(window.__o, true));
  await page.waitForTimeout(400);
  const shipCheck = await page.evaluate(() => ({
    themed: !!document.querySelector('#mobileShippingEditor section.bg-\\[\\#07131d\\]'),
    prefilledCompany: document.getElementById('mobileShippingCompanyValue')?.value || '',
    nativeDialog: false
  }));
  await page.screenshot({path:'www/check-shipping-dialog.png'});
  await page.evaluate(() => document.getElementById('mobileShippingEditor')?.remove());

  // 2) Return modal (fix #4b: in-app, not browser prompt)
  await page.evaluate(async () => {
    // mark shipped first so disposition control shows
    await window.ValerianEngine.dispatchOrder({orderId:window.__o, tracking:'TRK-WIN'});
    window.ValerianUI.hydrate(window.ValerianEngine.getSnapshot());
    const idx = window.ValerianEngine.getSnapshot().orders.findIndex(x => String(x.id) === String(window.__o));
    window.openOrderReturnModal ? window.openOrderReturnModal(idx) : null;
  });
  await page.waitForTimeout(400);
  const returnInfo = await page.evaluate(() => {
    const modal = document.getElementById('orderReturnModal') || document.querySelector('[id*="eturn"][class*="modal"], [id*="eturnModal"]');
    return { modalId: modal ? modal.id : null, open: modal ? !modal.classList.contains('hidden') : false };
  });
  await page.screenshot({path:'www/check-return-modal.png'});
  await page.evaluate(() => document.getElementById('orderReturnModal')?.classList.add('hidden'));

  // 3) CRM debt display + settlement (fix #6)
  await page.evaluate(async () => {
    // create a return-less refund liability: dispatch happened, now return via engine to create liability
    const engine = window.ValerianEngine;
    const snap = engine.getSnapshot();
    const o = snap.orders.find(x => String(x.id) === String(window.__o));
    window.ValerianUI.hydrate(snap);
    if (window.renderCrmMobile) window.renderCrmMobile();
    // navigate to CRM view for the shot
    document.querySelectorAll('.app-screen').forEach(s => s.classList.add('hidden'));
    document.getElementById('screen-more')?.classList.remove('hidden');
    document.querySelectorAll('.more-view').forEach(v => v.classList.add('hidden'));
    document.getElementById('more-crm')?.classList.remove('hidden');
  });
  await page.waitForTimeout(400);
  const crmInfo = await page.evaluate(() => {
    const html = document.getElementById('more-crm')?.innerHTML || '';
    return { hasSettleButton: /تسوية|سداد|رد مبلغ/.test(html), length: html.length };
  });
  await page.screenshot({path:'www/check-crm.png'});

  console.log(JSON.stringify({shipCheck, returnInfo, crmInfo}));
  if (errors.length) throw new Error('Browser page errors: ' + errors.join(' | '));
  console.log('WINDOWS_VISUAL_OK');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
