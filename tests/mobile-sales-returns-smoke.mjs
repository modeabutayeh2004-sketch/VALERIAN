import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg' };
const server = http.createServer((req,res)=>{
  try {
    const url=new URL(req.url||'/','http://127.0.0.1');
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const target=path.resolve(root,'.'+relative);
    if(!target.startsWith(root+path.sep)&&target!==path.join(root,'index.html')){res.writeHead(403).end('Forbidden');return;}
    fs.readFile(target,(error,data)=>{if(error){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
  } catch {res.writeHead(400).end('Bad request');}
});
const listen=()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
let browser;
try {
  const port=await listen();
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
  const result=await page.evaluate(async()=>{
    const api=window.ValerianEngine;
    await api.ready;
    if(window.__valerianDurableStateReady===false)throw new Error('Local durable store failed to initialize.');
    const name='VALERIAN-AUTOTEST-SALE-'+Date.now();
    const created=await api.addProduct({name,productType:'مزيلات عرق',category:'رجالي',size:'150 مل',price:250,averageCost:100,stock:5,stockUnit:'قطعة'});
    if(!created?.ok||!created.product?.id)throw new Error('Could not create isolated test stock item.');
    const phone='010'+String(Date.now()).slice(-8);
    const customer=await api.createCustomerProfile({name:'عميل اختبار VALERIAN',phone,address:'عنوان اختبار'});
    if(!customer?.ok)throw new Error('Customer profile creation failed.');
    const sale=await api.createOrder({
      mode:'direct',
      items:[{id:created.product.id,qty:2}],
      customer:{name:'عميل اختبار VALERIAN',phone,address:'عنوان اختبار'},
      shipping:0,discount:0,paymentMethod:'نقدي'
    });
    if(!sale?.ok||!sale.order?.id)throw new Error(sale?.error||'Direct sale did not complete.');
    let snapshot=api.getSnapshot();
    let product=snapshot.products.find(x=>String(x.id)===String(created.product.id));
    let order=snapshot.orders.find(x=>String(x.id)===String(sale.order.id));
    if(Number(product?.stock)!==3)throw new Error('Sale stock deduction mismatch; expected 3, got '+product?.stock);
    if(!order?.deliveredAt||!order.stockDeducted)throw new Error('Direct sale was not recorded as delivered.');
    const badSale=await api.createOrder({
      mode:'direct',items:[{id:created.product.id,qty:99}],
      customer:{name:'عميل اختبار VALERIAN',phone,address:'عنوان اختبار'},
      shipping:0,discount:0,paymentMethod:'نقدي'
    }).catch(e=>({ok:false,error:e.message}));
    snapshot=api.getSnapshot();
    product=snapshot.products.find(x=>String(x.id)===String(created.product.id));
    if(badSale?.ok||Number(product.stock)!==3)throw new Error('Invalid oversell changed stock or was accepted.');
    const returned=await api.returnOrder({orderId:sale.order.id,selections:[{productId:created.product.id,qty:1,disposition:'restock'}]});
    if(!returned?.ok)throw new Error(returned?.error||'Partial return was not accepted.');
    snapshot=api.getSnapshot();
    product=snapshot.products.find(x=>String(x.id)===String(created.product.id));
    order=snapshot.orders.find(x=>String(x.id)===String(sale.order.id));
    if(Number(product.stock)!==4)throw new Error('Return did not restore one good item to stock.');
    if(Number(order.returnedValue)!==250)throw new Error('Partial return value mismatch: '+order.returnedValue);
    const due=Number(order.refundLiability||0);
    if(due!==250)throw new Error('Expected customer refund liability 250, got '+due);
    const refund=await api.settleRefund({orderId:sale.order.id,amount:due,method:'نقدي'});
    if(!refund?.ok)throw new Error(refund?.error||'Customer refund settlement failed.');
    snapshot=api.getSnapshot();
    product=snapshot.products.find(x=>String(x.id)===String(created.product.id));
    order=snapshot.orders.find(x=>String(x.id)===String(sale.order.id));
    if(Number(order.refundedAmount)!==250)throw new Error('Refund settlement ledger amount mismatch.');
    if(Number(product.stock)!==4)throw new Error('Refund settlement unexpectedly changed stock.');
    return {
      productId:product.id,stockAfterSale:3,stockAfterReturn:product.stock,
      orderId:order.id,saleTotal:Number(order.grandTotal),returnedValue:Number(order.returnedValue),
      refundLiability:due,refundedAmount:Number(order.refundedAmount),customerPhone:phone
    };
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
  const persisted=await page.evaluate(async({productId,orderId})=>{
    await window.ValerianEngine.ready;
    const s=window.ValerianEngine.getSnapshot();
    const p=s.products.find(x=>String(x.id)===String(productId));
    const o=s.orders.find(x=>String(x.id)===String(orderId));
    return !!p&&Number(p.stock)===4&&!!o&&Number(o.refundedAmount)===250;
  },{productId:result.productId,orderId:result.orderId});
  if(!persisted)throw new Error('Sale/return/refund records did not survive page reload.');
  if(pageErrors.length)throw new Error('Browser errors: '+pageErrors.join(' | '));
  console.log('VALERIAN mobile sales/returns browser test: PASSED');
  console.log(JSON.stringify(result));
  console.log(' - Customer profile, direct sale, stock deduction, oversell protection, partial return, refund liability, refund settlement, and reload persistence verified.');
  await context.close();
} catch(error) {
  console.error('VALERIAN mobile sales/returns browser test: FAILED');
  console.error(error?.stack||error);
  process.exitCode=1;
} finally {
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
