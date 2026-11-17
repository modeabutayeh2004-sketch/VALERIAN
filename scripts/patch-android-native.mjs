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
console.log('VALERIAN native file and print bridge installed.');
