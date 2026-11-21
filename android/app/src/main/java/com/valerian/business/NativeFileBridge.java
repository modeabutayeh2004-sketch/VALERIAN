package com.valerian.business;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.content.FileProvider;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.util.Base64;

import java.io.OutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

public final class NativeFileBridge {
    private final Activity activity;
    private final WebView webView;
    private final ConcurrentHashMap<String, ImageSaveSession> imageSaveSessions = new ConcurrentHashMap<>();

    private static final class ImageSaveSession {
        final File tempFile;
        final FileOutputStream output;
        final String fileName;
        final String mimeType;
        ImageSaveSession(File tempFile, FileOutputStream output, String fileName, String mimeType) {
            this.tempFile = tempFile; this.output = output; this.fileName = fileName; this.mimeType = mimeType;
        }
    }

    public NativeFileBridge(Activity activity) { this(activity, null); }
    public NativeFileBridge(Activity activity, WebView webView) { this.activity = activity; this.webView = webView; }

    private static String safeImageName(String fileName) {
        String name = (fileName == null ? "VALERIAN-image.png" : fileName).replaceAll("[^A-Za-z0-9._-]", "_");
        return name.isEmpty() ? "VALERIAN-image.png" : name;
    }

    // Chunked transfer keeps large Base64 payloads out of a single blocking WebView bridge call.
    @JavascriptInterface
    public String beginImageSave(String fileName, String mimeType) {
        try {
            File temp = File.createTempFile("valerian-image-", ".part", activity.getCacheDir());
            FileOutputStream output = new FileOutputStream(temp);
            String id = UUID.randomUUID().toString();
            imageSaveSessions.put(id, new ImageSaveSession(temp, output, safeImageName(fileName),
                (mimeType == null || mimeType.isEmpty()) ? "image/png" : mimeType));
            return id;
        } catch (Exception e) { return ""; }
    }

    @JavascriptInterface
    public boolean appendImageSaveChunk(String saveId, String base64Chunk) {
        ImageSaveSession session = imageSaveSessions.get(saveId);
        if (session == null || base64Chunk == null) return false;
        try {
            byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
            synchronized (session) { session.output.write(bytes); }
            return true;
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public void cancelImageSave(String saveId) {
        ImageSaveSession session = imageSaveSessions.remove(saveId);
        if (session == null) return;
        try { synchronized (session) { session.output.close(); } } catch (Exception ignored) {}
        try { session.tempFile.delete(); } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void finishImageSave(String saveId, String callbackId) {
        final ImageSaveSession session = imageSaveSessions.remove(saveId);
        if (session == null) { notifyImageSave(callbackId, false, "جلسة حفظ الصورة غير موجودة."); return; }
        try { synchronized (session) { session.output.flush(); session.output.close(); } }
        catch (Exception e) { session.tempFile.delete(); notifyImageSave(callbackId, false, "تعذر تجهيز ملف الصورة: " + e.getMessage()); return; }

        new Thread(() -> {
            Uri uri = null;
            boolean success = false;
            String error = "";
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, session.fileName);
                values.put(MediaStore.Images.Media.MIME_TYPE, session.mimeType);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/VALERIAN");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                }
                uri = activity.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("تعذر إنشاء ملف في معرض الصور.");
                try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(session.tempFile));
                     BufferedOutputStream out = new BufferedOutputStream(activity.getContentResolver().openOutputStream(uri))) {
                    if (out == null) throw new IllegalStateException("تعذر فتح ملف الصورة.");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                    out.flush();
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues done = new ContentValues(); done.put(MediaStore.Images.Media.IS_PENDING, 0);
                    activity.getContentResolver().update(uri, done, null, null);
                }
                success = true;
            } catch (Exception e) {
                error = e.getMessage() == null ? "تعذر حفظ الصورة." : e.getMessage();
                if (uri != null) try { activity.getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
            } finally {
                try { session.tempFile.delete(); } catch (Exception ignored) {}
            }
            notifyImageSave(callbackId, success, error);
        }, "ValerianImageSave").start();
    }

    private void notifyImageSave(String callbackId, boolean success, String message) {
        if (webView == null) return;
        final String safeId = JSONObject.quote(callbackId == null ? "" : callbackId);
        final String safeMessage = JSONObject.quote(message == null ? "" : message);
        activity.runOnUiThread(() -> webView.evaluateJavascript(
            "window.__valerianNativeSaveComplete&&window.__valerianNativeSaveComplete(" + safeId + "," + success + "," + safeMessage + ")", null));
    }

