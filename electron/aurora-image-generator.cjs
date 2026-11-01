'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const COMFY_URL = 'http://127.0.0.1:8188';
const MAX_PROMPT_LENGTH = 2000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_NEGATIVE_PROMPT = 'low quality, blurry, pixelated, distorted anatomy, extra fingers, extra limbs, text, watermark, logo';

function nodeChoices(payload, nodeName, inputName) {
  const node = payload?.[nodeName];
  const value = node?.input?.required?.[inputName];
  const choices = Array.isArray(value) && Array.isArray(value[0]) ? value[0] : [];
  return choices.filter((item) => typeof item === 'string' && item.length > 0);
}

function imageMime(buffer, headerValue = '') {
  const header = String(headerValue || '').split(';')[0].trim().toLowerCase();
  if (header === 'image/png' || header === 'image/jpeg' || header === 'image/webp') return header;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('O ComfyUI retornou um arquivo que não parece ser uma imagem PNG, JPEG ou WebP.');
}

function describeHttpError(response, body) {
  const detail = typeof body === 'string' ? body.trim().slice(0, 500) : '';
  return `ComfyUI respondeu HTTP ${response.status}${detail ? `: ${detail}` : '.'}`;
}

function createAuroraImageGenerator({
  app,
  fetchImpl = globalThis.fetch,
  onStatus = () => undefined,
  pollIntervalMs = 1200,
  timeoutMs = 6 * 60 * 1000,
} = {}) {
  if (!app || typeof app.getPath !== 'function') throw new Error('O gerador de imagens precisa do caminho local de dados do aplicativo.');
  if (typeof fetchImpl !== 'function') throw new Error('O ambiente não oferece suporte a requisições HTTP.');

  const outputDirectory = () => path.join(app.getPath('userData'), 'generated-images');

  async function requestJson(route, options = {}, timeout = 8000) {
    const response = await fetchImpl(`${COMFY_URL}${route}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(describeHttpError(response, body));
    }
    return await response.json();
  }

  async function getNodeInfo(nodeName) {
    const payload = await requestJson(`/object_info/${encodeURIComponent(nodeName)}`);
    return payload?.[nodeName] || null;
  }

  async function getStatus() {
    try {
      const info = await getNodeInfo('CheckpointLoaderSimple');
      const checkpoints = nodeChoices({ CheckpointLoaderSimple: info }, 'CheckpointLoaderSimple', 'ckpt_name');
      return {
        available: true,
        checkpointAvailable: checkpoints.length > 0,
        checkpoints,
        checkpointCount: checkpoints.length,
        message: checkpoints.length
          ? `${checkpoints.length} modelo(s) de imagem encontrado(s).`
          : 'ComfyUI está aberto, mas não encontrei um modelo em models/checkpoints.',
      };
    } catch {
      return {
        available: false,
        checkpointAvailable: false,
        checkpoints: [],
        checkpointCount: 0,
        message: 'ComfyUI não está respondendo em http://127.0.0.1:8188.',
      };
    }
  }

  async function waitForImage(promptId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const history = await requestJson(`/history/${encodeURIComponent(promptId)}`, {}, 10000);
      const entry = history?.[promptId] || history?.history?.[promptId] || history;
      const status = entry?.status?.status_str;
      if (status === 'error') {
        const messages = Array.isArray(entry?.status?.messages) ? JSON.stringify(entry.status.messages) : '';
        throw new Error(`O ComfyUI não conseguiu gerar a imagem.${messages ? ` ${messages.slice(0, 700)}` : ''}`);
      }
      const outputs = entry?.outputs;
      if (outputs && typeof outputs === 'object') {
        const images = Object.values(outputs).flatMap((output) =>
          Array.isArray(output?.images) ? output.images : [],
        );
        if (images.length) return images[0];
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error('A geração ultrapassou seis minutos. Confira a fila e a memória da placa de vídeo no ComfyUI.');
  }

  async function generate(payload = {}) {
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim().slice(0, MAX_PROMPT_LENGTH) : '';
    if (prompt.length < 3) throw new Error('Descreva o que você quer ver na imagem.');
    onStatus({ state: 'preparing', message: 'Preparando o gerador de imagens local…' });

    const checkpointNode = await getNodeInfo('CheckpointLoaderSimple');
    const checkpoints = nodeChoices({ CheckpointLoaderSimple: checkpointNode }, 'CheckpointLoaderSimple', 'ckpt_name');
    if (!checkpoints.length) {
      throw new Error('O ComfyUI está aberto, mas falta um modelo de imagem. Instale um checkpoint e coloque o arquivo em ComfyUI/models/checkpoints.');
    }

    const samplerNode = await getNodeInfo('KSampler');
    const samplers = nodeChoices({ KSampler: samplerNode }, 'KSampler', 'sampler_name');
    const schedulers = nodeChoices({ KSampler: samplerNode }, 'KSampler', 'scheduler');
    const checkpoint = checkpoints.find((name) => /sd.?xl.*base|sdxl.*base/i.test(name)) || checkpoints[0];
    const sampler = samplers.includes('euler') ? 'euler' : (samplers[0] || 'euler');
    const scheduler = schedulers.includes('normal') ? 'normal' : (schedulers[0] || 'normal');
    const isSdxl = /xl/i.test(checkpoint);
    const width = isSdxl ? 768 : 512;
    const height = isSdxl ? 768 : 512;
    const seed = crypto.randomInt(0, 2147483647);
    const workflow = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: DEFAULT_NEGATIVE_PROMPT, clip: ['1', 1] } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps: 22,
          cfg: 7,
          sampler_name: sampler,
          scheduler,
          denoise: 1,
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'Aurora', images: ['6', 0] } },
    };

    onStatus({ state: 'queued', message: 'Imagem enviada ao ComfyUI. A geração pode levar alguns minutos.' });
    const queued = await requestJson('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
    });
    if (!queued?.prompt_id) {
      const detail = queued?.error?.message || queued?.error || queued?.node_errors;
      throw new Error(`O ComfyUI recusou o fluxo de geração.${detail ? ` ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}` : ''}`);
    }

    const output = await waitForImage(queued.prompt_id);
    if (!output?.filename) throw new Error('O ComfyUI terminou, mas não informou o arquivo gerado.');
    const query = new URLSearchParams({
      filename: String(output.filename),
      subfolder: String(output.subfolder || ''),
      type: String(output.type || 'output'),
    });
    const response = await fetchImpl(`${COMFY_URL}/view?${query.toString()}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(describeHttpError(response, body));
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('A imagem retornada está vazia ou excede o limite de 20 MB.');
    }
    const mimeType = imageMime(buffer, response.headers?.get?.('content-type'));
    const id = crypto.randomUUID();
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    const directory = outputDirectory();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, `${id}.${extension}`), buffer, { flag: 'wx', mode: 0o600 });

    onStatus({ state: 'complete', message: 'Imagem criada e salva na pasta local da Aurora.' });
    return {
      id,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
      prompt,
      checkpoint,
    };
  }

  async function loadImage(rawId) {
    const id = typeof rawId === 'string' ? rawId : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('O identificador da imagem é inválido.');
    }
    let buffer;
    for (const extension of ['png', 'jpg', 'webp']) {
      try {
        buffer = await fs.readFile(path.join(outputDirectory(), `${id}.${extension}`));
        break;
      } catch { /* tenta a próxima extensão permitida */ }
    }
    if (!buffer || !buffer.length || buffer.length > MAX_IMAGE_BYTES) return { found: false };
    const mimeType = imageMime(buffer);
    return { found: true, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` };
  }

  return { getStatus, generate, loadImage, outputDirectory };
}

module.exports = { createAuroraImageGenerator };
