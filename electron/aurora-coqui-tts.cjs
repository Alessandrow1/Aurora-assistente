'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createAuroraCoquiTts({
  app,
  spawnImpl = spawn,
  rootDirectory = null,
  workerPath = null,
  onStatus = () => {},
} = {}) {
  if (!app && !rootDirectory) throw new Error('Informe o diretório de dados da Aurora para o Coqui.');
  const defaultRoot = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Aurora', 'coqui-xtts')
    : path.join(app ? app.getPath('userData') : os.tmpdir(), 'coqui-xtts');
  const root = process.env.AURORA_COQUI_HOME || rootDirectory || defaultRoot;
  const pythonPath = process.platform === 'win32'
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
  const acceptancePath = path.join(root, 'CPML-ACCEPTED.txt');
  const installedMarkerPath = path.join(root, 'ENV-READY.txt');
  const resolvedWorkerPath = workerPath || path.join(__dirname, '..', 'tools', 'coqui-xtts', 'worker.py');

  let child = null;
  let outputBuffer = '';
  let workerReady = false;
  let modelLoaded = false;
  let nextRequestId = 1;
  const pending = new Map();

  const report = (status) => {
    try { onStatus(status); } catch { /* status não pode derrubar a síntese */ }
  };

  function getStatus() {
    const licenseText = (() => {
      try { return fs.readFileSync(acceptancePath, 'utf8'); } catch { return ''; }
    })();
    return {
      installed: fs.existsSync(pythonPath) && fs.existsSync(installedMarkerPath),
      licenseAccepted: /CPML ACCEPTED BY USER/i.test(licenseText),
      ready: workerReady,
      modelLoaded,
      provider: 'coqui-xtts',
      model: 'XTTS-v2',
      language: 'pt',
      device: 'cpu',
      installDirectory: root,
      pythonPath,
      workerAvailable: fs.existsSync(resolvedWorkerPath),
    };
  }

  function rejectPending(error) {
    for (const [id, request] of pending) {
      clearTimeout(request.timeout);
      request.reject(error);
      pending.delete(id);
    }
  }

  function handleLine(line) {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch {
      console.warn('[Aurora Coqui] Saída não JSON do worker:', line.slice(0, 220));
      return;
    }

    if (message.type === 'status') {
      if (message.state === 'ready') workerReady = true;
      if (message.state === 'model-loaded') modelLoaded = true;
      report({ ...message, provider: 'coqui-xtts' });
      return;
    }

    const request = pending.get(String(message.id || ''));
    if (!request) return;
    pending.delete(String(message.id));
    clearTimeout(request.timeout);
    if (message.ok !== true) {
      request.reject(new Error(String(message.error || 'O Coqui XTTS não conseguiu gerar a fala.').slice(0, 800)));
      return;
    }
    request.resolve({
      audioBase64: message.audioBase64,
      audioMimeType: 'audio/wav',
      voice: message.speaker || 'Ana Florence',
      provider: 'coqui-xtts',
      performance: message.performance || null,
    });
  }

  function startWorker() {
    if (child && !child.killed) return;
    const status = getStatus();
    if (!status.installed) {
      throw new Error('O ambiente Python do Coqui não está instalado. Execute scripts\\install-coqui-xtts.ps1.');
    }
    if (!status.licenseAccepted) {
      throw new Error('Antes de usar XTTS-v2, leia a licença CPML e aceite-a pelo instalador do Coqui.');
    }
    if (!status.workerAvailable) {
      throw new Error('O worker tools/coqui-xtts/worker.py não foi encontrado na instalação da Aurora.');
    }

    workerReady = false;
    modelLoaded = false;
    const processHandle = spawnImpl(pythonPath, ['-u', resolvedWorkerPath], {
      cwd: path.dirname(resolvedWorkerPath),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        COQUI_TOS_AGREED: '1',
        OMP_NUM_THREADS: process.env.AURORA_COQUI_THREADS || '6',
        MKL_NUM_THREADS: process.env.AURORA_COQUI_THREADS || '6',
        AURORA_COQUI_THREADS: process.env.AURORA_COQUI_THREADS || '6',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
      },
    });
    child = processHandle;
    outputBuffer = '';

    processHandle.stdout.setEncoding('utf8');
    processHandle.stdout.on('data', (chunk) => {
      outputBuffer += chunk;
      let newline = outputBuffer.indexOf('\n');
      while (newline >= 0) {
        handleLine(outputBuffer.slice(0, newline));
        outputBuffer = outputBuffer.slice(newline + 1);
        newline = outputBuffer.indexOf('\n');
      }
    });
    processHandle.stderr.on('data', (chunk) => {
      const detail = String(chunk || '').trim();
      if (detail) console.info('[Aurora Coqui]', detail.slice(0, 700));
    });
    processHandle.on('error', (error) => {
      if (child === processHandle) child = null;
      workerReady = false;
      rejectPending(new Error('Não consegui iniciar o processo Python do Coqui: ' + error.message));
      report({ type: 'status', state: 'error', message: error.message, provider: 'coqui-xtts' });
    });
    processHandle.on('close', (code) => {
      if (child === processHandle) child = null;
      workerReady = false;
      modelLoaded = false;
      rejectPending(new Error('O processo Coqui XTTS foi encerrado (código ' + code + ').'));
    });
  }

  async function synthesize(rawText, options = {}) {
    const text = typeof rawText === 'string' ? rawText.trim().slice(0, 1800) : '';
    if (!text) throw new Error('Digite uma frase para testar a voz Coqui.');
    startWorker();

    const id = String(nextRequestId++);
    const speaker = typeof options.speaker === 'string' && options.speaker.trim()
      ? options.speaker.trim().slice(0, 80)
      : 'Ana Florence';

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('O Coqui XTTS demorou mais de 10 minutos. Confira o console da Aurora.'));
      }, 10 * 60 * 1000);
      timeout.unref?.();
      pending.set(id, { resolve, reject, timeout });
      const payload = JSON.stringify({ id, action: 'synthesize', text, language: 'pt', speaker }) + '\n';
      child.stdin.write(payload, 'utf8', (error) => {
        if (!error) return;
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        clearTimeout(request.timeout);
        reject(error);
      });
    });
  }

  async function dispose() {
    const active = child;
    child = null;
    workerReady = false;
    modelLoaded = false;
    rejectPending(new Error('O Coqui XTTS foi encerrado.'));
    if (active && !active.killed) {
      try { active.kill(); } catch { /* processo já finalizado */ }
    }
  }

  return { getStatus, synthesize, dispose };
}

module.exports = { createAuroraCoquiTts };
