import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root=process.cwd();
const res=path.join(root,'android/app/src/main/res');
const icon=fs.readFileSync(path.join(root,'assets/valerian-icon.jpg'));
const sizes={mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192};

for(const [density,size] of Object.entries(sizes)){
  const dir=path.join(res,'mipmap-'+density);
  fs.mkdirSync(dir,{recursive:true});
  const rendered=sharp(icon).resize(size,size,{fit:'cover',position:'centre'}).png();
  await rendered.clone().toFile(path.join(dir,'ic_launcher.png'));
  await rendered.clone().toFile(path.join(dir,'ic_launcher_round.png'));
}
const anydpi=path.join(res,'mipmap-anydpi-v26');
for (const name of ['ic_launcher.xml','ic_launcher_round.xml','ic_launcher_monochrome.xml']) { const target=path.join(anydpi,name); if (fs.existsSync(target)) fs.rmSync(target,{force:true}); }
console.log('User-supplied silver VALERIAN emblem generated for all Android launcher densities.');