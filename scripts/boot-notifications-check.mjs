import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server = http.createServer((req,res)=>{ let pathname; try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;} const target=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1)); if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;} res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'}); fs.createReadStream(target).pipe(res); });
await new Promise(r=>server.listen(4181,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures=[];
async function ev(page, fn){
  for (let i=0;i<40;i++){
    try { return await page.evaluate(fn); }
    catch(e){ if (!String(e).includes('Execution context')) throw e; await page.waitForTimeout(300); }
  }
  throw new Error('never got a stable context');
}
async function wf(page, fn, timeout){
  for (let i=0;i<40;i++){
    try { return await page.waitForFunction(fn,null,{timeout}); }
    catch(e){ if (!String(e).includes('Execution context')) throw e; await page.waitForTimeout(300); }
  }
}

async function boot(themePref){
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  await page.route('**/sw.js', r=>r.abort()); // no SW self-reload race in this check
  if (themePref) await page.addInitScript((v)=>{ try{localStorage.setItem('valerian-theme-preference-v2',v);}catch(_){}} , themePref);
  await page.goto('http://127.0.0.1:4181/',{waitUntil:'domcontentloaded',timeout:30000});
  // The app may reload once when the service worker takes control; settle past that.
  for (let i=0;i<40;i++){
    try { if (await page.evaluate(()=>typeof window.showToast==='function' && !!document.getElementById('mobileToast'))) break; }
    catch(_) { /* navigation in flight */ }
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(()=>typeof window.showToast==='function',null,{timeout:45000});
  return {context,page};
}
try{
  // 1) toast during splash is queued, not shown; flushed after dismiss
  {
    const {context,page} = await boot(null);
    let queuedState = await ev(page, async ()=>{
          if (!window.__testToastSent) { window.__testToastSent=true; window.showToast('رسالة أثناء الانترو'); }
          await new Promise(r=>setTimeout(r,300));
          const mt=document.getElementById('mobileToast');
          return {dismissed:!!window.__valerianSplashDismissed, toastVisible: mt && !mt.classList.contains('hidden'), queueLen:(window.__valerianToastQueue||[]).length};
        });
    if (queuedState.toastVisible) failures.push('toast shown over intro');
    if (!queuedState.dismissed && queuedState.queueLen!==1) failures.push('toast not queued during splash (dismissed='+queuedState.dismissed+')');
    await wf(page, ()=>window.__valerianSplashDismissed===true, 25000);
    await wf(page, ()=>{const mt=document.getElementById('mobileToast');return mt&&!mt.classList.contains('hidden')&&mt.textContent.includes('رسالة أثناء الانترو');}, 8000);
    await context.close();
  }
  // 2) theme persistence into intro: dark at last close -> night intro next boot
  for (const [pref,expectNight] of [['dark',true],['light',false]]) {
    const {context,page} = await boot(pref);
    const res = await ev(page, async ()=>{
      const until=Date.now()+6000; let frame=null;
      while(Date.now()<until){
        frame=document.querySelector('#splashOverlay iframe');
        if(frame && frame.contentDocument && frame.contentDocument.body) break;
        await new Promise(r=>setTimeout(r,120)); frame=null;
      }
      if(!frame) return {err:'no intro frame'};
      await new Promise(r=>setTimeout(r,700));
      const b=frame.contentDocument.body;
      return {night:b.classList.contains('theme-night')};
    });
    if (res.err) failures.push('intro frame missing ('+pref+')');
    else if (res.night!==expectNight) failures.push('intro theme mismatch for saved '+pref+': night='+res.night);
    await context.close();
  }
  if (failures.length){ console.error('BOOT_NOTIF_FAILED: '+failures.join(' | ')); process.exitCode=1; }
  else console.log('BOOT_NOTIF_OK');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
