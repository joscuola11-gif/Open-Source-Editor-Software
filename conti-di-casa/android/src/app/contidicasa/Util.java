package app.contidicasa;

import java.util.Locale;

/**
 * Piccole funzioni senza Android dentro, così si possono provare con il solo JDK (android/test/UtilCheck.java).
 */
final class Util {
    private Util() {}

    /** Dal percorso richiesto dalla pagina al file dentro assets/web, oppure null se non è sicuro. */
    static String assetPath(String uriPath) {
        String p = uriPath == null || uriPath.isEmpty() || "/".equals(uriPath) ? "/index.html" : uriPath;
        if (p.charAt(0) != '/') return null;
        if (p.indexOf('\\') >= 0 || p.indexOf('\0') >= 0 || p.contains("//") || p.contains("%")) return null;
        for (String part : p.substring(1).split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.startsWith(".")) return null;
        }
        return "web" + p;
    }

    static String mimeOf(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (ext) {
            case "html": return "text/html";
            case "js": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "png": return "image/png";
            case "svg": return "image/svg+xml";
            case "ico": return "image/x-icon";
            default: return "application/octet-stream";
        }
    }

    /** Un testo come stringa JavaScript tra apici doppi (nessun carattere che possa uscire dalla stringa). */
    static String jsString(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder(s.length() + 16).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                case '<': b.append("\\u003c"); break;
                case '\u2028': b.append("\\u2028"); break;
                case '\u2029': b.append("\\u2029"); break;
                default:
                    if (c < 0x20) b.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    /** Nome di file adatto a qualunque cartella: niente barre, niente caratteri strani, massimo 80 caratteri. */
    static String safeFileName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.length() > 80) {
            int dot = n.lastIndexOf('.');
            String ext = dot > 0 && n.length() - dot <= 8 ? n.substring(dot) : "";
            n = n.substring(0, 80 - ext.length()) + ext;
        }
        return n.isEmpty() ? "conti-di-casa.txt" : n;
    }

    /** I tipi di file che si accettano come «tipo» per il salvataggio. */
    static String safeMime(String mime) {
        if ("application/json".equals(mime) || "text/csv".equals(mime) || "text/plain".equals(mime)) return mime;
        return "text/plain";
    }
}
