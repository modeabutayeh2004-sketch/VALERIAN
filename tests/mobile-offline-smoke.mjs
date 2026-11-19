import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root=process.cwd();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
const server=http.createServer((req,res)=>{
  try{
    const url=new URL(req.url||'/','http://127.0.0.1');
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const target=path.resolve(root,'.'+relative);
    if(!target.startsWith(root+path.sep)&&target!==path.join(root,'index.html')){res.writeHead(403).end('Forbidden');return;}
    fs.readFile(target,(error,data)=>{if(error){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
  }catch{res.writeHead(400).end('Bad request');}
});
const listen=()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
let browser;
try{
  const port=await listen();
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/,route=>route.abort());
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
  await page.evaluate(()=>window.ValerianEngine.ready);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:20000});
  const onlineCheck=await page.evaluate(()=>{
    const make=(cls)=>{const e=document.createElement('div');e.className=cls;document.body.appendChild(e);const s=getComputedStyle(e);const out={display:s.display,padding:s.padding};e.remove();return out;};
    return {
      controlled:!!navigator.serviceWorker.controller,
      hidden:make('hidden').display,
      flex:make('flex').display,
      grid:make('grid').display,
      padded:make('p-4').padding,
      mainVisible:!!document.getElementById('tab-pos')&&document.getElementById('tab-pos').getBoundingClientRect().width>0
    };
  });
  if(!onlineCheck.controlled||onlineCheck.hidden!=='none'||onlineCheck.flex!=='flex'||onlineCheck.grid!=='grid'||onlineCheck.padded!=='16px'||!onlineCheck.mainVisible){
    throw new Error('Offline CSS/app-shell precheck failed: '+JSON.stringify(onlineCheck));
  }
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
  const offline=await page.evaluate(async()=>{
    await window.ValerianEngine.ready;
    const e=document.createElement('div');e.className='hidden';document.body.appendChild(e);
    const hidden=getComputedStyle(e).display;e.remove();
    return {online:navigator.onLine,controlled:!!navigator.serviceWorker.controller,engineVersion:window.ValerianEngine.version,hidden,mainVisible:!!document.getElementById('tab-pos')&&document.getElementById('tab-pos').getBoundingClientRect().width>0,products:Array.isArray(window.ValerianEngine.getSnapshot()?.products)};
  });
  if(offline.online||!offline.controlled||hidden!=='none'||!offline.mainVisible||!offline.products)throw new Error('Offline reload failed: '+JSON.stringify(offline));
  if(errors.length)throw new Error('Browser runtime errors: '+errors.join(' | '));
  console.log('VALERIAN mobile offline browser test: PASSED');
  console.log(JSON.stringify({onlineCheck,offline}));
  console.log(' - External network blocked, app shell cached, service worker controlled, engine initialized, and essential Tailwind utilities rendered after offline reload.');
  await context.close();
}catch(error){
  console.error('VALERIAN mobile offline browser test: FAILED');
  console.error(error?.stack||error);
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
