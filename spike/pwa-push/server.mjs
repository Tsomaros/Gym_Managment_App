// Throwaway spike: proves PWA install + web push on iPhone (Greece) and Android. Not production code.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const dir = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const keys = webpush.generateVAPIDKeys(); // new keys per run: re-subscribe after a restart
webpush.setVapidDetails('mailto:spike@example.com', keys.publicKey, keys.privateKey);
const subscriptions = new Map(); // endpoint -> subscription (in memory only)

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function sendAll() {
  const payload = JSON.stringify({ title: 'Gym (δοκιμή)', body: 'Η συνδρομή σου λήγει σε 5 ημέρες' });
  const results = await Promise.allSettled([...subscriptions.values()].map((s) => webpush.sendNotification(s, payload)));
  results.forEach((r, i) => { if (r.status === 'rejected') console.log('push failed:', r.reason?.statusCode, r.reason?.body); });
  console.log(`sent to ${results.filter((r) => r.status === 'fulfilled').length}/${results.length}`);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/vapid-public-key') return res.end(keys.publicKey);
    if (req.method === 'POST' && url.pathname === '/subscribe') {
      const sub = await body(req);
      subscriptions.set(sub.endpoint, sub);
      console.log('subscribed:', new URL(sub.endpoint).host, `(${subscriptions.size} total)`);
      return res.writeHead(201).end();
    }
    if (req.method === 'POST' && url.pathname === '/send') {
      const delay = Math.min(Number(url.searchParams.get('delay') ?? 0), 120);
      setTimeout(sendAll, delay * 1000);
      return res.writeHead(202).end(`sending in ${delay}s`);
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!types[extname(file)] || file.includes('..')) return res.writeHead(404).end();
    const data = await readFile(join(dir, file));
    res.writeHead(200, { 'Content-Type': types[extname(file)] }).end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end();
  }
}).listen(port, () => console.log(`spike on http://localhost:${port}  (POST /send?delay=10 to push)`));
