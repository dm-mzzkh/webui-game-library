'use strict';

// WebUI Game Library — lists Godot HTML5 exports and serves them with the
// cross-origin isolation headers Godot 4 needs (COOP/COEP -> SharedArrayBuffer).
// Layout: $GAMES_DIR/<slug>/<version>/index.html  (+ a "current" symlink to latest)
//
// Two access modes (ACCESS_MODE env):
//   full   (default) — full library + all games, no auth. Expose on Tailnet only.
//   public           — no library; access only via /s/<uuid> share links gated by
//                      a password, limited to the game/version the link is bound to.

const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');

const PORT = Number(process.env.PORT) || 8080;
const GAMES_DIR = path.resolve(process.env.GAMES_DIR || '/srv/games');
const TITLE = process.env.SITE_TITLE || 'Game Library';
const PUBLIC = (process.env.ACCESS_MODE || 'full') === 'public';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

if (PUBLIC && !process.env.SHARE_SECRET) {
  console.error('ACCESS_MODE=public requires SHARE_SECRET to be set'); process.exit(1);
}

const dir = (slug, version) => path.join(GAMES_DIR, slug, version);
const valid = (s) => typeof s === 'string' && /^[A-Za-z0-9._-]+$/.test(s);
const has = (slug, version) => fs.existsSync(path.join(dir(slug, version), 'index.html'));
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function versions(slug) {
  try {
    return fs.readdirSync(path.join(GAMES_DIR, slug))
      .filter((v) => v !== 'current' && valid(v) && has(slug, v))
      .sort((a, b) => mtime(dir(slug, b)) - mtime(dir(slug, a)));
  } catch {
    return [];
  }
}

function currentTarget(slug) {
  try { return path.basename(fs.realpathSync(dir(slug, 'current'))); } catch { return null; }
}

const defaultVersion = (slug) => (has(slug, 'current') ? 'current' : versions(slug)[0]);
const playable = (slug) => valid(slug) && !!defaultVersion(slug);

function listGames() {
  try { return fs.readdirSync(GAMES_DIR).filter(playable).sort(); } catch { return []; }
}

// Build metadata written by the deploy pipeline (commit, author, dates...).
function versionInfo(slug, version) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(slug, version), 'version.json'), 'utf8'));
  } catch {
    return null;
  }
}

