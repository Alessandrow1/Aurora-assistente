'use strict';

const http = require('node:http');

const KINDS = new Set(['voce', 'aurora', 'aviso', 'erro']);
const TONES = new Set(['rec', 'work', 'aurora', 'idle', 'off']);

const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aurora: acompanhamento</title>
<style>
  :root { --bg:#12101f; --card:#1c1933; --ink:#f1edff; --mut:#a9a3c6; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.45 system-ui, 'Segoe UI', Arial, sans-serif; }
  header { position:sticky; top:0; z-index:5; background:var(--bg); padding:14px 18px 10px; border-bottom:1px solid #2e2a4d; }
  #stage { display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:12px; font-size:22px; font-weight:800; background:#26233f; }
  #stage .dot { width:16px; height:16px; border-radius:50%; background:#8a86a8; flex:none; }
  #stage.rec { background:#4a1d27; color:#ffd3d9; } #stage.rec .dot { background:#ff5264; animation:p 1s infinite; }
  #stage.work { background:#4a3a12; color:#ffe6a8; } #stage.work .dot { background:#f0b429; animation:p 1s infinite; }
  #stage.aurora { background:#35285f; color:#e4d8ff; } #stage.aurora .dot { background:#b79bff; animation:p 1.2s infinite; }
  #stage.idle { background:#1c3552; color:#cfe6ff; } #stage.idle .dot { background:#5aa9ff; }
  @keyframes p { 50% { opacity:.3; } }
  .legend { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; font-size:14px; align-items:center; }
  .chip { padding:3px 11px; border-radius:999px; border:2px solid; background:#ffffff0a; }
  .voce { border-color:#5aa9ff; } .aurora { border-color:#b79bff; } .aviso { border-color:#f0b429; } .erro { border-color:#ff6b81; }
  .chip.voce { color:#8cc4ff; } .chip.aurora { color:#cdb9ff; } .chip.aviso { color:#ffd070; } .chip.erro { color:#ff9aa9; }
  #conn { margin-left:auto; color:var(--mut); font-size:13px; }
  button { font:inherit; font-size:14px; border:0; border-radius:8px; padding:4px 12px; color:var(--ink); background:#ffffff1a; cursor:pointer; }
  button:hover { background:#9a84ff55; }
  #ptt { display:block; width:100%; margin-top:10px; padding:14px; font-size:20px; font-weight:800; border-radius:12px; background:#3b6fd8; }
  #ptt:hover { background:#4d82f0; }
  main { max-width:900px; margin:0 auto; padding:14px 18px 60px; }
  .empty { color:var(--mut); padding:24px 4px; font-size:18px; }
  .item { margin:10px 0; padding:10px 14px; border-radius:10px; border-left:8px solid; background:var(--card); }
  .item.voce { background:#17293f; border-left-color:#5aa9ff; } .item.aurora { background:#271f45; border-left-color:#b79bff; }
  .item.aviso { background:#2f2812; border-left-color:#f0b429; } .item.erro { background:#3a1620; border-left-color:#ff6b81; }
  .head { display:flex; gap:10px; align-items:baseline; font-size:13px; color:var(--mut); }
  .badge { font-weight:800; font-size:15px; letter-spacing:.03em; }
  .voce .badge { color:#8cc4ff; } .aurora .badge { color:#cdb9ff; } .aviso .badge { color:#ffd070; } .erro .badge { color:#ff9aa9; }
  .time { margin-left:auto; font-variant-numeric:tabular-nums; }
  .text { margin-top:4px; font-size:19px; white-space:pre-wrap; word-break:break-word; }
  .meta { margin-top:4px; color:var(--mut); font-size:13px; }
</style>
</head>
<body>
<header>
  <div id="stage" class="off"><span class="dot"></span><span id="stage-text">Conectando ao app…</span></div>
  <div id="mode" style="margin-top:8px;color:#a9a3c6;font-size:14px"></div>
  <button id="ptt" type="button">🎙 Gravar / Enviar (ou aperte C nesta página)</button>
  <div class="legend">
    <span class="chip voce">🎤 VOCÊ: o que você disse, enviado para a Aurora</span>
    <span class="chip aurora">✦ AURORA: o que ela respondeu</span>
    <span class="chip aviso">ℹ️ AVISO: orientação para você (não é ela falando)</span>
    <span class="chip erro">⚠️ PROBLEMA</span>
    <span id="conn">conectando…</span>
    <button id="clear" type="button">limpar tela</button>
  </div>
</header>
<main id="list"><div class="empty">Nada ainda. Na janela da Aurora, aperte C, fale, e aperte C de novo.</div></main>
<script>
  var LABELS = { voce: ['🎤 VOCÊ', 'o que você disse'], aurora: ['✦ AURORA', 'o que ela respondeu'], aviso: ['ℹ️ AVISO', 'para você, não é a Aurora falando'], erro: ['⚠️ PROBLEMA', 'algo deu errado'] };
  var list = document.getElementById('list'), stage = document.getElementById('stage'), stageText = document.getElementById('stage-text'), conn = document.getElementById('conn');
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function setStage(s) { stage.className = s.tone; stageText.textContent = s.text; }
  function setMode(m) { var b = document.getElementById('ptt'); b.style.display = m === 'vad' ? 'none' : ''; document.getElementById('mode').textContent = m === 'vad' ? 'Modo VAD: fale normalmente, a Aurora detecta quando você termina.' : 'Modo botão: clique em Gravar, fale, e clique de novo para enviar.'; }
  function add(item) {
    var empty = list.querySelector('.empty'); if (empty) empty.remove();
    var box = el('div', 'item ' + item.kind), head = el('div', 'head');
    head.appendChild(el('span', 'badge', LABELS[item.kind][0])); head.appendChild(el('span', '', LABELS[item.kind][1]));
    head.appendChild(el('span', 'time', new Date(item.at).toLocaleTimeString('pt-BR', { hour12: false })));
    box.appendChild(head); box.appendChild(el('div', 'text', item.kind === 'voce' ? '“' + item.text + '”' : item.text));
    if (item.meta) box.appendChild(el('div', 'meta', item.meta));
    list.appendChild(box); window.scrollTo(0, document.body.scrollHeight);
  }
  document.getElementById('clear').onclick = function () { list.textContent = ''; list.appendChild(el('div', 'empty', 'Tela limpa.')); };
  function toggleRecording() {
    fetch('/ptt', { method: 'POST', headers: { 'X-Aurora-Token': '__TOKEN__' } }).then(function (r) {
      if (!r.ok) conn.textContent = 'o app recusou o comando (' + r.status + ')';
    }).catch(function () { conn.textContent = 'sem conexão com o app'; });
  }
  document.getElementById('ptt').onclick = toggleRecording;
  document.addEventListener('keydown', function (e) {
    if (e.key.toLowerCase() === 'c' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); toggleRecording(); }
  });
  var es = new EventSource('/events');
  es.onopen = function () { conn.textContent = 'ligado ao app'; };
  es.onerror = function () { conn.textContent = 'sem conexão com o app, tentando de novo…'; };
  es.addEventListener('snapshot', function (e) { var d = JSON.parse(e.data); setMode(d.mode); setStage(d.stage); list.textContent = ''; if (!d.items.length) list.appendChild(el('div', 'empty', 'Nada ainda. Na janela da Aurora, aperte C, fale, e aperte C de novo.')); d.items.forEach(add); });
  es.addEventListener('item', function (e) { add(JSON.parse(e.data)); });
  es.addEventListener('stage', function (e) { setStage(JSON.parse(e.data)); });
</script>
</body>
</html>`;

function cleanItem(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind) || typeof raw.text !== 'string') return null;
  const text = raw.text.trim().slice(0, 700);
  if (!text) return null;
  return {
    id: Number(raw.id) || 0,
    at: Number(raw.at) || Date.now(),
    kind: raw.kind,
    text,
    ...(typeof raw.meta === 'string' && raw.meta ? { meta: raw.meta.slice(0, 200) } : {}),
  };
}

function cleanStage(raw) {
  if (!raw || typeof raw !== 'object' || !TONES.has(raw.tone) || typeof raw.text !== 'string') return null;
  return { tone: raw.tone, text: raw.text.slice(0, 200) };
}

function createFeedServer({ port = 17070, host = '127.0.0.1', max = 100, onCommand = null, mode = 'botao' } = {}) {
  const token = require('node:crypto').randomBytes(16).toString('hex');
  const page = PAGE.split('__TOKEN__').join(token);
  const items = [];
  let stage = { tone: 'off', text: 'Aguardando o app…' };
  const clients = new Set();
  let actualPort = port;
  let server = null;
  let heartbeat = null;

  const sse = (res, event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  const broadcast = (event, data) => { for (const client of clients) sse(client, event, data); };
  const hostAllowed = (req) => {
    const value = String(req.headers.host || '').toLowerCase();
    return value === host + ':' + actualPort || value === 'localhost:' + actualPort;
  };

  function handle(req, res) {
    if (!hostAllowed(req)) { res.writeHead(403); res.end('Endereço não permitido.'); return; }
    if (req.method === 'POST' && req.url === '/ptt') {
      if (req.headers['x-aurora-token'] !== token || typeof onCommand !== 'function') { res.writeHead(403); res.end(); return; }
      onCommand('ptt');
      res.writeHead(204); res.end();
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(page);
    } else if (req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ stage, items, mode }));
    } else if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      sse(res, 'snapshot', { stage, items, mode });
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(404); res.end();
    }
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer(handle);
        server.once('error', reject);
        server.listen(port, host, () => {
          actualPort = server.address().port;
          heartbeat = setInterval(() => { for (const client of clients) client.write(': ping\n\n'); }, 15000);
          heartbeat.unref();
          resolve(actualPort);
        });
      });
    },
    push(raw) {
      const item = cleanItem(raw);
      if (!item) return false;
      items.push(item);
      if (items.length > max) items.shift();
      broadcast('item', item);
      return true;
    },
    setStage(raw) {
      const next = cleanStage(raw);
      if (!next) return false;
      if (next.tone === stage.tone && next.text === stage.text) return true;
      stage = next;
      broadcast('stage', stage);
      return true;
    },
    close() {
      if (heartbeat) clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
      return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
    },
    get port() { return actualPort; },
  };
}

module.exports = { createFeedServer };
