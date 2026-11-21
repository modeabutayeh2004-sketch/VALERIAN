import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
const root=process.cwd(), out=path.join(root,'www');
const syntaxCheck=spawnSync(process.execPath,['--check',path.join(root,'engine-runtime.js')],{stdio:'inherit'});
if(syntaxCheck.status!==0)process.exit(syntaxCheck.status??1);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const inlineCheckDir=fs.mkdtempSync(path.join(os.tmpdir(),'valerian-inline-check-'));
let inlineScriptsChecked=0;
for(const [index,match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].entries()){
  const attrs=match[1]||'';
  if(/\bsrc\s*=/.test(attrs))continue;
  const typeMatch=attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
  if(typeMatch&&!/^(text\/javascript|application\/javascript|module)$/i.test(typeMatch[1]))continue;
  if(!String(match[2]||'').trim())continue;
  const inlinePath=path.join(inlineCheckDir,`inline-${index}.js`);
  fs.writeFileSync(inlinePath,match[2]);
  const inlineCheck=spawnSync(process.execPath,['--check',inlinePath],{stdio:'inherit'});
  if(inlineCheck.status!==0)process.exit(inlineCheck.status??1);
  inlineScriptsChecked++;
}
fs.rmSync(inlineCheckDir,{recursive:true,force:true});
console.log(`Validated ${inlineScriptsChecked} inline application scripts.`);
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const file of ['index.html','engine-runtime.js','service-worker.js']) fs.copyFileSync(path.join(root,file),path.join(out,file));
// The service worker pre-caches this exact path. Include the source emblem in
// the web bundle so cache.addAll() succeeds during first installation.
const vendorOut=path.join(out,'vendor');fs.mkdirSync(vendorOut,{recursive:true});
fs.copyFileSync(path.join(root,'node_modules/html2canvas/dist/html2canvas.min.js'),path.join(vendorOut,'html2canvas.min.js'));
fs.copyFileSync(path.join(root,'node_modules/qrcodejs/qrcode.min.js'),path.join(vendorOut,'qrcode.min.js'));
const assetsOut=path.join(out,'assets');fs.mkdirSync(assetsOut,{recursive:true});
fs.copyFileSync(path.join(root,'assets/valerian-icon.jpg'),path.join(assetsOut,'valerian-icon.jpg'));
const icon=fs.readFileSync(path.join(root,'assets/valerian-icon.jpg'));
for(const size of [192,512,1024]) await sharp(icon).resize(size,size,{fit:'cover'}).png().toFile(path.join(out,'icon-'+size+'.png'));
const manifest={id:'./',name:'VALERIAN — Fragrance Business Manager',short_name:'VALERIAN',description:'إدارة أعمال العطور والمخزون والمبيعات والحسابات',lang:'ar',dir:'rtl',start_url:'./',scope:'./',display:'standalone',background_color:'#02080c',theme_color:'#02080c',icons:[{src:'./icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]};
fs.writeFileSync(path.join(out,'manifest.webmanifest'),JSON.stringify(manifest,null,2));console.log('VALERIAN web bundle prepared.');