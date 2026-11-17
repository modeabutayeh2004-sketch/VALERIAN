import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.join(process.cwd(), 'android/app/src/main/java/com/valerian/business/MainActivity.java');
if (!fs.existsSync(mainPath)) throw new Error('Capacitor MainActivity.java was not generated.');
let source = fs.readFileSync(mainPath, 'utf8');
if (!source.includes('ValerianNative')) {
  source = source.replace(/public class MainActivity extends BridgeActivity\\s*\\{\\s*\\}/,
    'public class MainActivity extends BridgeActivity {\\n' +
    '  @Override public void onCreate(android.os.Bundle savedInstanceState) {\\n' +
    '    super.onCreate(savedInstanceState);\\n' +
    '    getBridge().getWebView().addJavascriptInterface(new NativeFileBridge(this), "ValerianNative");\\n' +
    '  }\\n' +
    '}');
  if (!source.includes('ValerianNative')) throw new Error('Could not safely patch MainActivity.java.');
  fs.writeFileSync(mainPath, source);
}
console.log('VALERIAN native file and print bridge installed.');
