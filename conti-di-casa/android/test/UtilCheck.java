package app.contidicasa;

/** Prove di Util.java con il solo JDK: `bash tools/test-java.sh`. Esce con errore alla prima prova che fallisce. */
public final class UtilCheck {
    private static int n = 0;

    private static void eq(Object want, Object got, String what) {
        n++;
        if (want == null ? got != null : !want.equals(got)) {
            System.err.println("FALLITA: " + what + "\n  atteso: " + want + "\n  ottenuto: " + got);
            System.exit(1);
        }
    }

    public static void main(String[] args) {
        // percorsi dei file: solo quelli dell'app
        eq("web/index.html", Util.assetPath("/"), "radice");
        eq("web/index.html", Util.assetPath(""), "vuoto");
        eq("web/index.html", Util.assetPath(null), "null");
        eq("web/app.js", Util.assetPath("/app.js"), "script");
        eq("web/icons/icon-192.png", Util.assetPath("/icons/icon-192.png"), "sottocartella");
        eq(null, Util.assetPath("/../AndroidManifest.xml"), "risalita");
        eq(null, Util.assetPath("/icons/../../x"), "risalita nascosta");
        eq(null, Util.assetPath("/%2e%2e/x"), "risalita codificata");
        eq(null, Util.assetPath("/a\\b"), "barra rovescia");
        eq(null, Util.assetPath("//evil"), "doppia barra");
        eq(null, Util.assetPath("/.hidden"), "file nascosto");
        eq(null, Util.assetPath("app.js"), "senza barra iniziale");
        eq(null, Util.assetPath("/a\0b"), "carattere nullo");
        // tipi
        eq("text/html", Util.mimeOf("web/index.html"), "html");
        eq("text/javascript", Util.mimeOf("web/app.js"), "js");
        eq("application/manifest+json", Util.mimeOf("web/manifest.webmanifest"), "manifest");
        eq("image/png", Util.mimeOf("web/icons/a.PNG"), "png maiuscolo");
        eq("application/octet-stream", Util.mimeOf("web/x.bin"), "sconosciuto");
        eq("application/octet-stream", Util.mimeOf("web/senzaestensione"), "senza estensione");
        // testo dentro JavaScript
        eq("\"ciao\"", Util.jsString("ciao"), "semplice");
        eq("\"a\\\"b\"", Util.jsString("a\"b"), "virgolette");
        eq("\"a\\\\b\"", Util.jsString("a\\b"), "barra rovescia");
        eq("\"riga1\\nriga2\"", Util.jsString("riga1\nriga2"), "a capo");
        eq("\"\\u003c/script>\"", Util.jsString("</script>"), "chiusura script");
        eq("\"\\u2028\"", Util.jsString("\u2028"), "separatore di riga");
        eq("\"\\u0001\"", Util.jsString("\u0001"), "controllo");
        eq("\"€ è ✓\"", Util.jsString("€ è ✓"), "unicode normale");
        eq("\"\"", Util.jsString(null), "null");
        // nomi di file
        eq("conti-di-casa-2026-11-20.json", Util.safeFileName("conti-di-casa-2026-11-20.json"), "nome normale");
        eq("_.._etc_passwd", Util.safeFileName("../../etc/passwd"), "risalita nel nome");
        eq(false, Util.safeFileName("../../etc/passwd").contains("/"), "niente barre");
        eq(false, Util.safeFileName("a:b*c?.csv").matches(".*[:*?].*"), "niente caratteri vietati");
        eq("conti-di-casa.txt", Util.safeFileName(""), "vuoto");
        eq("conti-di-casa.txt", Util.safeFileName("..."), "solo punti");
        eq("conti-di-casa.txt", Util.safeFileName(null), "null");
        String long1 = "x".repeat(300) + ".json";
        eq(80, Util.safeFileName(long1).length(), "troppo lungo");
        eq(true, Util.safeFileName(long1).endsWith(".json"), "tiene l'estensione");
        eq("application/json", Util.safeMime("application/json"), "mime json");
        eq("text/plain", Util.safeMime("application/x-evil"), "mime strano");
        System.out.println("UtilCheck: " + n + " prove superate");
    }
}
