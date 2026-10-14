// NV1: a tiny static file server for the built `dist/` output, used only by
// the perf harness. Vite's own `vite preview` would do this too, but
// shelling out to a second CLI and waiting for its own startup banner is
// more moving parts than this harness needs — a few dozen lines of plain
// `http` cover exactly what nav.perf.js asks for: serve `dist/` under
// `/Miziki/` (vite.config.js's own default `base`, unset here on purpose —
// see that file's own entry in CLAUDE.md — so this matches the real
// GitHub Pages deploy, not a Netlify-style root-mounted preview).
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

export function serveDist(distDir, basePath = '/Miziki/'){
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if(!urlPath.startsWith(basePath)){
      res.writeHead(404); res.end('not under ' + basePath); return;
    }
    let rel = urlPath.slice(basePath.length);
    if(rel === '') rel = 'miziki.html';
    const filePath = path.join(distDir, rel);
    if(!existsSync(filePath) || !statSync(filePath).isFile()){
      res.writeHead(404); res.end('not found: ' + rel); return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}${basePath}miziki.html` });
    });
  });
}
