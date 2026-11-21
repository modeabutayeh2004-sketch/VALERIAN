import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const server = http.createServer((req,res)=>{ let pathname; try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;} const target=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1)); if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;} res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'}); fs.createReadStream(target).pipe(res); });
await new Promise(r=>server.listen(4182,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4182/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__valerianSplashDismissed===true,null,{timeout:25000});
  const info = await page.evaluate(async ()=>{
    appState.products.push({id:'probe1',name:'تست',price:100,offerPrice:50,isOffer:true,stock:5});
    await window.openOffersPosterPreview();
    await new Promise(r=>setTimeout(r,500));
    const hl=document.querySelector('#previewSheetBody .valerian-share-headline');
    const cs=getComputedStyle(hl);
    return {ls:cs.letterSpacing, ff:cs.fontFamily, fw:cs.fontWeight, fs:cs.fontSize,
      cairoLoaded: !!document.fonts.check('900 10px Cairo')};
  });
  console.log(JSON.stringify(info));
  const el = await page.$('#previewSheetBody .valerian-share-headline');
  await el.screenshot({path:'www/check-pill-live.png'});
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
