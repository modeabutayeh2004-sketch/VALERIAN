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
const today=()=>new Date().toISOString().slice(0,10);
const dayShift=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
async function bootPage(context){
  const page = await context.newPage();
  page.on('pageerror', e => failures.push('pageerror: '+e.message));
  await page.goto('http://127.0.0.1:4184/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianUI,null,{timeout:45000});
  await page.waitForFunction(()=>window.__valerianSplashDismissed===true,null,{timeout:25000});
  return page;
}
try{
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page = await bootPage(context);
  const r = await page.evaluate(async ({todayStr,yesterday,tomorrow})=>{
    const e=window.ValerianEngine, stamp=Date.now();
    const p=await e.addProduct({name:'TREASURY CHECK '+stamp,category:'مستلزمات',productType:'مستلزمات',size:'قطعة',stockUnit:'قطعة',price:1000,averageCost:400,stock:10,minimumStock:1});
    const company='شركة خزنة '+stamp; await e.addShippingCompany(company);
    // Isolated fixture: one cash deposit of 300 and one bank-transfer deposit of 200.
    await e.createOrder({mode:'reservation',items:[{id:p.product.id,qty:1}],customer:{name:'عميل خزنة',phone:'01011112222',address:'القاهرة'},deposit:300,shippingCompany:company,paymentMethod:'نقدي'});
    await e.createOrder({mode:'reservation',items:[{id:p.product.id,qty:1}],customer:{name:'عميل خزنة 2',phone:'01011113333',address:'القاهرة'},deposit:200,shippingCompany:company,paymentMethod:'تحويل بنكي'});
    const t0=await e.getTreasury();
    const bal=(t,m)=>t.accounts.find(a=>a.method===m)?.balance??0;
    const before={cash:bal(t0,'نقدي'),bank:bal(t0,'تحويل بنكي'),total:t0.totals.balance,spent:t0.totals.spent};
    const ok=await e.transferBetweenAccounts({from:'نقدي',to:'تحويل بنكي',amount:120,date:todayStr,note:'اختبار تحويل'});
    const t1=await e.getTreasury();
    const after={cash:bal(t1,'نقدي'),bank:bal(t1,'تحويل بنكي'),total:t1.totals.balance,spent:t1.totals.spent,transfers:t1.transfers.length};
    let overErr=null; try{await e.transferBetweenAccounts({from:'نقدي',to:'تحويل بنكي',amount:99999,date:todayStr,note:'أكبر من الرصيد'});}catch(x){overErr=String(x.message||x);}
    let sameErr=null; try{await e.transferBetweenAccounts({from:'نقدي',to:'نقدي',amount:1,date:todayStr,note:'نفس الحساب'});}catch(x){sameErr=String(x.message||x);}
    let noteErr=null; try{await e.transferBetweenAccounts({from:'نقدي',to:'تحويل بنكي',amount:1,date:todayStr,note:''});}catch(x){noteErr=String(x.message||x);}
    const t2=await e.getTreasury();
    const afterRejects={cash:bal(t2,'نقدي'),transfers:t2.transfers.length,total:t2.totals.balance};

    // --- Opening balance via engine API (legacy semantics: one per account, update replaces) ---
    const cashPreOpen=bal(t2,'نقدي');
    await e.setTreasuryOpeningBalance({method:'نقدي',amount:500,date:yesterday,note:'افتتاحي اختبار'});
    const t3=await e.getTreasury(); const cashOpen1=bal(t3,'نقدي');
    await e.setTreasuryOpeningBalance({method:'نقدي',amount:700,date:yesterday,note:'تحديث الافتتاحي'});
    const t4=await e.getTreasury(); const cashOpen2=bal(t4,'نقدي');
    const openingsCash=t4.openings.filter(o=>o.method==='نقدي');
    let negErr=null; try{await e.setTreasuryOpeningBalance({method:'نقدي',amount:-5,date:yesterday});}catch(x){negErr=String(x.message||x);}
    let noDateErr=null; try{await e.setTreasuryOpeningBalance({method:'نقدي',amount:5,date:''});}catch(x){noDateErr=String(x.message||x);}
    let badMethodErr=null; try{await e.setTreasuryOpeningBalance({method:'حساب وهمي',amount:5,date:yesterday});}catch(x){badMethodErr=String(x.message||x);}
    const t5=await e.getTreasury(); const cashAfterOpenRejects=bal(t5,'نقدي');

    // --- Same-day transfer counts at day granularity (noon-stamped transfer is visible to guards) ---
    // Move the ENTIRE cash balance to بطاقة; succeeds only if the earlier same-day transfer
    // (stamped 12:00 today) is already deducted from the available balance.
    const cashNow=bal(t5,'نقدي');
    await e.transferBetweenAccounts({from:'نقدي',to:'بطاقة',amount:cashNow,date:todayStr,note:'إفراغ الخزنة'});
    const t6=await e.getTreasury();
    const cashEmpty=bal(t6,'نقدي'), cardFull=bal(t6,'بطاقة');
    let emptyErr=null; try{await e.transferBetweenAccounts({from:'نقدي',to:'بطاقة',amount:1,date:todayStr,note:'فوق الرصيد'});}catch(x){emptyErr=String(x.message||x);}

    // --- Date boundaries: tomorrow-dated transfer does not change today's balance,
    //     and the timeline guard rejects a today-dated transfer that would break tomorrow. ---
    const bankNow=bal(t6,'تحويل بنكي');
    await e.transferBetweenAccounts({from:'تحويل بنكي',to:'نقدي',amount:300,date:tomorrow,note:'تحويل الغد'});
    const t7=await e.getTreasury();
    const bankAfterTomorrow=bal(t7,'تحويل بنكي');
    let futureNegErr=null; try{await e.transferBetweenAccounts({from:'تحويل بنكي',to:'نقدي',amount:100,date:todayStr,note:'يكسر رصيد الغد'});}catch(x){futureNegErr=String(x.message||x);}
    await e.transferBetweenAccounts({from:'تحويل بنكي',to:'نقدي',amount:20,date:todayStr,note:'ضمن حدود الغد'});
    const t8=await e.getTreasury();
    const bankFinal=bal(t8,'تحويل بنكي');

    // --- Later same-day expense (legacy adjustment path) must respect future-dated obligations ---
    // بطاقة holds cashNow; promise 80% of it to a tomorrow-dated transfer, then try expenses dated today.
    const cardPromise=Math.floor(cardFull*0.8*100)/100;
    await e.transferBetweenAccounts({from:'بطاقة',to:'نقدي',amount:cardPromise,date:tomorrow,note:'التزام الغد على البطاقة'});
    const setAdjust=(dir,method,amount,date,note)=>{document.getElementById('cashAdjustDirection').value=dir;document.getElementById('cashAdjustMethod').value=method;document.getElementById('cashAdjustAmount').value=String(amount);document.getElementById('cashAdjustDate').value=date;document.getElementById('cashAdjustNote').value=note;};
    const t9=await e.getTreasury(); const cardBeforeExp=bal(t9,'بطاقة');
    setAdjust('OUT','بطاقة',cardBeforeExp,todayStr,'مصروف يكسر التزام الغد');
    window.addCashbookAdjustment();
    const t10=await e.getTreasury(); const cardAfterBadExp=bal(t10,'بطاقة');
    const cardOkExp=Math.floor((cardBeforeExp-cardPromise)*100)/100;
    setAdjust('OUT','بطاقة',cardOkExp,todayStr,'مصروف ضمن المتاح بعد الالتزام');
    window.addCashbookAdjustment();
    const t11=await e.getTreasury(); const cardAfterOkExp=bal(t11,'بطاقة');

    // --- UI render ---
    window.ValerianUI.hydrate(e.getSnapshot());
    document.querySelectorAll('.app-screen').forEach(s=>s.classList.add('hidden'));
    document.getElementById('screen-more').classList.remove('hidden');
    window.setMoreTab('treasury');
    await new Promise(r=>setTimeout(r,900));
    const ui={accounts:document.querySelectorAll('#trsAccounts > div').length,balance:document.getElementById('trsBalance').textContent,spent:document.getElementById('trsSpent').textContent,transferRows:document.querySelectorAll('#trsTransfers > div').length,openMethodOptions:document.getElementById('trsOpenMethod')?.options.length||0,openingShown:document.getElementById('trsAccounts').textContent.includes('رصيد افتتاحي')};
    const trecon=await e.getTreasury();
    const recon=trecon.accounts.map(a=>({m:a.method,diff:Math.round((a.opening+a.received+a.transferIn-a.spent-a.transferOut-a.balance)*1000)/1000}));
    const persistSnapshot={accounts:trecon.accounts.map(a=>({m:a.method,b:a.balance})),transfers:trecon.transfers.length,total:trecon.totals.balance};
    return {before,okFlag:ok.ok,after,overErr,sameErr,noteErr,afterRejects,
      open:{cashPreOpen,cashOpen1,cashOpen2,openingsCount:openingsCash.length,openingsAmount:openingsCash[0]?.amount,negErr,noDateErr,badMethodErr,cashAfterOpenRejects},
      sameDay:{cashNow,cashEmpty,cardFull,emptyErr},
      boundary:{bankNow,bankAfterTomorrow,futureNegErr,bankFinal},
      expense:{cardPromise,cardBeforeExp,cardAfterBadExp,cardOkExp,cardAfterOkExp},
      ui,recon,persistSnapshot};
  },{todayStr:today(),yesterday:dayShift(-1),tomorrow:dayShift(1)});
  console.log(JSON.stringify(r,null,1));
  const eq=(a,b)=>Math.abs(a-b)<0.001;
  if(r.before.cash<300||r.before.bank<200) failures.push('fixture deposits not on the right accounts: '+JSON.stringify(r.before));
  if(!r.okFlag) failures.push('transfer did not return ok');
  if(!eq(r.after.cash,r.before.cash-120)) failures.push('cash balance wrong after transfer');
  if(!eq(r.after.bank,r.before.bank+120)) failures.push('bank balance wrong after transfer');
  if(!eq(r.after.total,r.before.total)) failures.push('total balance changed by an internal transfer (double count or loss)');
  if(!eq(r.after.spent,r.before.spent)) failures.push('transfer was counted as spending');
  if(r.after.transfers<1) failures.push('transfer not listed');
  if(!r.overErr) failures.push('over-balance transfer was accepted');
  if(!r.sameErr) failures.push('same-account transfer was accepted');
  if(!r.noteErr) failures.push('transfer without a reason was accepted');
  if(r.afterRejects.transfers!==r.after.transfers||!eq(r.afterRejects.total,r.after.total)) failures.push('a rejected transfer changed state');
  // Opening balance
  if(!eq(r.open.cashOpen1,r.open.cashPreOpen+500)) failures.push('opening balance not added to account balance');
  if(!eq(r.open.cashOpen2,r.open.cashPreOpen+700)) failures.push('opening update double-counted (expected replace, got '+r.open.cashOpen2+' vs '+(r.open.cashPreOpen+700)+')');
  if(r.open.openingsCount!==1||r.open.openingsAmount!==700) failures.push('opening records not one-per-account: '+JSON.stringify(r.open));
  if(!r.open.negErr||!r.open.noDateErr||!r.open.badMethodErr) failures.push('invalid opening balances accepted');
  if(!eq(r.open.cashAfterOpenRejects,r.open.cashOpen2)) failures.push('a rejected opening changed state');
  // Same-day noon-stamped transfer
  if(!eq(r.sameDay.cashEmpty,0)) failures.push('same-day transfer not fully counted by the guard (cash left: '+r.sameDay.cashEmpty+')');
  if(!r.sameDay.emptyErr) failures.push('transfer from emptied account was accepted');
  // Date boundary
  if(!eq(r.boundary.bankAfterTomorrow,r.boundary.bankNow)) failures.push('tomorrow-dated transfer leaked into today balance');
  if(!r.boundary.futureNegErr) failures.push('today-transfer that breaks tomorrow was accepted');
  if(!eq(r.boundary.bankFinal,r.boundary.bankNow-20)) failures.push('bank balance wrong after allowed today-transfer');
  // Later same-day expense vs future obligation (legacy path guard)
  if(!eq(r.expense.cardAfterBadExp,r.expense.cardBeforeExp)) failures.push('legacy adjustment overdrafting a future obligation was recorded');
  if(!eq(r.expense.cardAfterOkExp,r.expense.cardBeforeExp-r.expense.cardOkExp)) failures.push('allowed legacy adjustment was not recorded');
  const badRecon=(r.recon||[]).filter(x=>Math.abs(x.diff)>0.001);
  if(badRecon.length) failures.push('account figures do not reconcile (opening+received+in-spent-out != balance): '+JSON.stringify(badRecon));
  if(r.ui.accounts<2||r.ui.transferRows<1) failures.push('treasury UI did not render accounts/transfers: '+JSON.stringify(r.ui));
  if(r.ui.openMethodOptions<5||!r.ui.openingShown) failures.push('opening-balance UI missing: '+JSON.stringify(r.ui));
  // Clean captures after toast dismissal
  await page.waitForFunction(()=>{const m=document.getElementById('mobileToast');const tc=document.getElementById('toastContainer');return (!m||m.classList.contains('hidden'))&&(!tc||!tc.children.length);},null,{timeout:9000}).catch(()=>{});
  await page.screenshot({path:'www/check-treasury.png'});
  // Scroll-bottom clearance: last treasury content must not sit under the fixed bottom nav.
  const clearance = await page.evaluate(async ()=>{
    window.scrollTo(0,document.documentElement.scrollHeight);
    await new Promise(r=>setTimeout(r,500));
    const view=document.getElementById('more-treasury');
    const last=view.lastElementChild.getBoundingClientRect();
    const nav=document.querySelector('nav.glass-dock.fixed')?.getBoundingClientRect();
    return nav?{contentBottom:Math.round(last.bottom),navTop:Math.round(nav.top),gap:Math.round(nav.top-last.bottom)}:null;
  });
  console.log('scroll clearance: '+JSON.stringify(clearance));
  if(!clearance) failures.push('bottom nav not found for clearance measurement');
  else if(clearance.gap<8) failures.push('bottom nav overlaps treasury content at scroll bottom (gap '+clearance.gap+'px)');
  await page.screenshot({path:'www/check-treasury-bottom.png'});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(()=>{document.documentElement.setAttribute('data-valerian-theme','light');});
  await page.waitForTimeout(400);
  await page.screenshot({path:'www/check-treasury-light.png'});
  await page.evaluate(()=>{document.documentElement.setAttribute('data-valerian-theme','dark');});
  // --- Persistence: reload (IndexedDB) and compare ---
  const page2 = await bootPage(context);
  const r2 = await page2.evaluate(async ()=>{const t=await window.ValerianEngine.getTreasury();return {accounts:t.accounts.map(a=>({m:a.method,b:a.balance})),transfers:t.transfers.length,total:t.totals.balance};});
  console.log('after reload: '+JSON.stringify(r2));
  const a=JSON.stringify(r.persistSnapshot.accounts),b=JSON.stringify(r2.accounts);
  if(a!==b||r.persistSnapshot.transfers!==r2.transfers||Math.abs(r.persistSnapshot.total-r2.total)>0.001) failures.push('state changed across reload (persistence/offline): '+a+' vs '+b);
  await page2.close();
  if(failures.length){console.error('TREASURY_FAILED: '+failures.join(' | '));process.exitCode=1;}else console.log('TREASURY_OK');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
