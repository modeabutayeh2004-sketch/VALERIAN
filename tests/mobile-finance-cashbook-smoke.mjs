import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd(),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{try{const u=new URL(req.url||'/','http://127.0.0.1'),rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname),target=path.resolve(root,'.'+rel);if(!target.startsWith(root+path.sep)&&target!==path.join(root,'index.html')){res.writeHead(403).end();return;}fs.readFile(target,(e,d)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(d);});}catch{res.writeHead(400).end();}});
const listen=()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
let browser;
try{
 const port=await listen();browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
 const result=await page.evaluate(async()=>{
  const api=window.ValerianEngine;await api.ready;const date=new Date().toISOString().slice(0,10);
  const opening=await api.setCashOpeningBalance({method:'نقدي',amount:1000,date,note:'رصيد افتتاحي اختبار آلي'});
  if(!opening?.ok)throw new Error('Cash opening balance failed.');
  const expense=await api.createExpense({category:'إعلانات ممولة (Meta/TikTok)',note:'VALERIAN automated finance test',amount:200,method:'نقدي'});
  if(!expense?.ok)throw new Error('Expense entry failed.');
  const adjustment=await api.createCashbookAdjustment({direction:'IN',amount:100,method:'نقدي',date,note:'إيداع اختبار آلي'});
  if(!adjustment?.ok)throw new Error('Cashbook deposit adjustment failed.');
  const transfer=await api.createCashbookTransfer({fromMethod:'نقدي',toMethod:'تحويل بنكي',amount:300,date,note:'تحويل اختبار آلي'});
  if(!transfer?.ok)throw new Error('Cashbook transfer failed.');
  const finance=await api.getFinanceSnapshot();
  const cash=finance.balances.find(x=>x.method==='نقدي'),bank=finance.balances.find(x=>x.method==='تحويل بنكي');
  if(Number(cash?.balance)!==600||Number(bank?.balance)!==300)throw new Error('Cash balances mismatch: '+JSON.stringify({cash,bank}));
  if(finance.expenses.length!==1||Number(finance.expenses[0].amount)!==200)throw new Error('Expense record missing from finance ledger.');
  if(finance.cashbookRows.length!==4)throw new Error('Expected opening, expense, deposit and two-sided transfer rows; got '+finance.cashbookRows.length);
  return {expenseId:expense.expense.id,openingAmount:1000,expenseAmount:200,deposit:100,transfer:300,cashBalance:cash.balance,bankBalance:bank.balance,cashbookRows:finance.cashbookRows.length};
 });
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
 const persisted=await page.evaluate(async({expenseId})=>{await window.ValerianEngine.ready;const f=await window.ValerianEngine.getFinanceSnapshot();const expense=f.expenses.find(x=>String(x.id)===String(expenseId)),cash=f.balances.find(x=>x.method==='نقدي'),bank=f.balances.find(x=>x.method==='تحويل بنكي');return !!expense&&Number(expense.amount)===200&&Number(cash.balance)===600&&Number(bank.balance)===300&&f.cashbookRows.length===4;},{expenseId:result.expenseId});
 if(!persisted)throw new Error('Expense/cashbook records did not survive reload.');
 if(errors.length)throw new Error('Browser runtime errors: '+errors.join(' | '));
 console.log('VALERIAN mobile finance/cashbook browser test: PASSED');console.log(JSON.stringify(result));console.log(' - Expense entry, opening balance, cash deposit, inter-account transfer, balance calculations, and reload persistence verified.');
 await context.close();
}catch(e){console.error('VALERIAN mobile finance/cashbook browser test: FAILED');console.error(e?.stack||e);process.exitCode=1;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
