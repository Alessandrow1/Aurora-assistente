'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createFeedServer } = require('./aurora-feed-server.cjs');

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'] }));
    });
    req.on('error', reject);
  });
}

test('serve a página e o estado, só no endereço local', async () => {
  const server = createFeedServer({ port: 0 });
  const port = await server.start();
  try {
    const page = await get(port, '/');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.body, /Aurora: acompanhamento/);

    assert.equal(server.push({ id: 1, at: 1, kind: 'voce', text: 'olá aurora', meta: 'áudio de 2 s' }), true);
    server.setStage({ tone: 'work', text: 'A AURORA ESTÁ PENSANDO…' });
    const state = JSON.parse((await get(port, '/state')).body);
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].text, 'olá aurora');
    assert.equal(state.stage.tone, 'work');

    assert.equal((await get(port, '/state', { Host: 'evil.example.com' })).status, 403);
    assert.equal((await get(port, '/nada')).status, 404);
  } finally {
    await server.close();
  }
});

test('ignora itens inválidos e limita o tamanho do histórico', async () => {
  const server = createFeedServer({ port: 0, max: 3 });
  await server.start();
  try {
    assert.equal(server.push({ kind: 'hacker', text: 'x' }), false);
    assert.equal(server.push({ kind: 'aviso', text: '   ' }), false);
    assert.equal(server.push('texto solto'), false);
    assert.equal(server.setStage({ tone: 'roxo', text: 'x' }), false);
    for (let i = 1; i <= 5; i += 1) server.push({ id: i, at: i, kind: 'aviso', text: 'aviso ' + i });
    const state = JSON.parse((await get(server.port, '/state')).body);
    assert.deepEqual(state.items.map((item) => item.text), ['aviso 3', 'aviso 4', 'aviso 5']);
  } finally {
    await server.close();
  }
});

test('envia o histórico e os novos itens por eventos (SSE)', async () => {
  const server = createFeedServer({ port: 0 });
  const port = await server.start();
  server.push({ id: 1, at: 1, kind: 'aurora', text: 'primeira' });
  try {
    const received = await new Promise((resolve, reject) => {
      let data = '';
      const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (data.includes('event: snapshot') && !data.includes('event: item')) {
            server.push({ id: 2, at: 2, kind: 'voce', text: 'segunda' });
          }
          if (data.includes('event: item')) { req.destroy(); resolve(data); }
        });
      });
      req.on('error', (error) => (error.code === 'ECONNRESET' ? undefined : reject(error)));
      setTimeout(() => reject(new Error('sem eventos')), 3000).unref();
    });
    assert.match(received, /event: snapshot[\s\S]*primeira/);
    assert.match(received, /event: item\ndata: .*segunda/);
  } finally {
    await server.close();
  }
});

function post(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('o botão de gravar só funciona com o código da própria página', async () => {
  const commands = [];
  const server = createFeedServer({ port: 0, onCommand: (command) => commands.push(command) });
  const port = await server.start();
  try {
    const page = (await get(port, '/')).body;
    const token = page.match(/'X-Aurora-Token': '([0-9a-f]{32})'/)[1];
    assert.equal(await post(port, '/ptt'), 403);
    assert.equal(await post(port, '/ptt', { 'X-Aurora-Token': 'errado' }), 403);
    assert.equal(await post(port, '/ptt', { 'X-Aurora-Token': token, Host: 'evil.example.com' }), 403);
    assert.deepEqual(commands, []);
    assert.equal(await post(port, '/ptt', { 'X-Aurora-Token': token }), 204);
    assert.deepEqual(commands, ['ptt']);
    assert.doesNotMatch((await get(port, '/state')).body, new RegExp(token));
  } finally {
    await server.close();
  }
});

test('informa o modo de voz para a página esconder o botão no modo VAD', async () => {
  const server = createFeedServer({ port: 0, mode: 'vad' });
  const port = await server.start();
  try {
    assert.equal(JSON.parse((await get(port, '/state')).body).mode, 'vad');
    assert.match((await get(port, '/')).body, /function setMode/);
  } finally {
    await server.close();
  }
});
