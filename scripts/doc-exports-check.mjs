import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('www');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'};
const server = http.createServer((req,res) => {
  let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(4177, '127.0.0.1', resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures = [];
try {
  const context = await browser.newContext({viewport:{width:393,height:873},deviceScaleFactor:2.75,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.on('pageerror', e => failures.push('pageerror: '+e.message));
  await page.goto('http://127.0.0.1:4177/', {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
  await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});

  async function exportCurrentPreview(tag) {
    const result = await page.evaluate(async () => {
      const until=Date.now()+20000;
      while(Date.now()<until && !document.querySelector('#previewSheetBody > *')) await new Promise(r=>setTimeout(r,150));
      await new Promise(r=>setTimeout(r,400));
      const t0 = performance.now();
      const blob = await window.__valerianCreatePreviewImageBlob();
      const ms = Math.round(performance.now()-t0);
      const bitmap = await createImageBitmap(blob);
      const dataUrl = await new Promise(res=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.readAsDataURL(blob);});
      return {ms,bytes:blob.size,imgW:bitmap.width,imgH:bitmap.height,dataUrl};
    });
    fs.writeFileSync('www/check-'+tag+'.png', Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    delete result.dataUrl;
    console.log(tag, JSON.stringify(result));
    if (result.ms > 20000) failures.push(tag+': capture too slow: '+result.ms+'ms');
    return result;
  }

  // ---- Seed fixtures via the real engine ----
  // A real product photo can be supplied for fidelity checks without committing it:
  // FIXTURE_PHOTO=/absolute/path.jpg node scripts/doc-exports-check.mjs
  const photoPath = process.env.FIXTURE_PHOTO ? path.resolve(process.env.FIXTURE_PHOTO) : path.resolve('scripts/fixtures/product-photo.jpg');
  const photoDataUrl='data:image/jpeg;base64,'+fs.readFileSync(photoPath).toString('base64');
  const seed = await page.evaluate(async (photo) => {
    const engine = window.ValerianEngine, stamp = Date.now();
    const p1 = await engine.addProduct({name:'Old Spice (Epic Legend)',category:'عطور',productType:'عطر',size:'100 مل',stockUnit:'قطعة',price:3438,offerPrice:1710,isOffer:true,averageCost:2000,stock:20,minimumStock:1,image:photo});
    const p2 = await engine.addProduct({name:'Prestige Black تقسيم',category:'عطور',productType:'عطر',size:'50 مل',stockUnit:'قطعة',price:500,offerPrice:400,isOffer:true,averageCost:250,stock:15,minimumStock:1});
    if(!p1?.ok || !p2?.ok) throw new Error('seed products');
    await engine.addShippingCompany('شركة شحن تجريبية');
    const customer = {name:'عميل تجريبي',phone:'01000000001',address:'البلد'};
    const created = await engine.createOrder({mode:'reservation',items:[{id:p1.product.id,qty:1},{id:p2.product.id,qty:1}],customer,deposit:1916,shippingCompany:'شركة شحن تجريبية'});
    if(!created?.ok) throw new Error('seed order: '+JSON.stringify(created));
    const dispatched = await engine.dispatchOrder({orderId:created.order.id,tracking:'TRK-'+stamp});
    return {orderId:String(created.order.id), dispatch:!!dispatched?.ok, p1:String(p1.product.id), p2:String(p2.product.id)};
  }, photoDataUrl);
  console.log('seed', JSON.stringify(seed));

  // ---- 1) WAYBILL: his exact case ----
  const waybill = await page.evaluate(async (orderId) => {
    window.printMobileWaybill(orderId);
    await new Promise(r=>setTimeout(r,800));
    const body=document.getElementById('previewSheetBody');
    window.__dbgWaybill={title:document.getElementById('previewSheetTitle').textContent, kids:body.children.length, firstClass:body.firstElementChild?body.firstElementChild.className:'none', html:(()=>{const h=body.innerHTML;const i=h.indexOf('حالة الصنف');return i<0?h.slice(0,400):h.slice(Math.max(0,i-500),i+300);})()};
    const boxes = [...document.querySelectorAll('#previewSheetBody .product-container')].map(article => {
      const ar = article.getBoundingClientRect();
      const stats = article.querySelector('.product-stats');
      const sr = stats ? stats.getBoundingClientRect() : null;
      const cells = [...(stats?stats.querySelectorAll('.stat-box'):[])].map(div => {
        const dr = div.getBoundingClientRect();
        const strong = div.querySelector('strong');
        const gr = strong ? strong.getBoundingClientRect() : null;
        return {divBottom:dr.bottom, strongBottom:gr?gr.bottom:null, strongText:strong?strong.textContent:'', scrollH:div.scrollHeight, clientH:div.clientHeight};
      });
      return {articleBottom:ar.bottom, statsBottom:sr?sr.bottom:null, cells};
    });
    return {boxes, dbg:window.__dbgWaybill};
  }, seed.orderId);
  console.log('waybill-dom', JSON.stringify(waybill));
  for (const b of waybill.boxes) {
    if (!(b.statsBottom <= b.articleBottom + 0.5)) failures.push('waybill: stats spill below product card');
    for (const c of b.cells) {
      if (c.strongBottom !== null && !(c.strongBottom <= c.divBottom + 0.5)) failures.push('waybill: stat value clipped ("'+c.strongText+'" bottom '+c.strongBottom+' > box '+c.divBottom+')');
    }
  }
  await exportCurrentPreview('waybill');

  // ---- 2) POSTER: two offers ----
  const poster = await page.evaluate(async () => {
    for (const prod of appState.products) { prod.isOffer=true; if(!prod.offerPrice) prod.offerPrice=Math.round((Number(prod.price)||0)/2); }
    await window.openOffersPosterPreview();
    await new Promise(r=>setTimeout(r,500));
    window.__dbgPoster={offers:appState.products.filter(p=>p.isOffer).length, toast:document.getElementById('mobileToast')?document.getElementById('mobileToast').textContent:'', title:document.getElementById('previewSheetTitle').textContent};
    const oldPrice = document.querySelector('.valerian-share-old-price');
    const logo = document.querySelector('#previewSheetBody .valerian-share-logo');
    const lr = logo ? logo.getBoundingClientRect() : null;
    const pimg = document.querySelector('#previewSheetBody img.valerian-share-product-image');
    return {dbg:window.__dbgPoster, hasOldPrice: !!oldPrice, oldPriceText: oldPrice?oldPrice.textContent:null, logoBox: lr?{top:lr.top,left:lr.left,width:lr.width,height:lr.height}:null, hasPhotoElement: !!pimg};
  });
  console.log('poster-dom', JSON.stringify(poster));
  if (!poster.hasOldPrice) failures.push('poster: old price element missing');
  const posterRes = await exportCurrentPreview('poster');
  // Sample the header band of the export: the emblem sits there; gold means r>g>b clearly.
  const logoCheck = await page.evaluate(async () => {
    const img = new Image();
    img.src = 'check-poster.png';
    await img.decode();
    const c = document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const ctx = c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0);
    let gold=0, silver=0;
    const bandH = Math.floor(img.naturalHeight*0.16);
    for (let y=0; y<bandH; y+=3) for (let x=0; x<img.naturalWidth; x+=3) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      const mx=Math.max(d[0],d[1],d[2]), mn=Math.min(d[0],d[1],d[2]);
      if (mx > 235 && mx-mn < 15) continue; // near-white background
      if (d[0] > d[2] + 22 && d[0] >= d[1]) gold++; else if (mx-mn <= 22) silver++;
    }
    return {gold, silver};
  });
  console.log('poster-logo-pixels', JSON.stringify(logoCheck));
  if (!(logoCheck.gold > logoCheck.silver)) failures.push('poster: exported logo is not gold (gold='+logoCheck.gold+' silver='+logoCheck.silver+')');
  // Real-photo path: the seeded JPEG must actually rasterize into the export.
  // The fixture photo has a unique dark-brown ring (brown = r>g>b, unlike black text
  // where r~g~b). Locate its pixel cluster in the export and verify size + variance.
  if (!poster.hasPhotoElement) failures.push('poster: product photo element missing from the preview');
  const photoCheck = await page.evaluate(async () => {
    const img = new Image(); img.src='check-poster.png'; await img.decode();
    const c = document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const ctx = c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0);
    const W=img.naturalWidth, H=img.naturalHeight;
    const data = ctx.getImageData(0,0,W,H).data;
    const mask = new Uint8Array(W*H);
    for (let i=0; i<W*H; i++) {
      const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
      if (r+g+b<400 && r-g>25 && g-b>15) mask[i]=1;
    }
    // Erode: keep only pixels whose 3x3 neighborhood is all mask. Thin text strokes
    // and borders vanish; solid regions (the photo) survive.
    const solid = new Uint8Array(W*H);
    for (let y=1; y<H-1; y++) for (let x=1; x<W-1; x++) {
      const i=y*W+x;
      if (mask[i]&&mask[i-1]&&mask[i+1]&&mask[i-W]&&mask[i+W]&&mask[i-W-1]&&mask[i-W+1]&&mask[i+W-1]&&mask[i+W+1]) solid[i]=1;
    }
    // Largest connected component: the product photo is the biggest solid blob and
    // the only roughly-square one; pills and dividers are wide and thin.
    let best=null;
    const seen = new Uint8Array(W*H);
    const stack = [];
    for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
      const i0=y*W+x;
      if (!solid[i0]||seen[i0]) continue;
      let count=0, minX=1e9, minY=1e9, maxX=-1, maxY=-1;
      stack.length=0; stack.push(i0); seen[i0]=1;
      while (stack.length) {
        const i=stack.pop(), cy=(i/W)|0, cx=i%W;
        count++; if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
        if(cx>0&&solid[i-1]&&!seen[i-1]){seen[i-1]=1;stack.push(i-1);}
        if(cx<W-1&&solid[i+1]&&!seen[i+1]){seen[i+1]=1;stack.push(i+1);}
        if(cy>0&&solid[i-W]&&!seen[i-W]){seen[i-W]=1;stack.push(i-W);}
        if(cy<H-1&&solid[i+W]&&!seen[i+W]){seen[i+W]=1;stack.push(i+W);}
      }
      if (!best || count>best.count) best={count, box:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}};
    }
    if (!best) return {count:0};
    const {box}=best;
    let n=0, s=0, s2=0;
    for (let y=box.y; y<box.y+box.h; y+=2) for (let x=box.x; x<box.x+box.w; x+=2) {
      const i=(y*W+x)*4;
      const lum=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
      n++; s+=lum; s2+=lum*lum;
    }
    const mean=s/n;
    return {count:best.count, box, std:+Math.sqrt(Math.max(0,s2/n-mean*mean)).toFixed(1)};
  });
  // Strike calibration: the old-price line must cross the digit band middle in the
  // ACTUAL export (the rasterizer cannot be trusted to place text-decoration).
  const strikeCheck = await page.evaluate(async () => {
    const img = new Image(); img.src='check-poster.png'; await img.decode();
    const c = document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const ctx = c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0);
    const data = ctx.getImageData(0,0,c.width,c.height).data;
    const isInk = (x,y,tol) => {
      const i=(y*c.width+x)*4;
      return Math.abs(data[i]-154)<tol && Math.abs(data[i+1]-139)<tol && Math.abs(data[i+2]-115)<tol;
    };
    const strikes=[];
    for (let y=0; y<c.height; y++) {
      let run=0,best=0;
      for (let x=30; x<Math.min(340,c.width); x++) {
        if (isInk(x,y,60)) { run++; if(run>best)best=run; } else run=0;
      }
      if (best>=45) strikes.push(y);
    }
    return strikes.map(sy => {
      let minY=null,maxY=null;
      for (let y=Math.max(0,sy-15); y<=Math.min(c.height-1,sy+15); y++) {
        let ink=0;
        for (let x=50; x<Math.min(200,c.width); x++) if (isInk(x,y,60)) ink++;
        if (ink>=2) { if(minY==null)minY=y; maxY=y; }
      }
      return minY==null ? {strikeY:sy, error:'no digit band'} : {strikeY:sy, bandMiddle:(minY+maxY)/2, offset:+(sy-(minY+maxY)/2).toFixed(1)};
    });
  });
  console.log('poster-strike-calibration', JSON.stringify(strikeCheck));
  if (strikeCheck.length < 2) failures.push('poster: expected 2 old-price strikes in export, found '+strikeCheck.length);
  strikeCheck.forEach((s,i) => {
    if (s.error || Math.abs(s.offset) > 3) failures.push('poster: strike '+(i+1)+' misses the digit middle: '+JSON.stringify(s));
  });
  console.log('poster-photo-pixels', JSON.stringify(photoCheck));
  if (photoCheck.count < 3000) failures.push('poster: seeded product photo did not rasterize into the export: '+JSON.stringify(photoCheck));
  else {
    const {w,h} = photoCheck.box;
    const ratio = w/h;
    if (w<40 || w>200 || h<40 || h>200 || ratio<0.75 || ratio>1.33) failures.push('poster: largest solid region is not the square photo thumbnail: '+JSON.stringify(photoCheck));
    if (photoCheck.std < 15) failures.push('poster: photo area has no photographic variance (flat/blank): '+JSON.stringify(photoCheck));
  }

  // ---- 3) LOYALTY CARD ----
  await page.evaluate(async () => {
    const lc=appState.customers.find(x=>x.phone==='01000000001');
    if (lc) { lc.points=2660; lc.totalSpent=6386; lc.ordersCount=2; } else appState.customers.push({name:'عميل تجريبي',phone:'01000000000',address:'البلد',points:2660,totalSpent:6386,ordersCount:2});
    window.openDigitalLoyaltyCard('01000000001');
    await new Promise(r=>setTimeout(r,400));
  });
  const loyaltyRes = await exportCurrentPreview('loyalty');

  // ---- 4) CUSTOMER PROFILE card ----
  await page.evaluate(async () => {
    window.printMobileCustomerProfile('01000000001');
    await new Promise(r=>setTimeout(r,400));
  });
  await exportCurrentPreview('profile');

  await page.screenshot({path:'www/check-doc-exports-screen.png',fullPage:false});
  if (failures.length) { console.error('DOC_EXPORTS_FAILED: ' + failures.join(' | ')); process.exitCode = 1; }
  else console.log('DOC_EXPORTS_OK');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
