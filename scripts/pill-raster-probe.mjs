import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const server = http.createServer((req,res)=>{ let pathname; try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;} const target=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1)); if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;} res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'}); fs.createReadStream(target).pipe(res); });
await new Promise(r=>server.listen(4183,'127.0.0.1',r));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const context = await browser.newContext({viewport:{width:800,height:400},deviceScaleFactor:2});
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4183/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__valerianSplashDismissed===true,null,{timeout:25000});
  const dataUrl = await page.evaluate(async ()=>{
    appState.products.push({id:'probe1',name:'تست',price:100,offerPrice:50,isOffer:true,stock:5});
    await window.openOffersPosterPreview();
    await new Promise(r=>setTimeout(r,400));
    const real=document.querySelector('#previewSheetBody .valerian-share-headline');
    const a=real.cloneNode(true);
    const b=real.cloneNode(true); b.style.setProperty('letter-spacing','normal','important');
    const cc=real.cloneNode(true); cc.style.setProperty('letter-spacing','normal','important'); cc.style.setProperty('font-family','Arial, sans-serif','important');
    function resolveCaptureCss(cssText) {
      let resolved = '', rest = cssText;
      const mediaStart = /@media\s*\(\s*(max|min)-(width|height)\s*:\s*([\d.]+)px\s*\)\s*\{/;
      let m;
      while ((m = mediaStart.exec(rest))) {
        resolved += rest.slice(0, m.index);
        let depth = 1, j = m.index + m[0].length;
        while (j < rest.length && depth) { if (rest[j] === '{') depth++; else if (rest[j] === '}') depth--; j++; }
        const body = rest.slice(m.index + m[0].length, j - 1);
        const size = m[2] === 'width' ? window.innerWidth : window.innerHeight;
        const matches = m[1] === 'max' ? size <= Number(m[3]) : size >= Number(m[3]);
        if (matches) resolved += body;
        rest = rest.slice(j);
      }
      resolved += rest;
      resolved = resolved.replace(/@import[^;]+;/g, '');
      resolved = resolved.replace(/(-?[\d.]+)d?vh\b/g, (_, n) => (Number(n) * window.innerHeight / 100).toFixed(2) + 'px');
      resolved = resolved.replace(/(-?[\d.]+)d?vw\b/g, (_, n) => (Number(n) * window.innerWidth / 100).toFixed(2) + 'px');
      return resolved;
    }
    const styleText=resolveCaptureCss([...document.querySelectorAll('style')].map(t=>t.textContent||'').join('\n'));
    const wrap='<div id="previewSheetBody" style="margin:0;padding:0;width:900px;direction:rtl;background:#fffdf8"><article class="valerian-share-card" dir="rtl"><header class="valerian-share-head">'+a.outerHTML+b.outerHTML+cc.outerHTML+'</header></article></div>';
    
    const width=940, height=260;
    const scale=2.75;
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+Math.round(width*scale)+'" height="'+Math.round(height*scale)+'" viewBox="0 0 '+width+' '+height+'"><foreignObject x="0" y="0" width="'+width+'" height="'+height+'"><style><![CDATA['+styleText.replace(/]]>/g,']]>')+']]></style><div xmlns="http://www.w3.org/1999/xhtml">'+wrap+'</div></foreignObject></svg>';
    const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    const img=new Image();
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url;});
    const c=document.createElement('canvas');c.width=Math.round(width*2.75);c.height=Math.round(height*2.75);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync('www/check-pill-variants.png', Buffer.from(dataUrl.split(',')[1],'base64'));
  console.log('saved');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
