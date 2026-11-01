'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAuroraImageGenerator } = require('./aurora-image-generator.cjs');

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const checkpointInfo = {
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [['dreamshaper.safetensors'], {}] } },
  },
};
const samplerInfo = {
  KSampler: {
    input: {
      required: {
        sampler_name: [['euler', 'dpmpp_2m'], {}],
        scheduler: [['normal', 'karras'], {}],
      },
    },
  },
};

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('detects ComfyUI and installed checkpoints', async () => {
  const generator = createAuroraImageGenerator({
    app: { getPath: () => '/tmp/aurora-test' },
    fetchImpl: async (url) => {
      assert.match(String(url), /object_info\/CheckpointLoaderSimple$/);
      return jsonResponse(checkpointInfo);
    },
  });

  const status = await generator.getStatus();
  assert.equal(status.available, true);
  assert.equal(status.checkpointAvailable, true);
  assert.deepEqual(status.checkpoints, ['dreamshaper.safetensors']);
});

test('generates, saves and reloads a PNG through the ComfyUI API', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-images-'));
  let promptId = '';
  const generator = createAuroraImageGenerator({
    app: { getPath: () => directory },
    pollIntervalMs: 1,
    timeoutMs: 500,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/object_info/CheckpointLoaderSimple')) return jsonResponse(checkpointInfo);
      if (target.endsWith('/object_info/KSampler')) return jsonResponse(samplerInfo);
      if (target.endsWith('/prompt')) {
        const body = JSON.parse(options.body);
        assert.equal(body.prompt['2'].inputs.text, 'a lighthouse at sunset');
        assert.equal(body.prompt['7'].class_type, 'SaveImage');
        promptId = 'test-prompt-id';
        return jsonResponse({ prompt_id: promptId });
      }
      if (target.endsWith('/history/' + promptId)) {
        return jsonResponse({
          [promptId]: {
            outputs: { '7': { images: [{ filename: 'Aurora_00001.png', subfolder: '', type: 'output' }] } },
          },
        });
      }
      if (target.includes('/view?')) {
        return new Response(png, { headers: { 'Content-Type': 'image/png' } });
      }
      throw new Error('Unexpected request: ' + target);
    },
  });

  try {
    const result = await generator.generate({ prompt: 'a lighthouse at sunset' });
    assert.ok(result.id);
    assert.match(result.dataUrl, /^data:image\/png;base64,/);
    const restored = await generator.loadImage(result.id);
    assert.equal(restored.found, true);
    assert.equal(restored.dataUrl, result.dataUrl);
    const savedPath = path.join(directory, 'generated-images', result.id + '.png');
    assert.equal((await fs.stat(savedPath)).isFile(), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('rejects empty prompts and a ComfyUI installation without a checkpoint', async () => {
  const generator = createAuroraImageGenerator({
    app: { getPath: () => '/tmp/aurora-test' },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/object_info/CheckpointLoaderSimple')) {
        return jsonResponse({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [[], {}] } } } });
      }
      throw new Error('Unexpected request');
    },
  });

  await assert.rejects(generator.generate({ prompt: '  ' }), /Descreva/);
  await assert.rejects(generator.generate({ prompt: 'a castle' }), /falta um modelo/);
});

test('does not allow arbitrary image IDs when loading saved results', async () => {
  const generator = createAuroraImageGenerator({ app: { getPath: () => '/tmp/aurora-test' } });
  await assert.rejects(generator.loadImage('../../secret'), /identificador.*inválido/i);
});
