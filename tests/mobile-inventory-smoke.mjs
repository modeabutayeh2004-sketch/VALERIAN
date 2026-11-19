import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root=process.cwd();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
const server=http.createServer((req,res)=>{
  try{const url=new URL(req.url||'/','http://127.0.0.1');const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);const target=path.resolve(root,'.'+relative);
    if(!target.startsWith(root+path.sep)&&target!==path.join(root,'index.html')){res.writeHead(403).end('Forbidden');return;}
    fs.readFile(target,(error,data)=>{if(error){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
  }catch{res.writeHead(400).end('Bad request');}
});
const listen=()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
let browser;
try{
  const port=await listen();browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
  const result=await page.evaluate(async()=>{
    const api=window.ValerianEngine;await api.ready;
    const original=await api.addProduct({name:'VALERIAN-AUTOTEST-DECANT-'+Date.now(),productType:'عطور',category:'رجالي',size:'100 مل',price:250,averageCost:100,stock:0,stockUnit:'زجاجة أصلية',isDecantable:true,decantSizeMl:10,decantBottleCost:15});
    if(!original?.ok||!original.decantProduct?.id)throw new Error('Decantable perfume and linked SKU were not created.');
    const imported=await api.createImportInvoice({supplier:'VALERIAN TEST PERFUME SUPPLIER',date:new Date().toISOString().slice(0,10),exchangeRate:50,shippingCost:0,customsCost:0,paidAmount:0,paymentMethod:'نقدي',lines:[{productId:original.product.id,qty:2,unitForeign:10}]});
    if(!imported?.ok)throw new Error(imported?.error||'Perfume import failed.');
    const packaging=await api.createPackagingBottleInvoice({sizeMl:10,quantity:5,totalCost:50,paidAmount:50,supplier:'VALERIAN TEST PACKAGING SUPPLIER',paymentMethod:'نقدي'});
    if(!packaging?.ok)throw new Error('Shared 10ml bottle purchase failed.');
    const production=await api.produceDecants({productId:original.decantProduct.id,quantity:3});
    if(!production?.ok)throw new Error('Decant production failed.');
    let snapshot=api.getSnapshot();
    let parent=snapshot.products.find(p=>String(p.id)===String(original.product.id));
    let decant=snapshot.products.find(p=>String(p.id)===String(original.decantProduct.id));
    if(Number(parent.stock)!==1||Number(parent.decantMlAvailable)!==70)throw new Error('Original perfume liquid/bottle balance incorrect: '+JSON.stringify({stock:parent.stock,ml:parent.decantMlAvailable}));
    if(Number(decant.stock)!==3)throw new Error('Ready decant stock incorrect: '+decant.stock);
    if(Number(snapshot.packagingInventory?.['10']?.quantity)!==2)throw new Error('Shared empty bottle balance should be 2.');
    const supplyResult=await api.createOperatingSupplyInvoice({supplier:'VALERIAN TEST SUPPLY VENDOR',name:'VALERIAN-AUTOTEST-PACKING-BAGS',category:'تغليف',unit:'قطعة',quantity:10,totalCost:100,paidAmount:0,paymentMethod:'نقدي'});
    if(!supplyResult?.ok)throw new Error('Operating supply invoice failed.');
    snapshot=api.getSnapshot();
    const supply=snapshot.operatingSupplies.find(x=>x.name==='VALERIAN-AUTOTEST-PACKING-BAGS');
    const supplierInvoice=snapshot.supplierInvoices.find(x=>String(x.id)===String(supplyResult.invoice.id));
    if(!supply||Number(supply.quantity)!==10||!supplierInvoice)throw new Error('Operating supply or supplier ledger record missing.');
    const payment=await api.paySupplierInvoice({invoiceId:supplierInvoice.id,amount:100,method:'نقدي'});
    if(!payment?.ok)throw new Error(payment?.error||'Supplier payment failed.');
    const writeoff=await api.writeOffOperatingSupply({id:supply.id,quantity:2,reason:'Automated mobile inventory test',reasonType:'WASTAGE'});
    if(!writeoff?.ok)throw new Error('Operating supply write-off failed.');
    snapshot=api.getSnapshot();
    const finalSupply=snapshot.operatingSupplies.find(x=>String(x.id)===String(supply.id));
    const finalInvoice=snapshot.supplierInvoices.find(x=>String(x.id)===String(supplierInvoice.id));
    const supplierPayments=snapshot.supplierPayments.filter(x=>String(x.invoiceId)===String(supplierInvoice.id));
    if(Number(finalSupply.quantity)!==8)throw new Error('Supply write-off balance incorrect: '+finalSupply.quantity);
    if(Number(finalInvoice.paidAmount)!==100&&supplierPayments.reduce((sum,x)=>sum+Number(x.amount||0),0)!==100)throw new Error('Supplier payment was not recorded in full.');
    return {
      perfumeId:parent.id,decantProductId:decant.id,originalBottles:1,remainingPerfumeMl:70,readyDecants:3,emptyBottlesRemaining:2,
      operatingSupplyId:finalSupply.id,supplyQtyAfterWriteoff:finalSupply.quantity,supplierInvoiceId:finalInvoice.id,
      supplierPaymentTotal:supplierPayments.reduce((sum,x)=>sum+Number(x.amount||0),0)
    };
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
  const persisted=await page.evaluate(async({perfumeId,decantProductId,supplyId,invoiceId})=>{
    await window.ValerianEngine.ready;const s=window.ValerianEngine.getSnapshot();
    const p=s.products.find(x=>String(x.id)===String(perfumeId)),d=s.products.find(x=>String(x.id)===String(decantProductId)),u=s.operatingSupplies.find(x=>String(x.id)===String(supplyId)),i=s.supplierInvoices.find(x=>String(x.id)===String(invoiceId));
    return !!p&&Number(p.stock)===1&&Number(p.decantMlAvailable)===70&&!!d&&Number(d.stock)===3&&!!u&&Number(u.quantity)===8&&!!i&&Number(i.paidAmount)===100;
  },{perfumeId:result.perfumeId,decantProductId:result.decantProductId,supplyId:result.operatingSupplyId,invoiceId:result.supplierInvoiceId});
  if(!persisted)throw new Error('Decant, packaging, supplier payment, or supply stock did not survive reload.');
  if(errors.length)throw new Error('Browser runtime errors: '+errors.join(' | '));
  console.log('VALERIAN mobile inventory browser test: PASSED');
  console.log(JSON.stringify(result));
  console.log(' - Perfume import, linked decant SKU, shared bottle purchase, liquid allocation, decant production, operating supply purchase, supplier payment, write-off, and reload persistence verified.');
  await context.close();
}catch(error){console.error('VALERIAN mobile inventory browser test: FAILED');console.error(error?.stack||error);process.exitCode=1;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
