const { app, BrowserWindow, ipcMain, session, desktopCapturer, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

const OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.5:2b';
const ALLOWED_MODELS = new Set(['qwen3.5:2b', 'qwen3.5:4b', 'qwen3.5:9b']);

let mainWindow;
const settingsPath = () => path.join(app.getPath('userData'), 'aurora-settings.json');

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { model: ALLOWED_MODELS.has(saved.model) ? saved.model : DEFAULT_MODEL };
  } catch {
    return { model: DEFAULT_MODEL };
  }
}

function writeSettings(settings) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), { encoding: 'utf8' });
}

async function getOllamaModels() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { available: false, models: [] };
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((model) => model.name).filter(Boolean) : [];
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  }
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const petWidth = 380;
  const petHeight = Math.min(720, Math.max(560, area.height - 32));
  mainWindow = new BrowserWindow({
    width: petWidth,
    height: petHeight,
    x: Math.max(area.x, area.x + area.width - petWidth - 12),
    y: Math.max(area.y, area.y + area.height - petHeight - 12),
    minWidth: petWidth,
    minHeight: petHeight,
    maxWidth: petWidth,
    maxHeight: petHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  const distIndexPath = path.join(__dirname, '..', 'dist', 'index.html');
  // Em desenvolvimento, o Vite serve a interface em localhost. Na versão
  // empacotada, o Electron carrega o arquivo gerado em dist/index.html.
  const devUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://127.0.0.1:5173' : null);

  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(distIndexPath);
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('aurora:version', () => app.getVersion());

ipcMain.handle('aurora:get-config', async () => {
  const settings = readSettings();
  const ollama = await getOllamaModels();
  return {
    model: settings.model,
    ollamaAvailable: ollama.available,
    installedModels: ollama.models,
    modelInstalled: ollama.models.some((name) => name === settings.model || name.startsWith(`${settings.model}-`)),
  };
});

ipcMain.handle('aurora:check-ollama', async () => {
  const ollama = await getOllamaModels();
  const model = readSettings().model;
  return {
    ollamaAvailable: ollama.available,
    installedModels: ollama.models,
    modelInstalled: ollama.models.some((name) => name === model || name.startsWith(`${model}-`)),
  };
});

ipcMain.handle('aurora:save-settings', (_event, payload = {}) => {
  const current = readSettings();
  const candidate = typeof payload.model === 'string' ? payload.model.trim() : current.model;
  const model = ALLOWED_MODELS.has(candidate) ? candidate : current.model;
  writeSettings({ model });
  return { model };
});

ipcMain.handle('aurora:chat', async (_event, payload = {}) => {
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (!message) throw new Error('Escreva uma mensagem para a Aurora.');

  const settings = readSettings();
  const ollama = await getOllamaModels();
  if (!ollama.available) {
    throw new Error('Não encontrei o Ollama em execução. Instale o Ollama e abra o programa; a Aurora usa a IA local do seu computador, sem API paga.');
  }
  const modelInstalled = ollama.models.some((name) => name === settings.model || name.startsWith(`${settings.model}-`));
  if (!modelInstalled) {
    throw new Error(`O modelo ${settings.model} ainda não foi baixado. Feche a Aurora e execute INSTALAR-IA-GRATUITA.bat na pasta do projeto.`);
  }

  const history = Array.isArray(payload.history)
    ? payload.history
        .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
        .slice(-6)
        .map((item) => ({ role: item.role, content: item.content.slice(0, 1400) }))
    : [];

  const imageBase64 = typeof payload.imageBase64 === 'string' && payload.imageBase64.length <= 18000000
    ? payload.imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
    : '';

  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        model: settings.model,
        stream: false,
        think: false,
        keep_alive: '10m',
        messages: [
          {
            role: 'system',
            content: [
              'Você é Aurora, uma assistente virtual de desktop que conversa em português brasileiro.',
              'Converse como uma pessoa inteligente e próxima: use português brasileiro natural, frases com ritmo variado e palavras simples. Evite soar como manual, robô, atendente formal ou texto corporativo.',
              'Não comece todas as respostas com saudações, não repita o nome do usuário sem necessidade e não use listas quando uma conversa curta for melhor.',
              'Seja calorosa e espirituosa sem exagerar em emojis, intimidade ou elogios. Responda primeiro ao que foi perguntado e só depois acrescente detalhes úteis.',
              'Sua personalidade é acolhedora, inteligente, bem-humorada com moderação, prática e respeitosa.',
              'Seja natural e objetiva. Explique termos técnicos com claridade.',
              'Vopé ainda não controla programas, arquivos ou a tela do computador. Nunca diga que executou ações que não realizou.',
              'Não invente informações. Quando não souber, admita.',
            ]
            .join(' '),
          },
          ...history,
          { role: 'user', content: message, ...(imageBase64 ? { images: [imageBase64] } : {}) },
        ],
        options: { temperature: 0.65, num_predict: 300, num_ctx: 4096 },
      }),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('A resposta demorou demais. Tente um modelo menor ou envie uma pergunta mais curta.');
    throw new Error('Não consegui acessar a IA local do Ollama. Verifique se o Ollama continua aberto.');
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`O Ollama retornou um erro (${response.status}). ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  return { text: data.message?.content?.trim() || 'Não consegui formular uma resposta desta vez.' };
});

ipcMain.handle('aurora:speak', async (_event, rawText) => {
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, 4200) : '';
  if (!text) throw new Error('Não há texto para transformar em fala.');

  let EdgeTTS;
  try {
    ({ EdgeTTS } = require('node-edge-tts'));
  } catch {
    throw new Error('O mecanismo de voz neural ainda não foi instalado. Feche a Aurora e execute ATUALIZAR-AURORA.bat.');
  }

  const cleanText = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#*_>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const audioPath = path.join(app.getPath('temp'), `aurora-francisca-${process.pid}-${Date.now()}.mp3`);
  const tts = new EdgeTTS({
    voice: 'pt-BR-ThalitaNeural',
    lang: 'pt-BR',
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    rate: '+5%',
    pitch: '+18Hz',
    timeout: 30000,
  });

  try {
    await tts.ttsPromise(cleanText, audioPath);
    const audio = await fsp.readFile(audioPath);
    return { audioBase64: audio.toString('base64'), voice: 'pt-BR-ThalitaNeural' };
  } catch (error) {
    throw new Error('Não consegui gerar a voz neural. Confira sua conexão com a internet e tente novamente.');
  } finally {
    await fsp.rm(audioPath, { force: true }).catch(() => undefined);
  }
});


ipcMain.handle('aurora:capture-screen', async () => {
  const wasVisible = Boolean(mainWindow?.isVisible());
  try {
    if (wasVisible) mainWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1600, height: 900 },
      fetchWindowIcons: false,
    });
    const source = sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('Não consegui capturar a tela. Verifique se há um monitor ativo.');
    }
    const image = source.thumbnail.resize({ width: 1280, quality: 'good' });
    const size = image.getSize();
    return {
      imageBase64: image.toJPEG(78).toString('base64'),
      width: size.width,
      height: size.height,
    };
  } finally {
    if (wasVisible && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }
});

const SAFE_APPS = {
  calculator: { command: 'calc.exe', label: 'Calculadora' },
  notepad: { command: 'notepad.exe', label: 'Bloco de Notas' },
  explorer: { command: 'explorer.exe', label: 'Explorador de Arquivos' },
  paint: { command: 'mspaint.exe', label: 'Paint' },
  taskmgr: { command: 'taskmgr.exe', label: 'Gerenciador de Tarefas' },
};

ipcMain.handle('aurora:open-app', async (_event, appId) => {
  const appInfo = SAFE_APPS[appId];
  if (!appInfo) throw new Error('Esse aplicativo ainda não está na lista de comandos permitidos.');
  const child = spawn(appInfo.command, [], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { success: true, label: appInfo.label };
});

ipcMain.handle('aurora:open-folder', async (_event, folderId) => {
  const allowedPaths = {
    desktop: app.getPath('desktop'),
    documents: app.getPath('documents'),
    downloads: path.join(app.getPath('home'), 'Downloads'),
    pictures: app.getPath('pictures'),
  };
  const target = allowedPaths[folderId];
  if (!target) throw new Error('Essa pasta não está na lista de locais permitidos.');
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
  return { success: true, label: folderId };
});

ipcMain.handle('aurora:open-url', async (_event, rawUrl) => {
  if (typeof rawUrl !== 'string') throw new Error('Endereço inválido.');
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('Endereço inválido.'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Por segurança, só posso abrir endereços HTTP ou HTTPS.');
  await shell.openExternal(parsed.toString());
  return { success: true };
});

ipcMain.on('aurora:minimize', () => mainWindow?.minimize());
ipcMain.on('aurora:close', () => mainWindow?.close());
