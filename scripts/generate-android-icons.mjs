import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=process.cwd(), res=path.join(root,'android/app/src/main/res'), svg=fs.readFileSync(path.join(root,'assets/valerian-icon.svg'));
const sizes={mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192};
for(const [density,size] of Object.entries(sizes)){const dir=path.join(res,'mipmap-'+density);fs.mkdirSync(dir,{recursive:true});await sharp(svg).resize(size,size).png().toFile(path.join(dir,'ic_launcher.png'));await sharp(svg).resize(size,size).png().toFile(path.join(dir,'ic_launcher_round.png'));}
const adaptive=path.join(res,'mipmap-anydpi-v26');fs.mkdirSync(adaptive,{recursive:true});
const xml='<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>';
fs.writeFileSync(path.join(adaptive,'ic_launcher.xml'),xml);fs.writeFileSync(path.join(adaptive,'ic_launcher_round.xml'),xml);
const fg='<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g fill="#e8edf0" stroke="#9aaab4" stroke-width="3" stroke-linejoin="miter"><path d="M160 255 L460 535 L512 590 L565 535 L864 255 L760 278 L512 500 L265 278Z"/><path d="M160 255 C310 260 385 295 470 390 L512 500 L460 535 L350 390Z"/><path d="M864 255 C714 260 639 295 554 390 L512 500 L565 535 L674 390Z"/><path d="M265 278 L460 535 L512 590 L460 650 L160 255Z"/><path d="M760 278 L565 535 L512 590 L565 650 L864 255Z"/><path d="M512 650 L555 710 L512 770 L469 710Z"/></g></svg>';
for(const [density,size] of Object.entries(sizes)){const dir=path.join(res,'mipmap-'+density);await sharp(Buffer.from(fg)).resize(size,size).png().toFile(path.join(dir,'ic_launcher_foreground.png'));}
const values=path.join(res,'values');fs.mkdirSync(values,{recursive:true});fs.writeFileSync(path.join(values,'launcher_background.xml'),'<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="launcher_background">#02080c</color></resources>');console.log('Android launcher icons generated.');