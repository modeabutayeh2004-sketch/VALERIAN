import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=process.cwd(), out=path.join(root,'www');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const file of ['index.html','engine.html','service-worker.js','preview-obsidian-champagne.html','preview-aubergine-brass.html']) fs.copyFileSync(path.join(root,file),path.join(out,file));
// The service worker pre-caches this exact path. Include the source emblem in
// the web bundle so cache.addAll() succeeds during first installation.
const assetsOut=path.join(out,'assets');fs.mkdirSync(assetsOut,{recursive:true});
fs.copyFileSync(path.join(root,'assets/valerian-icon.jpg'),path.join(assetsOut,'valerian-icon.jpg'));
const icon=fs.readFileSync(path.join(root,'assets/valerian-icon.jpg'));
for(const size of [192,512,1024]) await sharp(icon).resize(size,size,{fit:'cover'}).png().toFile(path.join(out,'icon-'+size+'.png'));
const manifest={id:'./',name:'VALERIAN — Fragrance Business Manager',short_name:'VALERIAN',description:'إدارة أعمال العطور والمخزون والمبيعات والحسابات',lang:'ar',dir:'rtl',start_url:'./',scope:'./',display:'standalone',background_color:'#02080c',theme_color:'#02080c',icons:[{src:'./icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]};
fs.writeFileSync(path.join(out,'manifest.webmanifest'),JSON.stringify(manifest,null,2));console.log('VALERIAN web bundle prepared.');