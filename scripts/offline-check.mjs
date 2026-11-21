import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
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
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2.75,isMobile:true,hasTouch:true,serviceWorkers:'allow'});
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== 'http://127.0.0.1:4174') return route.abort(); // no external network in this test
    return route.continue();
  });
  await page.goto('http://127.0.0.1:4174/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});
  // His preference: light theme
  await page.evaluate(() => { localStorage.setItem('valerian-theme-preference-v2','light'); document.documentElement.setAttribute('data-valerian-theme','light'); });
  // Seed real data
  const seed = await page.evaluate(async () => {
    const engine = window.ValerianEngine;
    const added = await engine.addProduct({name:'OFFLINE CHECK PRODUCT',category:'مستلزمات',productType:'مستلزمات',size:'قطعة',stockUnit:'قطعة',price:1000,averageCost:400,stock:5,minimumStock:1});
    if(!added?.ok) throw new Error('product seed failed');
    const created = await engine.createOrder({mode:'reservation',items:[{id:added.product.id,qty:1}],customer:{name:'عميل اوفلاين',phone:'01011112222',address:'القاهرة'},deposit:300});
    if(!created?.ok) throw new Error('order seed failed');
    return {orderId: created.order.id, orders: engine.getSnapshot().orders.length};
  });
  // Wait for the service worker to control the page and finish precaching
  await page.waitForFunction(async () => {
    if (!navigator.serviceWorker.controller) return false;
    const keys = await caches.keys();
    const key = keys.find(k => k.includes('unified-qr-intro'));
    if (!key) return false;
    const cache = await caches.open(key);
    const cached = await cache.keys();
    return cached.length >= 5;
  }, null, {timeout:30000});

  // Go offline and reload; the first navigation can race service-worker startup
  // right after an update, so retry once before judging.
  await context.setOffline(true);
  try {
    await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  } catch (e) {
    await page.waitForTimeout(1500);
    await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  }
  const readOfflineState = () => page.evaluate(async () => {
    const wait = (fn, ms) => new Promise(res => { const t0=Date.now(); const tick=()=>{ let v; try{v=fn();}catch(_){v=null;} if(v||Date.now()-t0>ms) res(v||null); else setTimeout(tick,200); }; tick(); });
    const booted = await wait(() => !!(window.ValerianEngine && window.ValerianUI), 30000);
    if (!booted) return {booted:false};
    await wait(() => window.__valerianSplashDismissed === true, 20000);
    const snap = window.ValerianEngine.getSnapshot();
    const theme = document.documentElement.getAttribute('data-valerian-theme');
    const hasOrder = (snap.orders||[]).some(o => o && o.customer && o.customer.name === 'عميل اوفلاين') || (snap.orders||[]).length > 0;
    // Try a real offline write through the engine
    let writeOk = false, writeError = null;
    try {
      const added = await window.ValerianEngine.addProduct({name:'OFFLINE WRITE '+Date.now(),category:'مستلزمات',productType:'مستلزمات',size:'قطعة',stockUnit:'قطعة',price:50,averageCost:10,stock:2,minimumStock:0});
      writeOk = !!added?.ok;
    } catch (e) { writeError = String(e && e.message || e); }
    // Check that a main screen renders with numbers
    window.ValerianUI.hydrate(window.ValerianEngine.getSnapshot());
    const bodyText = document.body.innerText.slice(0, 400);
    return {booted:true, theme, hasOrder, orders:(snap.orders||[]).length, writeOk, writeError, bodyText:bodyText.replace(/\s+/g,' ').slice(0,200)};
  });
  let offlineState = await readOfflineState();
  if (!offlineState.booted) {
    await page.reload({waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    offlineState = await readOfflineState();
  }
  console.log('OFFLINE_STATE', JSON.stringify(offlineState));
  await page.screenshot({path:'www/check-offline-home.png', fullPage:false});
  if (!offlineState.booted) failures.push('engine did not boot offline');
  else {
    if (offlineState.theme !== 'light') failures.push('theme preference lost offline: '+offlineState.theme);
    if (!offlineState.hasOrder) failures.push('seeded order missing offline');
    if (!offlineState.writeOk) failures.push('offline write failed: '+offlineState.writeError);
  }
  // Back online: data persists
  await context.setOffline(false);
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  const onlineAgain = await page.evaluate(() => {
    const snap = window.ValerianEngine.getSnapshot();
    return {orders:(snap.orders||[]).length, hasOfflineWrite:(snap.products||[]).some(p=>String(p.name||'').startsWith('OFFLINE WRITE'))};
  });
  console.log('ONLINE_AGAIN', JSON.stringify(onlineAgain));
  if (!onlineAgain.hasOfflineWrite) failures.push('offline write did not survive reload');
  const fatal = consoleErrors.filter(e => !/favicon|net::|Failed to load resource/i.test(e));
  if (fatal.length) failures.push('page errors: '+fatal.join(' | ').slice(0,300));
} finally {
  await browser.close(); server.close();
}
if (failures.length) { console.error('OFFLINE_CHECK_FAILED: '+failures.join(' | ')); process.exitCode = 1; }
else console.log('OFFLINE_CHECK_OK');
