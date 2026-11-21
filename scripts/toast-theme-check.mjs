import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server = http.createServer((req,res)=>{ let pathname; try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;} const target=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1)); if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;} res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'}); fs.createReadStream(target).pipe(res); });
await new Promise(r=>server.listen(4179,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4179/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__valerianSplashDismissed===true,null,{timeout:25000});
  const info = await page.evaluate(()=>{
    const probe=(theme)=>{
      document.documentElement.setAttribute('data-valerian-theme',theme);
      const box=document.getElementById('mobileToast');
      const content=box.firstElementChild;
      const cs=getComputedStyle(content), cb=getComputedStyle(box);
      return {contentColor:cs.color, contentBg:cs.backgroundColor, boxBg:cb.backgroundColor};
    };
    return {light:probe('light'), dark:probe('dark')};
  });
  console.log('styles', JSON.stringify(info,null,1));
  // live toast screenshots both themes (after splash so toast shows)
  await page.evaluate(()=>{ document.documentElement.setAttribute('data-valerian-theme','dark'); window.dispatchEvent(new Event('valerian:splash-dismissed')); });
  await page.evaluate(()=>{ window.showToast('تم حفظ الطلب بنجاح ✓'); });
  await page.waitForTimeout(400);
  await page.screenshot({path:'www/check-toast-dark.png'});
  await page.evaluate(()=>{ document.documentElement.setAttribute('data-valerian-theme','light'); window.showToast('تم حفظ الطلب بنجاح ✓'); });
  await page.waitForTimeout(400);
  await page.screenshot({path:'www/check-toast-light.png'});
  // crop toast area (top of screen)
  console.log('TOAST_THEME_OK');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
