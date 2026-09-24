// Minimal static server with correct JS MIME types (python http.server serves .js as text/plain on Windows,
// which blocks ES modules). Usage: PORT=4731 node static-server.mjs  (serves the current directory)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(process.cwd(), path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'Content-Type': types[extname(path) || '.html'] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(Number(process.env.PORT ?? 4731), '127.0.0.1');
