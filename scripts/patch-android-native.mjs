import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const packageDir=path.join(root,'android/app/src/main/java/com/valerian/business');
fs.mkdirSync(packageDir,{recursive:true});
fs.copyFileSync(path.join(root,'android-native/NativeFileBridge.java'),path.join(packageDir,'NativeFileBridge.java'));
const mainPath=path.join(packageDir,'MainActivity.java');
if(!fs.existsSync(mainPath)) throw new Error('Capacitor MainActivity.java was not generated.');
let source=fs.readFileSync(mainPath,'utf8');
if(!source.includes('ValerianNative')){
  const marker='public class MainActivity extends BridgeActivity';
  const start=source.indexOf(marker), open=source.indexOf('{',start), close=source.indexOf('}',open);
  if(start<0||open<0||close<0) throw new Error('Could not safely locate MainActivity class body.');
  source=source.slice(0,open+1)+'\n  @Override public void onCreate(android.os.Bundle savedInstanceState) {\n    super.onCreate(savedInstanceState);\n    getBridge().getWebView().addJavascriptInterface(new NativeFileBridge(this), "ValerianNative");\n  }\n'+source.slice(close);
  fs.writeFileSync(mainPath,source);
}

// Android 12+ normally paints the launcher icon on the system splash screen.
// Keep the native hand-off visually blank so the full VALERIAN web intro is the only branded intro.
const resDir=path.join(root,'android/app/src/main/res');
const drawableDir=path.join(resDir,'drawable');
fs.mkdirSync(drawableDir,{recursive:true});
fs.writeFileSync(path.join(drawableDir,'valerian_transparent_splash.xml'),`<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="1dp" android:height="1dp"
    android:viewportWidth="1" android:viewportHeight="1">
    <path android:fillColor="#00000000" android:pathData="M0,0h1v1h-1z"/>
</vector>
`);
const stylesPath=path.join(resDir,'values/styles.xml');
if(!fs.existsSync(stylesPath)) throw new Error('Android styles.xml was not generated; cannot safely remove the system splash icon.');
let styles=fs.readFileSync(stylesPath,'utf8');
const launchStyle=/(<style\s+name=["']AppTheme\.NoActionBarLaunch["'][^>]*>)([\s\S]*?)(<\/style>)/;
if(!launchStyle.test(styles)) throw new Error('Could not locate AppTheme.NoActionBarLaunch in styles.xml.');
styles=styles.replace(launchStyle,(_match,open,body,close)=>{
  const clean=body.replace(/\s*<item\s+name=["'](?:windowSplashScreenAnimatedIcon|windowSplashScreenBackground|windowSplashScreenAnimationDuration|postSplashScreenTheme)["'][^>]*>[\s\S]*?<\/item>/g,'');
  return open+clean+`
        <item name="windowSplashScreenBackground">#02080c</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/valerian_transparent_splash</item>
        <item name="windowSplashScreenAnimationDuration">0</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    `+close;
});
fs.writeFileSync(stylesPath,styles);
console.log('Android system splash icon suppressed; VALERIAN animated web intro remains the branded startup screen.');

console.log('VALERIAN native file and print bridge installed.');
