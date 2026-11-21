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
await new Promise(r=>server.listen(4178,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures = [];
try {
  for (const theme of ['light','dark']) {
    const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2.75,isMobile:true,hasTouch:true});
    const page = await context.newPage();
    page.on('pageerror', e => failures.push(theme+' pageerror: '+e.message));
    // No external network: proves the intro works fully offline
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== 'http://127.0.0.1:4178') return route.abort();
      return route.continue();
    });
    await page.addInitScript((t) => localStorage.setItem('valerian-theme-preference-v2', t), theme);
    await page.goto('http://127.0.0.1:4178/', {waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForSelector('#splashIntroFrame', {timeout:15000});
    await page.waitForTimeout(3500); // let the intro animation play in
    await page.screenshot({path:'www/check-intro-'+theme+'.png'});
    // intro must eventually be dismissed by the app watchdog
    await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:30000});
    const frameTheme = await page.evaluate(() => {
      const f = document.getElementById('splashIntroFrame');
      try { return f.contentDocument.body.classList.contains('theme-night') ? 'night' : 'day'; }
      catch(e) { return 'unreachable: '+e.message; }
    });
    console.log(theme, '-> intro body theme:', frameTheme);
    if (theme==='dark' && frameTheme!=='night') failures.push('dark app theme did not switch intro to night edition');
    if (theme==='light' && frameTheme!=='day') failures.push('light app theme did not keep day edition');
    await context.close();
  }
} finally { await browser.close(); server.close(); }
if (failures.length) { console.log('FAILURES:', failures); process.exit(1); }
console.log('INTRO_CHECK_OK');
