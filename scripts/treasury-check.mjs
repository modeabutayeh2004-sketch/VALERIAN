import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const server = http.createServer((req,res)=>{ let pathname; try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;} const target=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1)); if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;} res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'}); fs.createReadStream(target).pipe(res); });
await new Promise(r=>server.listen(4184,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures=[];
try{
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.on('pageerror', e => failures.push('pageerror: '+e.message));
  await page.goto('http://127.0.0.1:4184/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianUI,null,{timeout:45000});
  await page.waitForFunction(()=>window.__valerianSplashDismissed===true,null,{timeout:25000});
  const r = await page.evaluate(async ()=>{
    const e=window.ValerianEngine, stamp=Date.now();
    const p=await e.addProduct({name:'TREASURY CHECK '+stamp,category:'مستلزمات',productType:'مستلزمات',size:'قطعة',stockUnit:'قطعة',price:1000,averageCost:400,stock:10,minimumStock:1});
    const company='شركة خزنة '+stamp; await e.addShippingCompany(company);
    // Isolated fixture: one cash deposit of 300 and one bank-transfer deposit of 200.
    await e.createOrder({mode:'reservation',items:[{id:p.product.id,qty:1}],customer:{name:'عميل خزنة',phone:'01011112222',address:'القاهرة'},deposit:300,shippingCompany:company,paymentMethod:'نقدي'});
    await e.createOrder({mode:'reservation',items:[{id:p.product.id,qty:1}],customer:{name:'عميل خزنة 2',phone:'01011113333',address:'القاهرة'},deposit:200,shippingCompany:company,paymentMethod:'تحويل بنكي'});
    const t0=await e.getTreasury();
    const bal=(t,m)=>t.accounts.find(a=>a.method===m)?.balance??0;
    const before={cash:bal(t0,'نقدي'),bank:bal(t0,'تحويل بنكي'),total:t0.totals.balance,spent:t0.totals.spent};
    const ok=await e.transferBetweenAccounts({from:'نقدي',to:'تحويل بنكي',amount:120,date:new Date().toISOString().slice(0,10),note:'اختبار تحويل'});
    const t1=await e.getTreasury();
    const after={cash:bal(t1,'نقدي'),bank:bal(t1,'تحويل بنكي'),total:t1.totals.balance,spent:t1.totals.spent,transfers:t1.transfers.length};
    let overErr=null; try{await e.transferBetweenAccounts({from:'نقدي',to:'تحويل بنكي',amount:99999,date:new Date().toISOString().slice(0,10),note:'أكبر من الرصيد'});}catch(x){overErr=String(x.message||x);}
    let sameErr=null; try{await e.transferBetweenAccounts({from:'نقدي',to:'نقدي',amount:1,date:new Date().toISOString().slice(0,10),note:'نفس الحساب'});}catch(x){sameErr=String(x.message||x);}
    let noteErr=null; try{await e.transferBetweenAccounts({from:'نقدي',to:'تحويل بنكي',amount:1,date:new Date().toISOString().slice(0,10),note:''});}catch(x){noteErr=String(x.message||x);}
    const t2=await e.getTreasury();
    // UI render
    window.ValerianUI.hydrate(e.getSnapshot());
    window.setMoreTab&&0; document.querySelectorAll('.app-screen').forEach(s=>s.classList.add('hidden'));
    document.getElementById('screen-more').classList.remove('hidden');
    window.setMoreTab('treasury');
    await new Promise(r=>setTimeout(r,800));
    const ui={accounts:document.querySelectorAll('#trsAccounts > div').length,balance:document.getElementById('trsBalance').textContent,spent:document.getElementById('trsSpent').textContent,transferRows:document.querySelectorAll('#trsTransfers > div').length};
    return {before,okFlag:ok.ok,after,overErr,sameErr,noteErr,afterRejects:{cash:bal(t2,'نقدي'),transfers:t2.transfers.length,total:t2.totals.balance},ui};
  });
  console.log(JSON.stringify(r));
  if(r.before.cash<300||r.before.bank<200) failures.push('fixture deposits not on the right accounts: '+JSON.stringify(r.before));
  if(!r.okFlag) failures.push('transfer did not return ok');
  if(Math.abs(r.after.cash-(r.before.cash-120))>0.001) failures.push('cash balance wrong after transfer');
  if(Math.abs(r.after.bank-(r.before.bank+120))>0.001) failures.push('bank balance wrong after transfer');
  if(Math.abs(r.after.total-r.before.total)>0.001) failures.push('total balance changed by an internal transfer (double count or loss)');
  if(Math.abs(r.after.spent-r.before.spent)>0.001) failures.push('transfer was counted as spending');
  if(r.after.transfers<1) failures.push('transfer not listed');
  if(!r.overErr) failures.push('over-balance transfer was accepted');
  if(!r.sameErr) failures.push('same-account transfer was accepted');
  if(!r.noteErr) failures.push('transfer without a reason was accepted');
  if(r.afterRejects.transfers!==r.after.transfers||Math.abs(r.afterRejects.total-r.after.total)>0.001) failures.push('a rejected transfer changed state');
  if(r.ui.accounts<2||r.ui.transferRows<1) failures.push('treasury UI did not render accounts/transfers: '+JSON.stringify(r.ui));
  await page.screenshot({path:'www/check-treasury.png'});
  if(failures.length){console.error('TREASURY_FAILED: '+failures.join(' | '));process.exitCode=1;}else console.log('TREASURY_OK');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
