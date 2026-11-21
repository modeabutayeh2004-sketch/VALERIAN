import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
const server = http.createServer((req,res)=>{ let pathname; try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;} const target=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1)); if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;} res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'}); fs.createReadStream(target).pipe(res); });
await new Promise(r=>server.listen(4186,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures=[];
try{
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.on('pageerror', e => failures.push('pageerror: '+e.message));
  await page.goto('http://127.0.0.1:4186/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianUI,null,{timeout:45000});
  await page.waitForFunction(()=>window.__valerianSplashDismissed===true,null,{timeout:25000});
  const r = await page.evaluate(async ()=>{
    const e=window.ValerianEngine, stamp=Date.now();
    const num=id=>Number(String(document.getElementById(id)?.textContent||'').replace(/[^0-9.-]/g,''))||0;
    const readDesktop=()=>{window.ValerianUI.hydrate(e.getSnapshot());window.renderReportsDashboard();return {sales:num('repFullSales'),cogs:null,expenses:num('repExpenses'),writeoff:num('repWriteoffLoss'),packLoss:num('repReturnedPackagingLoss'),net:num('repNetProfit'),returns:num('repReturns')};};
    const readMobile=()=>{window.ValerianUI.hydrate(e.getSnapshot());window.renderMoreReports();return {sales:num('repMobileSales'),losses:num('repMobileLosses'),net:num('repMobileNet'),expenses:num('repMobileExpenses')};};
    // Fixture: two products, one packaging supply with per-order + per-unit + product-override rates.
    const p1=await e.addProduct({name:'RET CHECK A '+stamp,category:'مستلزمات',productType:'مستلزمات',size:'قطعة',stockUnit:'قطعة',price:1000,averageCost:400,stock:20,minimumStock:1});
    const p2=await e.addProduct({name:'RET CHECK B '+stamp,category:'مستلزمات',productType:'مستلزمات',size:'قطعة',stockUnit:'قطعة',price:500,averageCost:200,stock:20,minimumStock:1});
    await e.createOperatingSupplyInvoice({supplier:'مورد تست '+stamp,name:'علبة تست '+stamp,category:'تغليف',unit:'قطعة',quantity:100,totalCost:1000,paidAmount:1000,paymentMethod:'نقدي'});
    const supply=e.getSnapshot().operatingSupplies.find(s=>String(s.name).includes('علبة تست '+stamp));
    await e.updateOperatingSupplyRecipe({id:supply.id,recipePerOrder:1,recipePerUnit:0.5,minimumStock:0,productRecipes:{[String(p2.product.id)]:2}});
    const company='شركة مرتجعات '+stamp; await e.addShippingCompany(company);
    const customer={name:'عميل مرتجعات',phone:'01022223333',address:'القاهرة'};
    const items=[{id:p1.product.id,qty:2},{id:p2.product.id,qty:1}];
    // Expected per-order supply consumption: 1 (per order) + 0.5*2 (P1 per unit) + 2*1 (P2 override) = 4 units @ 10 = 40.
    const mk=async deposit=>{
      const c=await e.createOrder({mode:'reservation',items,customer,deposit,shippingCompany:company,paymentMethod:'نقدي'});
      await e.dispatchOrder({orderId:c.order.id,tracking:'TRK-'+stamp+'-'+c.order.id});
      return c.order.id;
    };
    const orderA=await mk(2500); // delivered, no return
    const orderB=await mk(2500); // delivered, partial return
    const orderC=await mk(2500); // delivered, full return
    const orderD=await mk(1000); // failed shipment: shipped, fully returned before delivery
    const snap0=e.getSnapshot();
    const ord=id=>snap0.orders.find(o=>String(o.id)===String(id));
    const consumed={A:ord(orderA).operatingSuppliesCost,B:ord(orderB).operatingSuppliesCost,C:ord(orderC).operatingSuppliesCost,D:ord(orderD).operatingSuppliesCost};
    const supplyAfterDispatch=e.getSnapshot().operatingSupplies.find(s=>s.id===supply.id).quantity;
    await e.deliverOrder({orderId:orderA,method:'نقدي'});
    await e.deliverOrder({orderId:orderB,method:'نقدي'});
    await e.deliverOrder({orderId:orderC,method:'نقدي'});
    const before=readDesktop();
    // Partial return on B: one P1 restocked.
    await e.returnOrder({orderId:orderB,selections:[{productId:p1.product.id,qty:1,disposition:'restock'}]});
    const afterPartial=readDesktop();
    // Full return on C: P1 restocked, P2 written off (damaged).
    await e.returnOrder({orderId:orderC,selections:[{productId:p1.product.id,qty:2,disposition:'restock'},{productId:p2.product.id,qty:1,disposition:'writeoff'}]});
    const afterFull=readDesktop();
    // Repeat the full return on C: must be refused and change nothing.
    let repeatErr=null; try{await e.returnOrder({orderId:orderC,selections:[{productId:p1.product.id,qty:1,disposition:'restock'}]});}catch(x){repeatErr=String(x.message||x);}
    const afterRepeat=readDesktop();
    // Failed-shipment full return on D (never delivered).
    await e.returnOrder({orderId:orderD,selections:[{productId:p1.product.id,qty:2,disposition:'restock'},{productId:p2.product.id,qty:1,disposition:'restock'}]});
    const afterFailedShip=readDesktop();
    // Atomicity: an invalid return (qty beyond remaining) must not change anything.
    const stockBefore=JSON.stringify(e.getSnapshot().products.map(p=>({id:p.id,stock:p.stock,writeoffStock:p.writeoffStock,quarantineStock:p.quarantineStock})));
    let badErr=null; try{await e.returnOrder({orderId:orderB,selections:[{productId:p1.product.id,qty:99,disposition:'restock'}]});}catch(x){badErr=String(x.message||x);}
    const stockAfter=JSON.stringify(e.getSnapshot().products.map(p=>({id:p.id,stock:p.stock,writeoffStock:p.writeoffStock,quarantineStock:p.quarantineStock})));
    const afterBad=readDesktop();
    const mobile=readMobile();
    // Direct helper assertions on the FINAL state (order B still has 1 returned P1):
    // attributed consumption -> exact per-unit cost; legacy aggregate -> honest refusal.
    const ordB=e.getSnapshot().orders.find(o=>String(o.id)===String(orderB));
    const helperB=window.getReturnedUnitSupplyCost(ordB);
    const helperLegacy=window.getReturnedUnitSupplyCost({items:[{id:'x',qty:2,returnedQty:1}],operatingSupplyConsumption:[{supplyId:'s',name:'legacy',quantity:4,unit:'قطعة',unitCost:10,totalCost:40}]});
    return {consumed,supplyAfterDispatch,before,afterPartial,afterFull,repeatErr,afterRepeat,afterFailedShip,badErr,stockSame:stockBefore===stockAfter,afterBad,mobile,helperB,helperLegacy};
  });
  console.log(JSON.stringify(r,null,1));
  const eq=(a,b)=>Math.abs(a-b)<0.001;
  // Consumption math: 4 units @ 10 EGP per order, all four orders.
  ['A','B','C','D'].forEach(k=>{if(!eq(r.consumed[k],40))failures.push('order '+k+' supply cost expected 40, got '+r.consumed[k]);});
  if(!eq(r.supplyAfterDispatch,84)) failures.push('supply stock after 4 dispatches expected 84, got '+r.supplyAfterDispatch);
  // Before returns: all 160 in COGS-era; packaging loss line must be 0.
  if(!eq(r.before.packLoss,0)) failures.push('packaging loss before any full return should be 0, got '+r.before.packLoss);
  // Partial return (owner ruling, settled 2026-11-21): the shared carton stays in COGS with
  // the retained sale, but the returned unit's OWN per-unit packaging reclassifies to loss —
  // his standing rule that a returned product's supplies go to wastage applies to the unit's
  // own packaging regardless of disposition (this scenario restocks the unit).
  // B returned 1 P1: per-unit rate 0.5 x 1 unit x 10 EGP = 5.
  if(!eq(r.afterPartial.packLoss,5)) failures.push('partial return must reclassify the returned unit own packaging only (expected 5), got '+r.afterPartial.packLoss);
  if(!eq(r.afterPartial.net,r.before.net-0)) { /* partial return changes sales/cogs of products; net moves, no fixed delta asserted */ }
  // Full return on C: its whole 40 reclassified; running total 5 (B) + 40 (C) = 45; writeoff adds 200 (damaged P2).
  if(!eq(r.afterFull.packLoss,45)) failures.push('packaging loss after full return expected 45, got '+r.afterFull.packLoss);
  if(!eq(r.afterFull.writeoff,r.afterPartial.writeoff+200)) failures.push('writeoff loss for damaged P2 expected +200');
  // Net-profit neutrality of the reclassification: moving 40 from COGS to loss leaves net unchanged vs doing neither.
  // (net after full return reflects the sale reversal too, so assert reconciliation instead below.)
  // Idempotent repeat: refused, numbers unchanged.
  if(!r.repeatErr) failures.push('repeat full return was accepted');
  if(JSON.stringify(r.afterRepeat)!==JSON.stringify(r.afterFull)) failures.push('repeat return changed the reports');
  // Failed shipment (never delivered): packaging loss +40 more, sales unchanged.
  if(!eq(r.afterFailedShip.packLoss,85)) failures.push('failed-shipment packaging loss expected 85 total, got '+r.afterFailedShip.packLoss);
  if(!eq(r.afterFailedShip.sales,r.afterFull.sales)) failures.push('failed-shipment return changed recognized sales');
  // Reconciliation: supply cost consumed (160) = still in COGS (A 40 + B 35) + reclassified to loss (B 5 + C 40 + D 40).
  const supplyInCogs=160-r.afterFailedShip.packLoss;
  if(!eq(supplyInCogs,75)) failures.push('reconciliation broken: COGS supply '+supplyInCogs+' + loss '+r.afterFailedShip.packLoss+' != 160');
  // Net profit self-consistency on the desktop tiles.
  const expectNet=r.afterFailedShip.sales-r.afterFailedShip.expenses-r.afterFailedShip.writeoff-r.afterFailedShip.packLoss;
  // totalCogs is not a tile; net = sales - cogs - expenses - writeoff - packLoss, so derive cogs from net and compare against expected cogs (1600 products + 80 supplies).
  const derivedCogs=r.afterFailedShip.sales-r.afterFailedShip.expenses-r.afterFailedShip.writeoff-r.afterFailedShip.packLoss-r.afterFailedShip.net;
  if(!eq(derivedCogs,1675)) failures.push('derived COGS expected 1675 (products 1600 + supplies 75), got '+derivedCogs);
  // Atomicity of a rejected return.
  if(!r.badErr) failures.push('over-quantity return was accepted');
  if(!r.stockSame) failures.push('rejected return mutated product stocks');
  if(JSON.stringify(r.afterBad)!==JSON.stringify(r.afterFailedShip)) failures.push('rejected return changed the reports');
  // Mobile consistency: losses = writeoff 200 + packaging 85 = 285; net uses the same rule.
  if(!eq(r.mobile.losses,285)) failures.push('mobile losses expected 285, got '+r.mobile.losses);
  const mobileExpectedNet=r.mobile.sales-1675-r.mobile.expenses-285;
  if(!eq(r.mobile.net,mobileExpectedNet)) failures.push('mobile net expected '+mobileExpectedNet+', got '+r.mobile.net);
  // Attribution helper: exact for attributed orders, honest refusal for legacy aggregates.
  if(!r.helperB||!eq(r.helperB.cost,5)||r.helperB.complete!==true) failures.push('helper on attributed order B expected {cost:5,complete:true}, got '+JSON.stringify(r.helperB));
  if(!r.helperLegacy||!eq(r.helperLegacy.cost,0)||r.helperLegacy.complete!==false) failures.push('helper on legacy aggregate expected {cost:0,complete:false} (no invented split), got '+JSON.stringify(r.helperLegacy));
  if(failures.length){console.error('RETURNS_WASTAGE_FAILED: '+failures.join(' | '));process.exitCode=1;}else console.log('RETURNS_WASTAGE_OK');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