function sendGameFile(res, slug, version, rel) {
  const base = dir(slug, version);
  const file = path.resolve(base, rel || 'index.html');
  if (file !== base && !file.startsWith(base + path.sep)) return res.status(403).end();
  // Versioned dirs are immutable; only the "current" symlink changes content.
  const cache = version === 'current' ? 'no-cache' : 'public, max-age=31536000, immutable';
  res.sendFile(file, { headers: { 'Cache-Control': cache } }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}

// --- views ----------------------------------------------------------------

const page = (title, body) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e0f13;color:#e7e9ee;
font-family:system-ui,sans-serif}a{color:inherit;text-decoration:none}
h1{font-size:1.5rem;padding:24px 28px 4px}.grid{display:grid;gap:18px;padding:16px 28px 48px;
grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.card{position:relative;
background:#181a21;border:1px solid #262a35;border-radius:12px;overflow:hidden;transition:.12s}
.card:hover{transform:translateY(-3px);border-color:#6c8cff}.cover{aspect-ratio:16/10;
display:grid;place-items:center;background:#20232d;font-size:2.2rem;font-weight:700;
color:#6c8cff}.cover img{width:100%;height:100%;object-fit:cover}.card span{display:block;
padding:12px 14px}.badge{position:absolute;top:8px;right:8px;background:#0e0f13cc;color:#9aa0ad;
font-size:.72rem;padding:2px 8px;border-radius:999px}.muted{color:#9aa0ad;padding:0 28px}
.player{display:flex;flex-direction:column;height:100vh}.bar{display:flex;align-items:center;
gap:14px;padding:10px 16px;background:#181a21;border-bottom:1px solid #262a35}.bar a{color:#6c8cff;
font-weight:600}.bar .sp{margin-left:auto}.bar .ver{color:#9aa0ad;font-size:.82rem;max-width:42vw;
overflow:hidden;text-overflow:ellipsis;white-space:nowrap}select,.bar button{background:#20232d;color:#e7e9ee;
border:1px solid #2c313d;border-radius:8px;padding:7px 12px;cursor:pointer;font:inherit}
iframe{flex:1;width:100%;border:0;background:#000}.box{max-width:340px;margin:12vh auto;padding:0 20px}
.box input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #2c313d;background:#20232d;
color:#e7e9ee;font:inherit}.box button{margin-top:10px;width:100%;background:#6c8cff;color:#0e0f13;
border:0;border-radius:8px;padding:10px;font:inherit;font-weight:600;cursor:pointer}
.err{color:#ff6b6b}.adminlink{font-size:.8rem;color:#6c8cff;margin-left:10px}
.admin{padding:0 28px 48px;display:grid;gap:24px}.create{display:flex;flex-wrap:wrap;gap:12px;
align-items:end;background:#181a21;border:1px solid #262a35;border-radius:12px;padding:16px}
.create h2{width:100%;margin:0 0 4px;font-size:1.1rem}.create label{display:flex;
flex-direction:column;gap:4px;font-size:.82rem;color:#9aa0ad}.create input,.create select{
background:#20232d;color:#e7e9ee;border:1px solid #2c313d;border-radius:8px;padding:8px 10px;font:inherit}
.create>button{background:#6c8cff;color:#0e0f13;border:0;border-radius:8px;padding:9px 16px;
font:inherit;font-weight:600;cursor:pointer}table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #262a35;vertical-align:middle}
th{color:#9aa0ad;font-weight:600}code{background:#20232d;padding:2px 6px;border-radius:6px;
font-size:.85em;word-break:break-all}.del{background:#3a2030;color:#ff6b6b;border:1px solid #5a2a3a;
border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}.ok{margin:0 28px 16px;padding:12px 16px;
background:#16241a;border:1px solid #234a2f;border-radius:10px;color:#cdeccd;line-height:1.7}
.ok code{background:#0e0f13}
dialog.dlg{background:#181a21;color:#e7e9ee;border:1px solid #262a35;border-radius:12px;padding:18px;
width:min(440px,92vw)}dialog.dlg::backdrop{background:#000a}.dlg h3{font-size:1.05rem;margin:0 0 12px}
.dlg .lbl{display:block;font-size:.85rem;color:#9aa0ad}.dlg .lbl small{color:#6f7682}
.dlg input{width:100%;margin-top:6px;padding:9px 11px;border-radius:8px;border:1px solid #2c313d;
background:#20232d;color:#e7e9ee;font:inherit}.dlg #sdurl{background:#0e0f13;margin-top:0}
.dlg #sdres{margin-top:12px}.dlg .hint{font-size:.82rem;color:#9aa0ad;margin:8px 0 0}
.dlg-row{margin-top:16px;display:flex;gap:8px;justify-content:flex-end}.dlg button{background:#20232d;
color:#e7e9ee;border:1px solid #2c313d;border-radius:8px;padding:8px 14px;cursor:pointer;font:inherit}
.dlg button.primary{background:#6c8cff;color:#0e0f13;border:0;font-weight:600}
</style></head><body>${body}</body></html>`;

function library() {
  const games = listGames();
  if (!games.length) {
    return page(TITLE, `<h1>${esc(TITLE)}</h1>
      <p class="muted">No games. Add one at <code>${esc(GAMES_DIR)}/&lt;name&gt;/current/index.html</code>.</p>`);
  }
  const cards = games.map((slug) => {
    const v = defaultVersion(slug);
    const n = versions(slug).length;
    const cover = fs.existsSync(path.join(dir(slug, v), 'cover.png'))
      ? `<div class="cover"><img src="/games/${slug}/${v}/cover.png" alt="" loading="lazy"></div>`
      : `<div class="cover">${esc(slug[0].toUpperCase())}</div>`;
    const badge = n > 1 ? `<span class="badge">${n} versions</span>` : '';
    return `<a class="card" href="/play/${slug}">${cover}${badge}<span>${esc(slug)}</span></a>`;
  }).join('');
  return page(TITLE, `<h1>${esc(TITLE)}<a class="adminlink" href="/admin">admin</a></h1>
    <div class="grid">${cards}</div>`);
}

function adminPage({ created } = {}) {
  const games = listGames();
  const shares = auth.load();
  const base = process.env.PUBLIC_URL || '';
  const url = (t) => `${base}/s/${t}`;

  const banner = created ? `<div class="ok"><b>Share link created.</b>
    Copy the password now — it is hashed and cannot be shown again.<br>
    URL: <code>${esc(url(created.token))}</code><br>
    Password: <code>${esc(created.password)}</code></div>` : '';

  const opts = games.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')
    || '<option value="" disabled>no games found</option>';

  const rows = Object.entries(shares).map(([t, s]) => `<tr>
    <td>${esc(s.label || s.slug)}</td>
    <td>${esc(s.slug)}@${esc(s.version || 'current')}</td>
    <td><code>${esc(url(t))}</code></td>
    <td>${esc((s.created || '').slice(0, 10))}</td>
    <td><form method="post" action="/admin/shares/${esc(t)}/delete"
      onsubmit="return confirm('Delete this link?')"><button class="del">Delete</button></form></td>
  </tr>`).join('') || '<tr><td colspan="5" style="color:#9aa0ad">No share links yet.</td></tr>';

  return page(`Admin — ${TITLE}`, `<h1>Admin — share links<a class="adminlink" href="/">library</a></h1>
  ${banner}
  <div class="admin">
    <form class="create" method="post" action="/admin/shares">
      <h2>Create link</h2>
      <label>Game<select name="slug" required>${opts}</select></label>
      <label>Version<input name="version" placeholder="current"></label>
      <label>Label<input name="label" placeholder="(optional)"></label>
      <label>Password<input name="password" placeholder="(blank = auto-generate)"></label>
      <button>Create</button>
    </form>
    <table><thead><tr><th>Label</th><th>Game</th><th>Public link</th><th>Created</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    ${base ? '' : '<p style="color:#9aa0ad">Set <code>PUBLIC_URL</code> to render full public link addresses.</p>'}
  </div>`);
}

function player(slug, active, opts = {}) {
  const { label = slug, back = '/', selectBase = `/play/${slug}/`, share = false } = opts;
  // Commit message of the active version, shown next to the title.
  const info = versionInfo(slug, active);
  const commit = info ? `${info.short_version || ''}${info.commit_message ? ` · ${info.commit_message}` : ''}` : '';
  let chrome = back ? `<a href="${esc(back)}">&larr; Library</a>` : '';
  chrome += `<b>${esc(label)}</b>`;
  if (commit) chrome += `<span class="ver">${esc(commit)}</span>`;
  chrome += '<span class="sp"></span>';

  // Version options carry the commit message so you can pick a build by what changed.
  const target = currentTarget(slug);
  const optText = (v) => {
    const i = versionInfo(slug, v);
    const short = (i && i.short_version) || (v === 'current' ? (target || 'latest') : v);
    return { short, msg: i && i.commit_message ? ` — ${i.commit_message}` : '' };
  };
  const list = [];
  if (has(slug, 'current')) { const t = optText('current'); list.push({ v: 'current', label: `current: ${t.short}${t.msg}` }); }
  for (const v of versions(slug)) { const t = optText(v); list.push({ v, label: `${t.short}${v === target ? ' (current)' : ''}${t.msg}` }); }
  if (list.length > 1) {
    chrome += `<select onchange="location.href='${selectBase}'+this.value">`
      + list.map((o) => `<option value="${o.v}"${o.v === active ? ' selected' : ''}>${esc(o.label)}</option>`).join('')
      + '</select>';
  }

  // Point the iframe at the resolved build dir, not the mutable "current"
  // symlink, so its assets get the immutable 1y cache across reloads. The
  // selector and share link still use the logical version ("current").
  const srcVersion = (active === 'current' ? currentTarget(slug) : null) || active;

  // Share button + dialog (full mode only): creates a public link for this game.
  const shareBtn = share ? "<button onclick=\"document.getElementById('sd').showModal()\">Share</button>" : '';
  const shareDlg = share ? `<dialog id="sd" class="dlg">
    <h3>Share “${esc(slug)}”</h3>
    <label class="lbl">Password <small>(blank = auto-generate)</small>
      <input id="sdpw" autocomplete="off"></label>
    <div id="sdres" hidden>
      <input id="sdurl" readonly>
      <p class="hint">Password: <code id="sdpass"></code> — copy it now, it won't be shown again.</p>
    </div>
    <div class="dlg-row">
      <button id="sdcopy" hidden>Copy link</button>
      <button id="sdcreate" class="primary">Create link</button>
      <button onclick="document.getElementById('sd').close()">Close</button>
    </div>
    <script>(function(){
      var d=document,c=d.getElementById('sdcreate'),res=d.getElementById('sdres'),
          u=d.getElementById('sdurl'),p=d.getElementById('sdpass'),cp=d.getElementById('sdcopy');
      c.onclick=function(){c.disabled=true;c.textContent='Creating…';
        fetch('/share',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({slug:${JSON.stringify(slug)},version:${JSON.stringify(active)},
          password:d.getElementById('sdpw').value})})
        .then(function(r){return r.json()}).then(function(x){
          if(x.error)throw 0;u.value=x.url;p.textContent=x.password;
          res.hidden=false;cp.hidden=false;c.hidden=true;u.focus();u.select();
        }).catch(function(){c.disabled=false;c.textContent='Create link';alert('Failed to create link')});};
      cp.onclick=function(){u.select();try{navigator.clipboard.writeText(u.value)}catch(e){d.execCommand('copy')}};
    })();</script>
  </dialog>` : '';

  return page(`${label} — ${TITLE}`, `<div class="player">
    <div class="bar">${chrome}${shareBtn}<button onclick="f.requestFullscreen()">Fullscreen</button></div>
    <iframe id="f" src="/games/${slug}/${srcVersion}/index.html" title="${esc(slug)}"
      allow="cross-origin-isolated;fullscreen;autoplay;gamepad" allowfullscreen></iframe>
    </div>${shareDlg}`);
}

function authForm(token, error) {
  return page('Protected game', `<div class="box">
    <h1>🔒 Protected game</h1>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form method="post" action="/s/${esc(token)}">
      <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
      <button>Open</button>
    </form></div>`);
}

// --- app ------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');

// Compress responses — the big win for game loads over the public internet
// (the Godot engine .wasm is tens of MB and gzips down several-fold).
// .wasm isn't reliably flagged compressible, so force it; .pck stays raw
// (it's mostly already-compressed assets, so gzipping it just burns CPU).
app.use(compression({
  filter: (req, res) => {
    if (String(res.getHeader('Content-Type') || '').includes('wasm')) return true;
    return compression.filter(req, res);
  },
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Cross-origin isolation on every response — required for Godot 4 web exports.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

// Browsers auto-request this; answer quietly instead of logging a 404.
app.get('/favicon.ico', (req, res) => res.status(204).end());

if (!PUBLIC) {
  // ---- FULL mode (Tailnet) ----
  app.get('/', (req, res) => res.type('html').send(library()));

  app.get('/play/:slug/:version?', (req, res) => {
    const { slug } = req.params;
    const version = req.params.version || defaultVersion(slug);
    if (!valid(slug) || !version || !valid(version) || !has(slug, version)) return res.status(404).send('Not found');
    res.type('html').send(player(slug, version, { share: true }));
  });

  app.get('/games/:slug/:version/*', (req, res) => {
    const { slug, version } = req.params;
    if (!valid(slug) || !valid(version)) return res.status(404).end();
    sendGameFile(res, slug, version, req.params[0]);
  });

  // ---- Admin (share-link management). Tailnet-only by deployment. ----
  // Reject cross-site form posts (light CSRF guard); tailnet is trusted but
  // a user's browser could otherwise be lured into posting here.
  const sameOrigin = (req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).end(); }
      catch { return res.status(403).end(); }
    }
    next();
  };

  app.get('/admin', (req, res) => res.type('html').send(adminPage()));

  app.post('/admin/shares', sameOrigin, (req, res) => {
    const { slug, label, password } = req.body;
    if (!valid(slug) || !defaultVersion(slug)) return res.status(400).send('Unknown game');
    let version = (req.body.version && valid(req.body.version)) ? req.body.version : 'current';
    if (!has(slug, version)) version = defaultVersion(slug);
    const { token, password: pw } = auth.createShare({
      slug, version, password: password || undefined, label,
    });
    res.type('html').send(adminPage({ created: { token, password: pw } }));
  });

  app.post('/admin/shares/:token/delete', sameOrigin, (req, res) => {
    auth.removeShare(req.params.token);
    res.redirect('/admin');
  });

  // Quick-share endpoint used by the "Share" button in the player.
  app.post('/share', sameOrigin, (req, res) => {
    const { slug } = req.body || {};
    if (!valid(slug) || !defaultVersion(slug)) return res.status(400).json({ error: 'unknown game' });
    let version = (req.body.version && valid(req.body.version) && has(slug, req.body.version)) ? req.body.version : 'current';
    if (!has(slug, version)) version = defaultVersion(slug);
    const { token, password } = auth.createShare({ slug, version, password: req.body.password || undefined });
    res.json({ token, url: `${process.env.PUBLIC_URL || ''}/s/${token}`, password });
  });
} else {
  // ---- PUBLIC mode (internet) — share links + password only ----
  const FAILS = new Map(); // token -> { n, t } simple brute-force guard
  const limited = (t) => {
    const a = FAILS.get(t);
    if (!a) return false;
    if (Date.now() - a.t > 10 * 60 * 1000) { FAILS.delete(t); return false; }
    return a.n >= 8;
  };
  const noteFail = (t) => { const a = FAILS.get(t) || { n: 0, t: 0 }; FAILS.set(t, { n: a.n + 1, t: Date.now() }); };

  const readCookie = (req, name) => {
    const h = req.headers.cookie;
    if (!h) return null;
    for (const part of h.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  };

  // Resolve which game slugs the cookie's tokens grant access to (any version).
  function grants(req) {
    const tokens = auth.unsign(readCookie(req, 'acc'));
    const shares = auth.load();
    const slugs = new Set();
    for (const t of tokens) {
      const s = shares[t];
      if (s) slugs.add(s.slug);
    }
    return { tokens, slugs };
  }

  // Public library: shows only the games the visitor's cookie grants access
  // to (one card per game), each linking to its share entry.
  app.get('/', (req, res) => {
    const { tokens } = grants(req);
    const shares = auth.load();
    const seen = new Set();
    const cards = [];
    for (const t of tokens) {
      const s = shares[t];
      if (!s || !valid(s.slug) || seen.has(s.slug)) continue;
      const v = defaultVersion(s.slug);
      if (!v) continue;
      seen.add(s.slug);
      const name = s.slug; // web library names games by their games/ folder, not the label
      const cover = fs.existsSync(path.join(dir(s.slug, v), 'cover.png'))
        ? `<div class="cover"><img src="/games/${s.slug}/${v}/cover.png" alt="" loading="lazy"></div>`
        : `<div class="cover">${esc(name[0].toUpperCase())}</div>`;
      cards.push(`<a class="card" href="/s/${t}">${cover}<span>${esc(name)}</span></a>`);
    }
    if (!cards.length) {
      return res.type('html').send(
        page(TITLE, `<h1>${esc(TITLE)}</h1><p class="muted">Private library — access is by share link only.</p>`));
    }
    res.type('html').send(page(TITLE, `<h1>${esc(TITLE)}</h1><div class="grid">${cards.join('')}</div>`));
  });

  app.get('/s/:token', (req, res) => {
    const { token } = req.params;
    const share = auth.load()[token];
    if (!share || !valid(share.slug)) return res.status(404).send('Invalid link');
    const fallback = (valid(share.version) && has(share.slug, share.version)) ? share.version : defaultVersion(share.slug);
    if (!fallback) return res.status(404).send('Invalid link');
    if (grants(req).slugs.has(share.slug)) {
      // Any version of this game is allowed; ?v= selects, default = pinned/current.
      const active = (valid(req.query.v) && has(share.slug, req.query.v)) ? req.query.v : fallback;
      return res.type('html').send(player(share.slug, active, {
        back: '/', selectBase: `/s/${token}?v=`,
      }));
    }
    res.type('html').send(authForm(token));
  });

  app.post('/s/:token', (req, res) => {
    const { token } = req.params;
    const share = auth.load()[token];
    if (!share) return res.status(404).send('Invalid link');
    if (limited(token)) return res.status(429).type('html').send(authForm(token, 'Too many attempts, wait a few minutes.'));
    if (!auth.verifyPassword(req.body.password || '', share.pass)) {
      noteFail(token);
      return res.status(401).type('html').send(authForm(token, 'Wrong password'));
    }
    FAILS.delete(token);
    const { tokens } = grants(req);
    if (!tokens.includes(token)) tokens.push(token);
    res.cookie('acc', auth.sign(tokens), {
      httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/', maxAge: 30 * 24 * 3600 * 1000,
    });
    res.redirect(`/s/${token}`);
  });

  app.get('/games/:slug/:version/*', (req, res) => {
    const { slug, version } = req.params;
    if (!valid(slug) || !valid(version)) return res.status(404).end();
    if (!grants(req).slugs.has(slug)) return res.status(403).end();
    sendGameFile(res, slug, version, req.params[0]);
  });
}

app.listen(PORT, () => console.log(`[webui] ${TITLE} (${PUBLIC ? 'public' : 'full'}) — ${GAMES_DIR} on :${PORT}`));
