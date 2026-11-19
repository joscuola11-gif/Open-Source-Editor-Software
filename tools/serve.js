// Server statico minimale (nessuna dipendenza): `npm start` → http://localhost:5173
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.srt': 'text/plain; charset=utf-8',
};

export function createServer(root = ROOT) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(root, path.normalize(rel));
      if (!file.startsWith(root + path.sep) && file !== root) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const st = await stat(file).catch(() => null);
      if (!st?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Non trovato');
        return;
      }
      const data = await readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      // le richieste Range servono ai <video> per gli spostamenti rapidi
      const range = req.headers.range;
      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [a, b] = range.slice(6).split('-');
        const start = a ? +a : 0;
        const end = b ? Math.min(+b, data.length - 1) : data.length - 1;
        res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${data.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
        res.end(data.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
      res.end(data);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 5173);
  createServer().listen(port, () => console.log(`Ciak Studio → http://localhost:${port}`));
}
