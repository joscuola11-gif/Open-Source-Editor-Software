package app.squillo.chiamate;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

/**
 * Guscio Android di Squillo: mostra l'app web inclusa nell'APK (assets/squillo) in una WebView.
 * La pagina vede solo i propri file; camera e microfono si chiedono a Android e poi alla pagina.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/squillo/index.html";
    private static final int REQ_MEDIA = 42;

    private WebView web;
    private PermissionRequest pending;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // la suoneria e il video dell'altra persona partono da soli
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // (da Android 7 il sistema richiama questo metodo anche per la versione con WebResourceRequest)
                // l'app non va mai altrove: solo i propri file
                Uri u = Uri.parse(url);
                return !("file".equals(u.getScheme()) && u.getPath() != null && u.getPath().startsWith("/android_asset/squillo/"));
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        handleMediaRequest(request);
                    }
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pending == request) pending = null;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(START_URL);
    }

    /** Camera e microfono: prima il permesso di Android, poi si concede alla pagina solo ciò che è stato accordato. */
    private void handleMediaRequest(PermissionRequest request) {
        if (!"file".equals(request.getOrigin().getScheme())) {
            request.deny();
            return;
        }
        if (pending != null) pending.deny();
        List<String> need = new ArrayList<String>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !has(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !has(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
        }
        if (need.isEmpty() || Build.VERSION.SDK_INT < 23) {
            grantAllowed(request);
            return;
        }
        pending = request;
        requestPermissions(need.toArray(new String[0]), REQ_MEDIA);
    }

    private boolean has(String permission) {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void grantAllowed(PermissionRequest request) {
        List<String> ok = new ArrayList<String>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && has(Manifest.permission.CAMERA)) ok.add(r);
            else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && has(Manifest.permission.RECORD_AUDIO)) ok.add(r);
        }
        if (ok.isEmpty()) request.deny();
        else request.grant(ok.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != REQ_MEDIA || pending == null) return;
        PermissionRequest request = pending;
        pending = null;
        grantAllowed(request);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        // il tasto indietro non chiude la chiamata: manda l'app in secondo piano
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