    @JavascriptInterface
    public boolean saveImage(String base64, String fileName, String mimeType) {
        try {
            String clean = base64 == null ? "" : base64.replaceFirst("^data:[^,]*,", "");
            byte[] bytes = Base64.decode(clean, Base64.DEFAULT);
            String safeName = (fileName == null ? "VALERIAN-image.png" : fileName).replaceAll("[^A-Za-z0-9._-]", "_");
            String mime = (mimeType == null || mimeType.isEmpty()) ? "image/png" : mimeType;
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, safeName);
            values.put(MediaStore.Images.Media.MIME_TYPE, mime);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/VALERIAN");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }
            Uri uri = activity.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return false;
            try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("تعذر فتح ملف الصورة");
                out.write(bytes); out.flush();
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues done = new ContentValues(); done.put(MediaStore.Images.Media.IS_PENDING, 0);
                activity.getContentResolver().update(uri, done, null, null);
            }
            activity.runOnUiThread(() -> Toast.makeText(activity, "تم حفظ الصورة في Pictures/VALERIAN", Toast.LENGTH_LONG).show());
            return true;
        } catch (Exception e) {
            activity.runOnUiThread(() -> Toast.makeText(activity, "فشل حفظ الصورة: " + e.getMessage(), Toast.LENGTH_LONG).show());
            return false;
        }
    }

    // One-tap customer share: opens WhatsApp directly on the customer's chat with the
    // invoice image attached and the message prefilled (wa.me links cannot carry images).
    // Returns false when WhatsApp is absent so the page can fall back to its own paths.
    @JavascriptInterface
    public boolean shareImageToWhatsApp(String base64, String fileName, String mimeType, String phone, String message) {
        try {
            PackageManager pm = activity.getPackageManager();
            try { pm.getPackageInfo("com.whatsapp", 0); } catch (PackageManager.NameNotFoundException e) { return false; }
            String clean = base64 == null ? "" : base64.replaceFirst("^data:[^,]*,", "");
            byte[] bytes = Base64.decode(clean, Base64.DEFAULT);
            if (bytes.length == 0) throw new IllegalArgumentException("صورة الفاتورة فارغة");
            File dir = new File(activity.getCacheDir(), "wa_share");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("تعذر تجهيز مجلد المشاركة");
            File[] stale = dir.listFiles();
            if (stale != null) for (File f : stale) { if (f.isFile()) f.delete(); }
            File out = new File(dir, System.currentTimeMillis() + "_" + safeImageName(fileName));
            try (FileOutputStream fos = new FileOutputStream(out)) { fos.write(bytes); fos.flush(); }
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", out);
            String digits = phone == null ? "" : phone.replaceAll("\\D", "");
            if (digits.startsWith("00")) digits = digits.substring(2);
            if (digits.length() == 11 && digits.startsWith("0")) digits = "20" + digits.substring(1);
            final Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setPackage("com.whatsapp");
            intent.setType((mimeType == null || mimeType.isEmpty()) ? "image/png" : mimeType);
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            if (message != null && !message.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, message);
            if (!digits.isEmpty()) intent.putExtra("jid", digits + "@s.whatsapp.net");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("VALERIAN", uri));
            if (intent.resolveActivity(pm) == null) return false;
            activity.runOnUiThread(() -> {
                try { activity.startActivity(intent); }
                catch (ActivityNotFoundException e) { Toast.makeText(activity, "واتساب غير مثبت على هذا الجهاز", Toast.LENGTH_LONG).show(); }
            });
            return true;
        } catch (Exception e) {
            final String msg = e.getMessage() == null ? "خطأ غير معروف" : e.getMessage();
            activity.runOnUiThread(() -> Toast.makeText(activity, "فشل تجهيز مشاركة واتساب: " + msg, Toast.LENGTH_LONG).show());
            return false;
        }
    }

    @JavascriptInterface
    public void printHtml(String html, String jobName, boolean thermal) {
        activity.runOnUiThread(() -> {
            try {
                if (html == null || html.trim().isEmpty()) throw new IllegalArgumentException("محتوى البوليصة فارغ");
                WebView printView = new WebView(activity);
                printView.getSettings().setJavaScriptEnabled(false);
                printView.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView view, String url) {
                        try {
                            PrintManager manager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                            String title = (jobName == null || jobName.trim().isEmpty()) ? "VALERIAN" : jobName;
                            PrintAttributes.Builder attrs = new PrintAttributes.Builder()
                                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS);
                            if (thermal) attrs.setMediaSize(new PrintAttributes.MediaSize("VALERIAN_80MM", "80mm", 3150, 12000));
                            manager.print(title, view.createPrintDocumentAdapter(title), attrs.build());
                        } catch (Exception e) {
                            Toast.makeText(activity, "تعذرت الطباعة: " + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    }
                });
                printView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                Toast.makeText(activity, "تعذرت الطباعة: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    @JavascriptInterface
    public void printImage(String base64, String jobName, boolean thermal) {
        activity.runOnUiThread(() -> {
            try {
                String clean = base64 == null ? "" : base64.replaceFirst("^data:[^,]*,", "");
                String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><style>"
                    + "@page{margin:" + (thermal ? "2mm" : "6mm") + ";size:" + (thermal ? "80mm auto" : "auto") + "}"
                    + "html,body{margin:0;padding:0;background:#fff}img{display:block;width:100%;height:auto;object-fit:contain}"
                    + "</style></head><body><img src='data:image/png;base64," + clean + "'></body></html>";
                WebView printView = new WebView(activity);
                printView.getSettings().setJavaScriptEnabled(false);
                printView.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView view, String url) {
                        try {
                            PrintManager manager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                            String title = (jobName == null || jobName.trim().isEmpty()) ? "VALERIAN" : jobName;
                            PrintAttributes.Builder attrs = new PrintAttributes.Builder()
                                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS);
                            if (thermal) attrs.setMediaSize(new PrintAttributes.MediaSize("VALERIAN_80MM", "80mm", 3150, 12000));
                            manager.print(title, view.createPrintDocumentAdapter(title), attrs.build());
                        } catch (Exception e) {
                            Toast.makeText(activity, "تعذرت الطباعة: " + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    }
                });
                printView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                Toast.makeText(activity, "تعذرت الطباعة: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }
}
