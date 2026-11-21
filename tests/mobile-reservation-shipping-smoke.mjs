import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root=process.cwd(),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{try{const u=new URL(req.url||'/','http://127.0.0.1'),rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname),target=path.resolve(root,'.'+rel);if(!target.startsWith(root+path.sep)&&target!==path.join(root,'index.html')){res.writeHead(403).end();return;}fs.readFile(target,(e,d)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(d);});}catch{res.writeHead(400).end();}});
const listen=()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
let browser;
try{
 const port=await listen();browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
 const result=await page.evaluate(async()=>{
  const api=window.ValerianEngine;await api.ready;
  const suffix=Date.now(),company='VALERIAN TEST SHIP '+suffix,phone='011'+String(suffix).slice(-8);
  const product=await api.addProduct({name:'VALERIAN-AUTOTEST-RESERVATION-'+suffix,productType:'مزيلات عرق',category:'رجالي',size:'150 مل',price:250,averageCost:100,stock:5,stockUnit:'قطعة'});
  if(!product?.ok)throw new Error('Reservation test product creation failed.');
  const customer=await api.createCustomerProfile({name:'عميل اختبار شحن',phone,address:'عنوان اختبار الشحن'});
  if(!customer?.ok)throw new Error('Reservation test customer creation failed.');
  const added=await api.addShippingCompany(company);if(!added?.ok)throw new Error('Test shipping company registration failed.');
  const created=await api.createOrder({mode:'reservation',items:[{id:product.product.id,qty:2}],customer:{name:'عميل اختبار شحن',phone,address:'عنوان اختبار الشحن'},shipping:0,discount:0,deposit:100,paymentMethod:'نقدي'});
  if(!created?.ok)throw new Error(created?.error||'Reservation creation failed.');
  let snap=api.getSnapshot(),p=snap.products.find(x=>String(x.id)===String(product.product.id)),o=snap.orders.find(x=>String(x.id)===String(created.order.id));
  if(Number(p.stock)!==5||Number(p.reservedStock)!==2||Number(o.depositAmount)!==100)throw new Error('Reservation did not reserve stock and register the deposit correctly.');
  const dispatched=await api.dispatchOrder({orderId:o.id,company,tracking:'TEST-'+suffix});
  if(!dispatched?.ok)throw new Error(dispatched?.error||'Shipment dispatch failed.');
  snap=api.getSnapshot();p=snap.products.find(x=>String(x.id)===String(product.product.id));o=snap.orders.find(x=>String(x.id)===String(created.order.id));
  if(Number(p.stock)!==3||Number(p.reservedStock)!==0||!o.stockDeducted||!o.shippedAt||o.deliveredAt)throw new Error('Dispatch stock transition incorrect: '+JSON.stringify({stock:p.stock,reserved:p.reservedStock,stockDeducted:o.stockDeducted,shippedAt:o.shippedAt,deliveredAt:o.deliveredAt}));
  const delivered=await api.deliverOrder({orderId:o.id,method:'نقدي'});
  if(!delivered?.ok)throw new Error(delivered?.error||'Delivery confirmation failed.');
  snap=api.getSnapshot();p=snap.products.find(x=>String(x.id)===String(product.product.id));o=snap.orders.find(x=>String(x.id)===String(created.order.id));
  const payments=snap.paymentTransactions.filter(x=>String(x.orderId)===String(o.id));
  if(Number(p.stock)!==3||!o.deliveredAt||Number(o.remainingAmount)!==0||Number(o.depositAmount)!==500)throw new Error('Delivery duplicated stock deduction or failed to settle the order.');
  if(!payments.some(x=>x.type==='FINAL_PAYMENT'&&Number(x.amount)===400))throw new Error('Final payment of 400 EGP was not recorded.');
  return {productId:p.id,orderId:o.id,shippingCompany:company,tracking:o.trackingNumber,reservedStockAfterDispatch:p.reservedStock,stockAfterDispatch:p.stock,deposit:100,finalCollection:400,delivered:!!o.deliveredAt};
 });
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
 const persisted=await page.evaluate(async({productId,orderId})=>{await window.ValerianEngine.ready;const s=window.ValerianEngine.getSnapshot(),p=s.products.find(x=>String(x.id)===String(productId)),o=s.orders.find(x=>String(x.id)===String(orderId));return !!p&&Number(p.stock)===3&&Number(p.reservedStock)===0&&!!o&&!!o.deliveredAt&&Number(o.remainingAmount)===0;},{productId:result.productId,orderId:result.orderId});
 if(!persisted)throw new Error('Reservation/shipping/delivery did not survive reload.');
 if(errors.length)throw new Error('Browser runtime errors: '+errors.join(' | '));
 console.log('VALERIAN mobile reservation/shipping browser test: PASSED');console.log(JSON.stringify(result));console.log(' - Reservation deposit, reserved stock, shipping dispatch, stock deduction exactly once, final collection, delivery, and reload persistence verified.');
 await context.close();
}catch(e){console.error('VALERIAN mobile reservation/shipping browser test: FAILED');console.error(e?.stack||e);process.exitCode=1;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
