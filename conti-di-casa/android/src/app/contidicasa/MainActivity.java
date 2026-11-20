package app.contidicasa;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Guscio Android di Conti di Casa.
 *
 * L'app vera è una pagina web inclusa nell'APK (assets/web). Viene servita a una WebView come se stesse su
 * https://appassets.androidplatform.net/ (l’indirizzo di prova che Android riserva a questo scopo: le richieste non escono mai verso la rete), così la pagina ha un'origine «sicura»
 * (serve per l'archivio dei dati e per il PIN). Qualunque altro indirizzo è bloccato, e l'app non ha il permesso
 * INTERNET: i dati non possono uscire dal telefono.
 *
 * Ponte per la pagina (`ContiNativo`): salvare un file nella cartella scelta, condividere un testo,
 * chiedere il blocco schermo del telefono, nascondere l'app nelle schermate recenti.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_SAVE = 71;
    private static final int REQ_UNLOCK = 72;
    private static final int REQ_PICK = 73;

    private WebView web;
    private ValueCallback<Uri[]> filePicker;
    private String pendingSaveId;
    private String pendingSaveText;
    private String pendingUnlockId;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        web.addJavascriptInterface(new Bridge(), "ContiNativo");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request);
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // l'app non va mai altrove
                Uri u = Uri.parse(url);
                return !("https".equals(u.getScheme()) && HOST.equals(u.getHost()));
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                // «Ripristina una copia», «Importa un estratto conto»: la pagina chiede di scegliere un file
                if (filePicker != null) filePicker.onReceiveValue(null);
                filePicker = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_PICK);
                } catch (ActivityNotFoundException e) {
                    filePicker = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        web.loadUrl(START_URL);
    }

    // ---- i file dell'app, serviti alla pagina -----------------------------------------------------------------------

    private WebResourceResponse serve(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return reply(403, "text/plain", "Bloccato");
        if (!"GET".equals(request.getMethod())) return reply(405, "text/plain", "Metodo non ammesso");
        String path = Util.assetPath(uri.getPath());
        if (path == null) return reply(404, "text/plain", "Non trovato");
        try {
            InputStream in = getAssets().open(path);
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(Util.mimeOf(path), "utf-8", 200, "OK", headers, in);
        } catch (IOException e) {
            return reply(404, "text/plain", "Non trovato");
        }
    }

    private static WebResourceResponse reply(int code, String mime, String body) {
        byte[] bytes;
        try {
            bytes = body.getBytes("UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            bytes = new byte[0];
        }
        return new WebResourceResponse(mime, "utf-8", code, code == 404 ? "Not Found" : code == 403 ? "Forbidden" : "Error", new HashMap<String, String>(), new ByteArrayInputStream(bytes));
    }

    // ---- risposte alla pagina ---------------------------------------------------------------------------------------

    private void answer(final String id, final boolean ok, final String data) {
        final String js = "window.__nativeResult && window.__nativeResult(" + Util.jsString(id) + "," + ok + "," + Util.jsString(data) + ")";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    /** Quello che la pagina può chiedere ad Android. Tutti i metodi rispondono poi con __nativeResult. */
    private final class Bridge {
        @JavascriptInterface
        public boolean canUnlock() {
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            return km != null && km.isDeviceSecure();
        }

        @JavascriptInterface
        public void unlock(final String id) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                    Intent i = km == null ? null : km.createConfirmDeviceCredentialIntent(getString(R.string.unlock_title), getString(R.string.unlock_text));
                    if (i == null) {
                        answer(id, false, "Il telefono non ha un blocco schermo: attivane uno nelle impostazioni di Android.");
                        return;
                    }
                    if (pendingUnlockId != null) answer(pendingUnlockId, false, "Operazione annullata.");
                    pendingUnlockId = id;
                    try {
                        startActivityForResult(i, REQ_UNLOCK);
                    } catch (ActivityNotFoundException e) {
                        pendingUnlockId = null;
                        answer(id, false, "Non riesco ad aprire lo sblocco del telefono.");
                    }
                }
            });
        }

        @JavascriptInterface
        public void saveFile(final String id, final String name, final String mime, final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (pendingSaveId != null) answer(pendingSaveId, false, "Operazione annullata.");
                    pendingSaveId = id;
                    pendingSaveText = text == null ? "" : text;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(Util.safeMime(mime));
                    i.putExtra(Intent.EXTRA_TITLE, Util.safeFileName(name));
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (ActivityNotFoundException e) {
                        pendingSaveId = null;
                        pendingSaveText = null;
                        answer(id, false, "Non trovo un’app per scegliere dove salvare il file.");
                    }
                }
            });
        }

        @JavascriptInterface
        public void shareText(final String id, final String title, final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_SUBJECT, title);
                    send.putExtra(Intent.EXTRA_TEXT, text);
                    try {
                        startActivity(Intent.createChooser(send, title));
                        answer(id, true, "ok");
                    } catch (ActivityNotFoundException e) {
                        answer(id, false, "Non trovo un’app con cui condividere.");
                    }
                }
            });
        }

        @JavascriptInterface
        public void setSecure(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    // niente schermate né anteprima nelle app recenti quando c'è un blocco
                    if (on) getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
            });
        }
    }

    // ---- ritorno dalle schermate di Android -------------------------------------------------------------------------

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == REQ_PICK) {
            if (filePicker != null) {
                Uri[] picked = result == RESULT_OK ? WebChromeClient.FileChooserParams.parseResult(result, data) : null;
                filePicker.onReceiveValue(picked);
                filePicker = null;
            }
        } else if (code == REQ_UNLOCK) {
            String id = pendingUnlockId;
            pendingUnlockId = null;
            if (id != null) {
                if (result == RESULT_OK) answer(id, true, "ok");
                else answer(id, false, "Operazione annullata.");
            }
        } else if (code == REQ_SAVE) {
            String id = pendingSaveId;
            String text = pendingSaveText;
            pendingSaveId = null;
            pendingSaveText = null;
            if (id == null) return;
            if (result != RESULT_OK || data == null || data.getData() == null) {
                answer(id, false, "Operazione annullata.");
                return;
            }
            OutputStream out = null;
            try {
                out = getContentResolver().openOutputStream(data.getData(), "wt");
                if (out == null) throw new IOException("nessun flusso");
                out.write(text.getBytes("UTF-8"));
                out.flush();
                answer(id, true, "ok");
            } catch (IOException e) {
                answer(id, false, "Non sono riuscito a scrivere il file.");
            } finally {
                if (out != null) {
                    try {
                        out.close();
                    } catch (IOException ignored) {
                        // già scritto
                    }
                }
            }
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        // la pagina salva i dati e prende nota di quando si è usciti (serve al blocco automatico)
        if (web != null) web.evaluateJavascript("window.__appHidden && window.__appHidden()", null);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (web != null) web.evaluateJavascript("window.__appShown && window.__appShown()", null);
    }

    @Override
    public void onBackPressed() {
        // il tasto «indietro» lo gestisce prima la pagina (chiude un foglio, torna alla pagina precedente);
        // se non c'è niente da chiudere, l'app va in secondo piano
        if (web == null) {
            moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript("(window.__onBack ? window.__onBack() : false) === true", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("ContiNativo");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
