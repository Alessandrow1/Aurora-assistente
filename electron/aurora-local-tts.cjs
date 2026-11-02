const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const execFileAsync = promisify(execFile);
const KOKORO_ARCHIVE_URL = 'https://huggingface.co/cristianoaredes/kokoro-pt-br/resolve/main/letrinhas-kokoro-pt.zip';

function chooseModelDirectory(userDataPath) {
  const override = process.env.AURORA_VOICE_MODELS_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  if (process.platform === 'win32' && fs.existsSync('D:\\')) {
    return path.join('D:\\', 'AuroraVoiceModels', 'kokoro-pt-br');
  }
  return path.join(userDataPath, 'speech-synthesis', 'kokoro-pt-br');
}

function makeWavBuffer(samples, sampleRate) {
  if (!samples || typeof samples.length !== 'number' || samples.length < 1) {
    throw new Error('O Kokoro não retornou amostras de áudio.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error('O Kokoro retornou uma frequência de áudio inválida.');
  }
  const pcmBytes = samples.length * 2;
  const wav = Buffer.allocUnsafe(44 + pcmBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    const pcm = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
    wav.writeInt16LE(pcm, 44 + i * 2);
  }
  return wav;
}

async function findFile(root, fileName, maxDepth = 12) {
  if (maxDepth < 0) return null;
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return candidate;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '__MACOSX') continue;
    const found = await findFile(path.join(root, entry.name), fileName, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

async function findDirectory(root, directoryName, maxDepth = 12) {
  if (maxDepth < 0) return null;
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.toLowerCase() === directoryName.toLowerCase()) {
      return path.join(root, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '__MACOSX') continue;
    const found = await findDirectory(path.join(root, entry.name), directoryName, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

async function extractArchive(archivePath, destination) {
  await fsp.mkdir(destination, { recursive: true });
  if (process.platform === 'win32') {
    const quotePowerShell = (value) => "'" + value.replace(/'/g, "''") + "'";
    const command = 'Expand-Archive -LiteralPath ' + quotePowerShell(archivePath) +
      ' -DestinationPath ' + quotePowerShell(destination) + ' -Force';
    await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
    return;
  }
  await execFileAsync('unzip', ['-q', archivePath, '-d', destination], {
    timeout: 10 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function createAuroraLocalTts(options = {}) {
  const modelDirectory = options.modelDirectory
    ? path.resolve(options.modelDirectory)
    : chooseModelDirectory(options.userDataPath || process.cwd());
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const statusCallback = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const loadSherpa = typeof options.loadSherpa === 'function'
    ? options.loadSherpa
    : () => require('sherpa-onnx-node');
  let installPromise = null;
  let ttsPromise = null;
  let ttsInstance = null;

  const emitStatus = (state, message, extra = {}) => statusCallback({ state, message, ...extra });

  async function inspectModelFiles(rootDirectory = modelDirectory) {
    const [model, voices, tokens, espeakData] = await Promise.all([
      findFile(rootDirectory, 'model.onnx'),
      findFile(rootDirectory, 'voices.bin'),
      findFile(rootDirectory, 'tokens.txt'),
      findDirectory(rootDirectory, 'espeak-ng-data'),
    ]);
    const problems = [];
    const sizes = {};
    const inspectFile = async (label, filePath, minimumBytes) => {
      if (!filePath) {
        problems.push(label + ' não encontrado');
        return;
      }
      try {
        const stat = await fsp.stat(filePath);
        sizes[label] = stat.size;
        if (!stat.isFile()) problems.push(label + ' não é um arquivo');
        else if (stat.size < minimumBytes) {
          problems.push(label + ' incompleto (' + stat.size + ' bytes; esperado pelo menos ' + minimumBytes + ')');
        }
      } catch {
        problems.push(label + ' não pôde ser lido');
      }
    };
    await Promise.all([
      inspectFile('model.onnx', model, 250 * 1024 * 1024),
      inspectFile('voices.bin', voices, 1024 * 1024),
      // O tokens.txt upstream do Kokoro multi-lang v1.0 tem 687 bytes; 1 KiB rejeita o arquivo válido.
      inspectFile('tokens.txt', tokens, 512),
    ]);
    if (!espeakData) {
      problems.push('pasta espeak-ng-data não encontrada');
    } else {
      try {
        const entries = await fsp.readdir(espeakData);
        if (entries.length === 0) problems.push('pasta espeak-ng-data está vazia');
      } catch {
        problems.push('pasta espeak-ng-data não pôde ser lida');
      }
    }
    return {
      installed: problems.length === 0,
      files: model && voices && tokens && espeakData ? { model, voices, tokens, espeakData } : null,
      problems,
      sizes,
      rootDirectory,
    };
  }

  function describeModelInspection(inspection) {
    const details = inspection.problems.length
      ? inspection.problems.join('; ')
      : 'todos os arquivos essenciais foram encontrados';
    const sizes = Object.entries(inspection.sizes)
      .map(([name, size]) => name + ': ' + (size / (1024 * 1024)).toFixed(2) + ' MB')
      .join(', ');
    return 'Pasta analisada: ' + inspection.rootDirectory + '. ' + details +
      (sizes ? '. Tamanhos: ' + sizes : '');
  }

  async function getModelFiles(rootDirectory = modelDirectory) {
    const inspection = await inspectModelFiles(rootDirectory);
    return inspection.installed ? inspection.files : null;
  }

  async function isInstalled() {
    return Boolean(await getModelFiles());
  }

  async function install() {
    if (installPromise) return installPromise;
    installPromise = (async () => {
      const stagingDirectory = modelDirectory + '.installing';
      const archivePath = modelDirectory + '.download.zip';
      const installed = await getModelFiles();
      if (installed) {
        emitStatus('ready', 'Modelo de voz Kokoro pt-BR encontrado em ' + modelDirectory + '.');
        return installed;
      }

      // Recupera uma extração completa que tenha sobrado de uma tentativa anterior,
      // evitando baixar novamente os ~329 MB.
      const stagedInspection = await inspectModelFiles(stagingDirectory);
      if (stagedInspection.installed) {
        emitStatus('installing', 'Extração anterior do Kokoro validada. Finalizando a instalação sem novo download…');
        await fsp.rm(modelDirectory, { recursive: true, force: true });
        await fsp.rename(stagingDirectory, modelDirectory);
        const recovered = await getModelFiles();
        if (recovered) {
          await fsp.rm(archivePath, { force: true }).catch(() => undefined);
          emitStatus('installed', 'Kokoro pt-BR recuperado e validado em ' + modelDirectory + '.');
          return recovered;
        }
        const afterRecovery = await inspectModelFiles();
        throw new Error('A extração recuperada foi movida, mas a validação final falhou. ' + describeModelInspection(afterRecovery));
      }

      if (typeof fetchImpl !== 'function') throw new Error('Este ambiente não oferece suporte a downloads HTTPS.');
      await fsp.mkdir(path.dirname(modelDirectory), { recursive: true });
      await fsp.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      await fsp.rm(archivePath, { force: true }).catch(() => undefined);
      await fsp.mkdir(stagingDirectory, { recursive: true });

      let extractionCompleted = false;
      try {
        emitStatus('downloading', 'Baixando o modelo neural Kokoro para português brasileiro (~329 MB). O arquivo ficará em ' + modelDirectory + '.');
        const response = await fetchImpl(KOKORO_ARCHIVE_URL, { signal: AbortSignal.timeout(30 * 60 * 1000) });
        if (!response.ok || !response.body) throw new Error('Não consegui baixar o Kokoro (HTTP ' + response.status + ').');
        let downloaded = 0;
        let lastReportAt = 0;
        const progress = new Transform({
          transform(chunk, encoding, callback) {
            downloaded += chunk.length;
            if (downloaded > 900 * 1024 * 1024) {
              callback(new Error('O pacote de voz excedeu o limite de tamanho esperado.'));
              return;
            }
            const now = Date.now();
            if (now - lastReportAt > 1200) {
              lastReportAt = now;
              emitStatus('downloading', 'Baixando Kokoro: ' + (downloaded / 1024 / 1024).toFixed(0) + ' MB recebidos.');
            }
            callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(archivePath));
        const archiveStat = await fsp.stat(archivePath);
        if (archiveStat.size < 200 * 1024 * 1024) {
          throw new Error('O pacote Kokoro baixado parece incompleto (' + archiveStat.size + ' bytes). O arquivo ZIP precisa ter pelo menos 200 MB.');
        }

        emitStatus('extracting', 'Download concluído. Extraindo o modelo Kokoro e os dados de pronúncia…');
        await extractArchive(archivePath, stagingDirectory);
        extractionCompleted = true;

        // O pacote oficial pode vir com uma pasta-raiz. Mantemos sua estrutura e
        // resolvemos os caminhos recursivamente, em vez de copiar 330 MB arquivo a arquivo.
        const extractedInspection = await inspectModelFiles(stagingDirectory);
        if (!extractedInspection.installed) {
          throw new Error('O ZIP foi extraído, mas os arquivos não passaram na validação. ' +
            describeModelInspection(extractedInspection) +
            '. A pasta .installing foi preservada para diagnóstico; não é necessário repetir o download ainda.');
        }

        emitStatus('installing', 'Arquivos do Kokoro validados. Finalizando a instalação…');
        await fsp.rm(modelDirectory, { recursive: true, force: true });
        // stagingDirectory e modelDirectory ficam no mesmo volume; rename evita
        // recópia demorada e reduz o risco de instalação parcial no disco D:.
        await fsp.rename(stagingDirectory, modelDirectory);

        const result = await getModelFiles();
        if (!result) {
          const finalInspection = await inspectModelFiles();
          throw new Error('A instalação foi movida, mas não passou na validação final. ' +
            describeModelInspection(finalInspection));
        }

        await fsp.rm(archivePath, { force: true }).catch(() => undefined);
        emitStatus('installed', 'Kokoro pt-BR instalado e validado. Preparando a voz local…');
        return result;
      } catch (error) {
        await fsp.rm(archivePath, { force: true }).catch(() => undefined);
        if (!extractionCompleted) {
          await fsp.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
        throw error;
      }
    })();
    try { return await installPromise; } finally { installPromise = null; }
  }

  async function load() {
    if (ttsInstance) return ttsInstance;
    if (ttsPromise) return ttsPromise;
    ttsPromise = (async () => {
      const files = await getModelFiles();
      if (!files) {
        throw new Error('A voz Kokoro pt-BR ainda não foi instalada. Abra Configurações e use “Instalar voz local”; o modelo será salvo em ' + modelDirectory + '.');
      }
      emitStatus('loading', 'Carregando Kokoro pt-BR na memória…');
      const sherpa = loadSherpa();
      if (!sherpa || !sherpa.OfflineTts) throw new Error('A instalação local do sherpa-onnx não oferece OfflineTts.');
      const threadCount = Math.max(2, Math.min(4, os.cpus().length || 2));
      const config = {
        model: {
          kokoro: {
            model: files.model,
            voices: files.voices,
            tokens: files.tokens,
            dataDir: files.espeakData,
            lang: 'pt',
          },
          numThreads: threadCount,
          provider: 'cpu',
          debug: false,
        },
        maxNumSentences: 1,
      };
      const instance = typeof sherpa.OfflineTts.createAsync === 'function'
        ? await sherpa.OfflineTts.createAsync(config)
        : new sherpa.OfflineTts(config);
      ttsInstance = { instance, sherpa };
      emitStatus('ready', 'Voz neural Kokoro pt-BR pronta. Processamento totalmente local.');
      return ttsInstance;
    })();
    try {
      return await ttsPromise;
    } catch (error) {
      ttsPromise = null;
      emitStatus('error', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function synthesize(rawText) {
    const text = typeof rawText === 'string' ? rawText.trim().slice(0, 4200) : '';
    if (!text) throw new Error('Não há texto para sintetizar.');
    const startedAt = Date.now();
    const loaded = await load();
    const sherpa = loaded.sherpa;
    const generationConfig = sherpa.GenerationConfig
      ? new sherpa.GenerationConfig({ sid: 42, speed: 1.04, silenceScale: 0.18 })
      : { sid: 42, speed: 1.04, silenceScale: 0.18 };
    const audio = typeof loaded.instance.generateAsync === 'function'
      ? await loaded.instance.generateAsync({ text, generationConfig, enableExternalBuffer: true })
      : loaded.instance.generate({ text, generationConfig });
    const wav = makeWavBuffer(audio.samples, audio.sampleRate);
    emitStatus('ready', 'Voz Kokoro gerada localmente.', {
      synthesisMs: Date.now() - startedAt,
      audioSeconds: Number((audio.samples.length / audio.sampleRate).toFixed(2)),
    });
    return wav;
  }

  async function getStatus() {
    const installed = await isInstalled().catch(() => false);
    return {
      installed,
      ready: Boolean(ttsInstance),
      modelDirectory,
      voice: 'pf_dora',
      language: 'pt-BR',
      provider: 'kokoro-local',
    };
  }

  async function dispose() {
    const active = ttsInstance;
    ttsInstance = null;
    ttsPromise = null;
    if (active && active.instance && typeof active.instance.release === 'function') {
      await active.instance.release();
    }
  }

  async function prepare() {
    await load();
    return await getStatus();
  }

  return { install, prepare, synthesize, getStatus, dispose, modelDirectory };
}

module.exports = { createAuroraLocalTts, makeWavBuffer, chooseModelDirectory };
