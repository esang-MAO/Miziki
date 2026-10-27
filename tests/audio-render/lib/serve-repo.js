// The offline-render harness's own tiny static file server.
//
// Unlike tests/perf/lib/static-server.js (which serves the *built*
// dist/, under /Miziki/, to match the real GitHub Pages deploy), this one
// serves the repo root unbuilt, at /. Every module under src/ uses only
// relative imports (CLAUDE.md's refactor rules; confirmed by grep before
// writing this file), so a real browser's native ES module loader can
// import src/audio/surface-noise.js, src/state.js, etc. directly over
// HTTP with no bundler step at all -- the same reason unit tests don't
// need one either, just a real <script type="module"> instead of
// node:test's module mocking.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
};

export function serveRepo(rootDir){
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = path.join(rootDir, rel);
    // Never serve outside rootDir (e.g. a path-traversal urlPath).
    if(!filePath.startsWith(rootDir) || !existsSync(filePath) || !statSync(filePath).isFile()){
      res.writeHead(404); res.end('not found: ' + rel); return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseURL: `http://127.0.0.1:${port}/` });
    });
  });
}
