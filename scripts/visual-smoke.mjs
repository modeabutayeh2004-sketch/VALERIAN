import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve('www');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('www/index.html is missing');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const relative = pathname === '/' ? 'index.html' : (pathname.startsWith('/') ? pathname.slice(1) : pathname);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const file = target;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, {'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const errors = [];
  for (const mode of ['dark','light']) {
    const context = await browser.newContext({viewport:{width:390,height:844},screen:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
    await context.addInitScript(value => localStorage.setItem('valerian-theme-preference-v2', value), mode);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(mode + ': ' + error.message));
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== 'http://127.0.0.1:4173' && u.hostname !== 'cdn.jsdelivr.net') return route.abort();
      return route.continue();
    });
    await page.goto('http://127.0.0.1:4173/', {waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianUI, null, {timeout:45000});
    // The branded splash intentionally runs for 4.3 seconds; do not screenshot it as the app UI.
    await page.waitForFunction(() => window.__valerianSplashDismissed === true, null, {timeout:25000});
    await page.waitForTimeout(500);
    await page.screenshot({path:'www/visual-mobile-'+mode+'.png',fullPage:true,animations:'disabled'});
    if (mode === 'light') {
      const settingsButton = page.locator('[aria-label="الإعدادات"]');
      if (await settingsButton.count() !== 1) throw new Error('Primary settings button is missing');
      await settingsButton.click();
      await page.waitForFunction(() => !document.getElementById('settingsSheet')?.classList.contains('hidden'));
      if (await page.locator('#settingsSheetQrEditor').count() !== 1) throw new Error('QR platform editor is missing from the primary settings sheet');
      await page.locator('#settingsSheet').getByText('＋ إضافة منصة').click();
      const label = page.locator('#settingsSheetQrEditor [data-sheet-qr-label]').last();
      const url = page.locator('#settingsSheetQrEditor [data-sheet-qr-url]').last();
      await label.fill('Smoke Test');
      await url.fill('https://example.com/valerian-smoke');
      await page.locator('#settingsSheet').getByText('حفظ روابط QR').click();
      await page.waitForFunction(() => window.ValerianEngine?.getSnapshot?.().settings?.invoiceQrLinks?.some(x => x.label === 'Smoke Test' && x.url === 'https://example.com/valerian-smoke'));
      const saved = await page.evaluate(() => window.ValerianEngine.getSnapshot().settings.invoiceQrLinks);
      console.log(JSON.stringify({qrSettings:'ok',savedPlatforms:saved.length}));
      const invoiceCheck = await page.evaluate(async () => {
        window.__valerianOpenThermalReceiptPreview({
          id:'VAL-SMOKE-QR',date:'2026-11-20',mode:'reservation',status:'حجز مسبق',
          name:'عميل الاختبار',phone:'01000000000',address:'القاهرة',
          grandTotal:1000,depositAmount:300,remainingAmount:700,
          items:[{id:'smoke-product',name:'Perfume QR Test',size:'100 ml',qty:1,price:1000,total:1000}]
        });
        const until=Date.now()+20000;
        while(Date.now()<until&&!document.querySelector('#previewSheetBody .valerian-share-qr img')) await new Promise(r=>setTimeout(r,150));
        const qrImages=document.querySelectorAll('#previewSheetBody .valerian-share-qr img');
        if(!qrImages.length)throw new Error('Invoice preview did not render any QR image');
        const dialog=document.querySelector('#previewModalSheet .preview-document-dialog');
        const viewport=document.querySelector('#previewModalSheet .preview-document-viewport');
        const actions=[...document.querySelectorAll('#previewModalSheet .preview-document-actions button')];
        const modalMetrics=(()=>{
          const r=dialog.getBoundingClientRect(),v=viewport.getBoundingClientRect();
          return {screenWidth:innerWidth,screenHeight:innerHeight,dialogWidth:Math.round(r.width),dialogHeight:Math.round(r.height),dialogRight:Math.round(r.right),dialogBottom:Math.round(r.bottom),viewportWidth:Math.round(v.width),viewportHeight:Math.round(v.height),viewportScrollHeight:viewport.scrollHeight,actionCount:actions.length,actionsVisible:actions.every(b=>{const x=b.getBoundingClientRect();return x.width>0&&x.height>0&&x.top>=0&&x.bottom<=innerHeight;})};
        })();
        if(!dialog||!viewport||modalMetrics.dialogWidth>modalMetrics.screenWidth||modalMetrics.dialogRight>modalMetrics.screenWidth+1||modalMetrics.dialogBottom>modalMetrics.screenHeight+1||modalMetrics.actionCount!==3||!modalMetrics.actionsVisible)throw new Error('Mobile document modal layout failed: '+JSON.stringify(modalMetrics));
        const paperBefore=document.querySelector('#previewSheetBody > *');
        const paperBeforeRect=paperBefore.getBoundingClientRect();
        const paperBeforeStyle={width:getComputedStyle(paperBefore).width,height:getComputedStyle(paperBefore).height,zoom:getComputedStyle(paperBefore).zoom,overflow:getComputedStyle(paperBefore).overflow};
        const blob=await window.__valerianCreatePreviewImageBlob();
        if(!blob||blob.size<10000)throw new Error('Invoice export image is empty or unexpectedly small');
        let bitmap;
        try{bitmap=await createImageBitmap(blob);}catch(error){
          const bytes=new Uint8Array(await blob.slice(0,24).arrayBuffer());
          const pngWidth=bytes.length>=24?((bytes[16]<<24)|(bytes[17]<<16)|(bytes[18]<<8)|bytes[19]):0;
          const pngHeight=bytes.length>=24?((bytes[20]<<24)|(bytes[21]<<16)|(bytes[22]<<8)|bytes[23]):0;
          throw new Error('Export PNG decode failed: '+JSON.stringify({type:blob.type,bytes:blob.size,pngWidth,pngHeight,paperWidth:paperBeforeRect.width,paperHeight:paperBeforeRect.height,paperBeforeStyle,error:String(error)}));
        }
        const pixelCanvas=document.createElement('canvas');pixelCanvas.width=bitmap.width;pixelCanvas.height=bitmap.height;
        const pixelContext=pixelCanvas.getContext('2d',{willReadFrequently:true});pixelContext.drawImage(bitmap,0,0);
        const pixels=pixelContext.getImageData(0,0,bitmap.width,bitmap.height).data;
        let visibleSamples=0;
        for(let y=24;y<bitmap.height-24;y+=4){for(let x=24;x<bitmap.width-24;x+=4){const p=(y*bitmap.width+x)*4;const r=pixels[p],g=pixels[p+1],b=pixels[p+2];if((r<225||g<215||b<195||Math.max(r,g,b)-Math.min(r,g,b)>24)&&pixels[p+3]>0)visibleSamples++;}}
        const paper=document.querySelector('#previewSheetBody > *');
        const paperRect=paper.getBoundingClientRect();
        const expectedWidth=Math.round(paperRect.width*3),expectedHeight=Math.round(paperRect.height*3);
        const dimensionsValid=Math.abs(bitmap.width-expectedWidth)<=3&&Math.abs(bitmap.height-expectedHeight)<=3&&bitmap.width<=1170&&bitmap.width>=900&&bitmap.height<=3000&&bitmap.height>=1800;
        const visibleContentValid=visibleSamples>=1500;
        const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.readAsDataURL(blob);});
        return {qrImages:qrImages.length,mobileModal:modalMetrics,paperCssWidth:paperRect.width,paperCssHeight:paperRect.height,expectedWidth,expectedHeight,exportBytes:blob.size,width:bitmap.width,height:bitmap.height,visibleSamples,dimensionsValid,visibleContentValid,dataUrl};
      });
      fs.writeFileSync('www/visual-invoice-export.png',Buffer.from(invoiceCheck.dataUrl.split(',')[1],'base64'));
      delete invoiceCheck.dataUrl;
      await page.screenshot({path:'www/visual-mobile-invoice.png',fullPage:true,animations:'disabled'});
      console.log(JSON.stringify({invoiceExport:invoiceCheck.visibleContentValid&&invoiceCheck.dimensionsValid?'ok':'failed',...invoiceCheck}));
      if(!invoiceCheck.dimensionsValid)throw new Error('Mobile export does not preserve the original phone-sized paper dimensions: '+invoiceCheck.width+'x'+invoiceCheck.height);
      if(!invoiceCheck.visibleContentValid)throw new Error('Invoice export appears blank or missing rendered poster content; visible pixel samples: '+invoiceCheck.visibleSamples);
      const multiProductCheck=await page.evaluate(async()=>{
        const products=[
          {id:'smoke-p1',name:'Mixed Product 01 - Eau de Parfum',size:'100 ml • عطر أصلي',qty:1,price:1250,total:1250},
          {id:'smoke-p2',name:'Mixed Product 02 - Decant',size:'10 ml • تقسيم',qty:2,price:180,total:360},
          {id:'smoke-p3',name:'Mixed Product 03 - Deodorant',size:'150 ml • مزيل عرق',qty:1,price:320,total:320},
          {id:'smoke-p4',name:'Mixed Product 04 - Hair Care',size:'250 ml • عناية بالشعر',qty:1,price:275,total:275}
        ];
        window.__valerianOpenThermalReceiptPreview({
          id:'VAL-SMOKE-MULTI',date:'2026-11-21',mode:'reservation',status:'حجز مسبق',
          name:'عميل اختبار متعدد المنتجات',phone:'01000000000',address:'القاهرة',
          grandTotal:2205,depositAmount:500,remainingAmount:1705,items:products
        });
        const until=Date.now()+20000;
        while(Date.now()<until&&!document.querySelector('#previewSheetBody .valerian-share-qr img'))await new Promise(r=>setTimeout(r,150));
        const preview=document.querySelector('#previewSheetBody > .valerian-invoice-paper');
        const previewRect=preview.getBoundingClientRect();
        const previewItems=[...preview.querySelectorAll('.product-container')];
        const productScroller=preview.querySelector('.products-list');
        const previewScroll={clientHeight:productScroller?.clientHeight||0,scrollHeight:productScroller?.scrollHeight||0,overflowY:productScroller?getComputedStyle(productScroller).overflowY:'missing'};
        if(previewItems.length!==4)throw new Error('Preview did not show all four mixed products');
        const previewRows=previewItems.map(node=>{
          const r=node.getBoundingClientRect(),p=productScroller.getBoundingClientRect();
          const header=node.querySelector('.product-header')?.getBoundingClientRect(),size=node.querySelector('.product-size-line')?.getBoundingClientRect(),stats=node.querySelector('.product-stats')?.getBoundingClientRect();
          return {top:r.top-p.top,bottom:r.bottom-p.top,height:r.height,inside:r.top>=p.top-1&&r.bottom<=p.bottom+1,
            contentOrdered:!!header&&!!size&&!!stats&&header.bottom<=size.top+1&&size.bottom<=stats.top+1&&stats.bottom<=r.bottom+1,
            headerHeight:header?.height||0,sizeHeight:size?.height||0,statsHeight:stats?.height||0};
        });
        if(previewScroll.scrollHeight>previewScroll.clientHeight+2||previewRows.some(x=>!x.inside||x.height<45||!x.contentOrdered))throw new Error('Multi-product rows or their text blocks overlap or clip: '+JSON.stringify({previewScroll,previewRows}));
        const blob=await window.__valerianCreatePreviewImageBlob();
        const bitmap=await createImageBitmap(blob);
        const metrics=window.__valerianLastInvoiceExportMetrics;
        const samePageSize=Math.abs(bitmap.width-Math.round(previewRect.width*3))<=3&&Math.abs(bitmap.height-Math.round(previewRect.height*3))<=3;
        const allRowsPresent=metrics?.itemCount===4&&metrics.itemRects.every(r=>r.height>=45);
        const fullHeight=bitmap.height===Math.round(previewRect.height*3);
        const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.readAsDataURL(blob);});
        const result={previewHeight:Math.round(previewRect.height),previewWidth:Math.round(previewRect.width),previewItemCount:previewItems.length,previewScroll,previewRows,exportWidth:bitmap.width,exportHeight:bitmap.height,metrics,allRowsPresent,fullHeight,samePageSize,bytes:blob.size,dataUrl};
        bitmap.close?.();
        return result;
      });
      fs.writeFileSync('www/visual-multiproduct-invoice-export.png',Buffer.from(multiProductCheck.dataUrl.split(',')[1],'base64'));
      delete multiProductCheck.dataUrl;
      console.log(JSON.stringify({multiProductExport:multiProductCheck.allRowsPresent&&multiProductCheck.fullHeight?'ok':'failed',...multiProductCheck}));
      if(!multiProductCheck.allRowsPresent||!multiProductCheck.fullHeight||!multiProductCheck.samePageSize)throw new Error('Multi-product invoice export does not match the fixed preview page or preserve every product: '+JSON.stringify(multiProductCheck));
      const responsiveProductLayouts=await page.evaluate(async()=>{
        const results=[];
        for(const count of [1,2,4,6,8]){
          const items=Array.from({length:count},(_,i)=>({id:'responsive-'+count+'-'+i,name:'VALERIAN Long Product Name '+String(i+1).padStart(2,'0')+' Eau de Parfum',size:'100 ml • وصف الحجم والتفاصيل',qty:i+1,qtyLabel:'الكمية',unit:1250,unitLabel:'سعر الوحدة',total:(i+1)*1250,totalLabel:'الإجمالي'}));
          window.__valerianOpenThermalReceiptPreview({id:'VAL-RESPONSIVE-'+count,date:'2026-11-21',mode:'reservation',status:'حجز مسبق',name:'عميل اختبار',phone:'01000000000',address:'القاهرة',grandTotal:items.reduce((s,x)=>s+x.total,0),depositAmount:0,remainingAmount:0,items});
          const until=Date.now()+12000;
          while(Date.now()<until&&!document.querySelector('#previewSheetBody .valerian-share-qr img'))await new Promise(r=>setTimeout(r,100));
          const paper=document.querySelector('#previewSheetBody > .valerian-invoice-paper');
          const list=paper?.querySelector('.products-list');
          const cards=[...(list?.querySelectorAll('.product-container')||[])];
          const listRect=list?.getBoundingClientRect();
          const rows=cards.map(card=>{
            const cr=card.getBoundingClientRect(),head=card.querySelector('.product-header'),title=head?.querySelector('.product-title'),badge=head?.querySelector('.product-num-badge'),size=card.querySelector('.product-size-line'),stats=card.querySelector('.product-stats');
            const hr=head?.getBoundingClientRect(),tr=title?.getBoundingClientRect(),br=badge?.getBoundingClientRect(),sr=size?.getBoundingClientRect(),str=stats?.getBoundingClientRect();
            const statRows=[...(stats?.querySelectorAll('.stat-box')||[])].map(box=>{
              const boxRect=box.getBoundingClientRect(),labelNode=box.querySelector('span'),valueNode=box.querySelector('strong'),label=labelNode?.getBoundingClientRect(),value=valueNode?.getBoundingClientRect();
              return {inside:boxRect.left>=cr.left-1&&boxRect.right<=cr.right+1&&boxRect.top>=cr.top-1&&boxRect.bottom<=cr.bottom+1,
                ordered:!!label&&!!value&&label.bottom<=value.top+1,labelFont:parseFloat(getComputedStyle(labelNode).fontSize)||0,valueFont:parseFloat(getComputedStyle(valueNode).fontSize)||0,
                labelText:!!labelNode?.textContent?.trim(),valueText:!!valueNode?.textContent?.trim()};
            });
            return {inside:cr.left>=listRect.left-1&&cr.right<=listRect.right+1&&cr.top>=listRect.top-1&&cr.bottom<=listRect.bottom+1,
              titleBadgeSeparate:!!tr&&!!br&&(tr.right<=br.left+1||br.right<=tr.left+1),
              verticalOrder:!!hr&&!!sr&&!!str&&hr.bottom<=sr.top+1&&sr.bottom<=str.top+1&&str.bottom<=cr.bottom+1,
              statRows};
          });
          const cols=getComputedStyle(list).gridTemplateColumns.split(' ').length;
          results.push({count,columns:cols,areaHeight:listRect.height,cardCount:cards.length,rows});
          if(cards.length!==count||rows.some(x=>!x.inside||!x.titleBadgeSeparate||!x.verticalOrder||x.statRows.length!==3||x.statRows.some(s=>!s.inside||!s.ordered||s.labelFont<7||s.valueFont<7||!s.labelText||!s.valueText)))throw new Error('Responsive product fields overlap or escape their fixed cells: '+JSON.stringify(results.at(-1)));
        }
        const heights=results.map(x=>x.areaHeight);
        if(Math.max(...heights)-Math.min(...heights)>2)throw new Error('Reserved/sold product area changed height as item count changed: '+JSON.stringify(results));
        return results;
      });
      console.log(JSON.stringify({responsiveProductLayouts:'ok',layouts:responsiveProductLayouts}));

      const documentVariants=await page.evaluate(async()=>{
        const verify=async(kind)=>{
          const node=document.querySelector('#previewSheetBody > .valerian-invoice-paper');
          if(!node)throw new Error(kind+' preview did not render the original mobile paper');
          const blob=await window.__valerianCreatePreviewImageBlob();
          if(!blob||blob.type!=='image/png'||blob.size<10000)throw new Error(kind+' PNG export is empty');
          const bitmap=await createImageBitmap(blob);
          const result={kind,width:bitmap.width,height:bitmap.height,bytes:blob.size};
          bitmap.close?.();
          return result;
        };
        appState.imports.push({id:'SMOKE-IMPORT',supplier:'مورد اختبار',date:'2026-11-20',totalEgp:1200,paidAmount:300,exchangeRate:50,shippingCost:100,customsCost:50,items:[{productName:'Smoke Import Perfume',qty:2,unitForeign:12,landedCost:1200}]});
        window.openValerianSupplierInvoicePreview('SMOKE-IMPORT');
        const imported=await verify('supplier-import');
        appState.purchases.push({id:'SMOKE-PURCHASE',supplier:'مورد محلي للاختبار',date:'2026-11-20',productName:'Smoke Local Purchase',qty:2,unitCost:300,totalCost:600,paidAmount:200});
        window.openValerianSupplierInvoicePreview('SMOKE-PURCHASE');
        const purchased=await verify('local-purchase');
        appState.orders.push({id:'SMOKE-WAYBILL',date:'2026-11-20',shippedAt:'2026-11-20',name:'عميل اختبار',phone:'01000000000',address:'القاهرة',shippingCompany:'شركة اختبار',trackingNumber:'TRACK-TEST-01',remainingAmount:700,grandTotal:1000,depositAmount:300,items:[{id:'smoke-product',name:'Smoke Shipping Perfume',size:'100 ml',qty:1,price:1000,total:1000}]});
        window.printMobileWaybill('SMOKE-WAYBILL');
        const waybill=await verify('waybill');
        return [imported,purchased,waybill];
      });
      for(const item of documentVariants){if(item.width<900||item.width>1170||item.height<1800||item.height>3000)throw new Error('Mobile '+item.kind+' export dimensions are invalid: '+JSON.stringify(item));}
      console.log(JSON.stringify({documentVariantExports:'ok',variants:documentVariants}));
      await page.evaluate(() => {
        const state = {chunks:[],completed:false,fileName:'',mimeType:'',base64Length:0};
        window.__valerianNativeSaveSmoke = state;
        window.ValerianNative = {
          saveImage(){throw new Error('Legacy single-call save must not be used by the chunked smoke test');},
          beginImageSave(fileName,mimeType){state.fileName=fileName;state.mimeType=mimeType;return 'smoke-save-session';},
          appendImageSaveChunk(saveId,chunk){if(saveId!=='smoke-save-session'||chunk.length>131072)return false;state.chunks.push(chunk);return true;},
          finishImageSave(saveId,callbackId){state.base64Length=state.chunks.reduce((n,x)=>n+x.length,0);setTimeout(()=>{state.completed=true;window.__valerianNativeSaveComplete(callbackId,true,'');},0);},
          cancelImageSave(){}
        };
      });
      await page.locator('#previewModalSheet').getByText('تنزيل الصورة').click();
      await page.waitForFunction(() => window.__valerianNativeSaveSmoke?.completed === true, null, {timeout:45000});
      const nativeSaveCheck = await page.evaluate(() => ({
        chunks:window.__valerianNativeSaveSmoke.chunks.length,
        maxChunk:Math.max(...window.__valerianNativeSaveSmoke.chunks.map(x=>x.length)),
        base64Length:window.__valerianNativeSaveSmoke.base64Length,
        mimeType:window.__valerianNativeSaveSmoke.mimeType
      }));
      if(nativeSaveCheck.chunks<2||nativeSaveCheck.maxChunk>131072||nativeSaveCheck.base64Length<10000||nativeSaveCheck.mimeType!=='image/png')throw new Error('Chunked Android image-save bridge smoke test failed: '+JSON.stringify(nativeSaveCheck));
      console.log(JSON.stringify({nativeChunkedSave:'ok',...nativeSaveCheck}));
    }
    const status = await page.evaluate(() => ({
      title:document.title,
      engine:!!window.ValerianEngine,
      ui:!!window.ValerianUI,
      theme:document.documentElement.getAttribute('data-valerian-theme'),
      bodyHeight:document.body.scrollHeight,
      width:document.documentElement.scrollWidth
    }));
    console.log(JSON.stringify({mode,...status}));
    await context.close();
  }
  if (errors.length) throw new Error('Browser page errors: ' + errors.join(' | '));
  console.log('VISUAL_SMOKE_OK');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
