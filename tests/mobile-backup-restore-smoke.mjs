import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd(),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{try{const u=new URL(req.url||'/','http://127.0.0.1'),rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname),target=path.resolve(root,'.'+rel);if(!target.startsWith(root+path.sep)&&target!==path.join(root,'index.html')){res.writeHead(403).end();return;}fs.readFile(target,(e,d)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(d);});}catch{res.writeHead(400).end();}});
const listen=()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
let browser;
try{
 const port=await listen();browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
 const result=await page.evaluate(async()=>{
  const api=window.ValerianEngine;await api.ready;
  const first=await api.addProduct({name:'VALERIAN-BACKUP-KEEP-'+Date.now(),productType:'مزيلات عرق',category:'رجالي',size:'150 مل',price:250,averageCost:100,stock:3,stockUnit:'قطعة'});
  if(!first?.ok)throw new Error('Could not create backup fixture product.');
  const backup=api.exportSnapshot();
  const second=await api.addProduct({name:'VALERIAN-BACKUP-REMOVE-'+Date.now(),productType:'مزيلات عرق',category:'رجالي',size:'150 مل',price:300,averageCost:120,stock:2,stockUnit:'قطعة'});
  if(!second?.ok)throw new Error('Could not create post-backup fixture product.');
  return {backup,keepId:first.product.id,removeId:second.product.id};
 });
 const downloadPromise=page.waitForEvent('download',{timeout:15000});
 const restored=await page.evaluate(async backup=>await window.ValerianEngine.restoreSnapshot(backup),result.backup);
 const download=await downloadPromise;
 if(!restored?.ok)throw new Error(restored?.error||'Backup restore was not accepted.');
 const state=await page.evaluate(async({keepId,removeId})=>{await window.ValerianEngine.ready;const s=window.ValerianEngine.getSnapshot();return {keep:!!s.products.find(x=>String(x.id)===String(keepId)),remove:!!s.products.find(x=>String(x.id)===String(removeId)),products:s.products.length};},{keepId:result.keepId,removeId:result.removeId});
 if(!state.keep||state.remove)throw new Error('Backup restore did not replace current business data correctly: '+JSON.stringify(state));
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.ValerianEngine&&!!window.ValerianEngine.ready,null,{timeout:60000});
 const persisted=await page.evaluate(async({keepId,removeId})=>{await window.ValerianEngine.ready;const s=window.ValerianEngine.getSnapshot();return !!s.products.find(x=>String(x.id)===String(keepId))&&!s.products.find(x=>String(x.id)===String(removeId));},{keepId:result.keepId,removeId:result.removeId});
 if(!persisted)throw new Error('Restored backup did not survive reload.');
 if(errors.length)throw new Error('Browser runtime errors: '+errors.join(' | '));
 console.log('VALERIAN mobile backup/restore browser test: PASSED');
 console.log(JSON.stringify({productsRestored:state.products,backupDownload:download.suggestedFilename(),keepId:result.keepId,removedPostBackupProduct:true}));
 console.log(' - Export snapshot, pre-restore safety download, validated restore, replacement of post-backup changes, and reload persistence verified.');
 await context.close();
}catch(e){console.error('VALERIAN mobile backup/restore browser test: FAILED');console.error(e?.stack||e);process.exitCode=1;}
finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
