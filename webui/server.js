'use strict';

// WebUI Game Library — lists Godot HTML5 exports and serves them with the
// cross-origin isolation headers Godot 4 needs (COOP/COEP -> SharedArrayBuffer).
// Expected layout: $GAMES_DIR/<slug>/current/index.html

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const GAMES_DIR = path.resolve(process.env.GAMES_DIR || '/srv/games');
const TITLE = process.env.SITE_TITLE || 'Game Library';

const root = (slug) => path.join(GAMES_DIR, slug, 'current');
const valid = (slug) => /^[A-Za-z0-9._-]+$/.test(slug);
const exists = (slug) => fs.existsSync(path.join(root(slug), 'index.html'));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function listGames() {
  try {
    return fs.readdirSync(GAMES_DIR)
      .filter((slug) => valid(slug) && exists(slug))
      .sort();
  } catch {
    return [];
  }
}

const page = (title, body) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e0f13;color:#e7e9ee;
font-family:system-ui,sans-serif}a{color:inherit;text-decoration:none}
h1{font-size:1.5rem;padding:24px 28px 4px}.grid{display:grid;gap:18px;padding:16px 28px 48px;
grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.card{background:#181a21;
border:1px solid #262a35;border-radius:12px;overflow:hidden;transition:.12s}
.card:hover{transform:translateY(-3px);border-color:#6c8cff}.cover{aspect-ratio:16/10;
display:grid;place-items:center;background:#20232d;font-size:2.2rem;font-weight:700;
color:#6c8cff}.cover img{width:100%;height:100%;object-fit:cover}.card span{display:block;
padding:12px 14px}.muted{color:#9aa0ad;padding:0 28px}.player{display:flex;
flex-direction:column;height:100vh}.bar{display:flex;align-items:center;gap:16px;
padding:10px 16px;background:#181a21;border-bottom:1px solid #262a35}.bar a{color:#6c8cff;
font-weight:600}.bar button{margin-left:auto;background:#20232d;color:#e7e9ee;
border:1px solid #2c313d;border-radius:8px;padding:7px 14px;cursor:pointer}
iframe{flex:1;width:100%;border:0;background:#000}
</style></head><body>${body}</body></html>`;

function library() {
  const games = listGames();
  if (!games.length) {
    return page(TITLE, `<h1>${esc(TITLE)}</h1>
      <p class="muted">No games. Add one at <code>${esc(GAMES_DIR)}/&lt;name&gt;/current/index.html</code>.</p>`);
  }
  const cards = games.map((slug) => {
    const hasCover = fs.existsSync(path.join(root(slug), 'cover.png'));
    const cover = hasCover
      ? `<div class="cover"><img src="/games/${slug}/cover.png" alt="" loading="lazy"></div>`
      : `<div class="cover">${esc(slug[0].toUpperCase())}</div>`;
    return `<a class="card" href="/play/${slug}">${cover}<span>${esc(slug)}</span></a>`;
  }).join('');
  return page(TITLE, `<h1>${esc(TITLE)}</h1><div class="grid">${cards}</div>`);
}

const player = (slug) => page(`${slug} — ${TITLE}`, `<div class="player">
  <div class="bar"><a href="/">&larr; Library</a><b>${esc(slug)}</b>
  <button onclick="f.requestFullscreen()">Fullscreen</button></div>
  <iframe id="f" src="/games/${slug}/index.html" title="${esc(slug)}"
    allow="cross-origin-isolated;fullscreen;autoplay;gamepad" allowfullscreen></iframe>
  </div>`);

const app = express();
app.disable('x-powered-by');

// Cross-origin isolation on every response — required for Godot 4 web exports.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

app.get('/', (req, res) => res.type('html').send(library()));

app.get('/play/:slug', (req, res) => {
  const { slug } = req.params;
  if (!valid(slug) || !exists(slug)) return res.status(404).send('Not found');
  res.type('html').send(player(slug));
});

app.get('/games/:slug/*', (req, res) => {
  const { slug } = req.params;
  if (!valid(slug)) return res.status(404).end();
  const rel = req.params[0] || 'index.html';
  const file = path.resolve(root(slug), rel);
  if (file !== root(slug) && !file.startsWith(root(slug) + path.sep)) return res.status(403).end();
  res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

app.listen(PORT, () => console.log(`[webui] ${TITLE} — ${GAMES_DIR} on :${PORT}`));
