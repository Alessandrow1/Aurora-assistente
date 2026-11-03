const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createAuroraSkills,
  extractFileSearchQuery,
  selectSkills,
} = require('./aurora-skills.cjs');

let tempRoot;
let paths;
let skills;

test.beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-skills-test-'));
  paths = {
    desktop: path.join(tempRoot, 'Desktop'),
    documents: path.join(tempRoot, 'Documents'),
    downloads: path.join(tempRoot, 'Downloads'),
    home: tempRoot,
    pictures: path.join(tempRoot, 'Pictures'),
    videos: path.join(tempRoot, 'Videos'),
    music: path.join(tempRoot, 'Music'),
  };
  await Promise.all(Object.values(paths).map((target) => fs.mkdir(target, { recursive: true })));
  skills = createAuroraSkills({
    app: { getPath: (key) => paths[key] },
    screen: { getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 } }) },
    os,
    skillsDirectory: path.join(__dirname, '..', 'skills'),
  });
});

test.afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('exposes skill selection through the created Aurora skills instance', () => {
  assert.equal(typeof skills.selectSkills, 'function');
  assert.deepEqual(skills.selectSkills({ message: 'Oi, Aurora!' }).ids, ['aurora-identity']);
  assert.ok(skills.selectSkills({ message: 'Que horas são agora?' }).ids.includes('computer-environment'));
});

test('always activates identity and selects avatar, desktop and file skills when relevant', () => {
  assert.deepEqual(selectSkills({ message: 'Oi, Aurora!' }).ids, ['aurora-identity']);

  const avatar = selectSkills({ message: 'O que você está vestindo?', avatarImageAttached: true });
  assert.ok(avatar.ids.includes('aurora-identity'));
  assert.ok(avatar.ids.includes('live2d-self-perception'));

  const file = selectSkills({ message: 'Onde está o arquivo Aurora-Checkpoint.txt no meu PC?' });
  assert.ok(file.ids.includes('computer-environment'));
  assert.ok(file.ids.includes('file-finder'));
  assert.equal(file.fileSearchQuery, 'Aurora-Checkpoint.txt');
  assert.equal(extractFileSearchQuery('Onde tá o arquivo relatorio.pdf?'), 'relatorio.pdf');

  const time = selectSkills({ message: 'Que horas são agora?' });
  assert.ok(time.ids.includes('computer-environment'));

  const overview = selectSkills({ message: 'Quais skills você tem?' });
  assert.ok(overview.ids.includes('skills-overview'));
});

test('extracts quoted names, exact filenames and simple file descriptions', () => {
  assert.equal(extractFileSearchQuery('Encontre o arquivo "Meu relatório final.pdf".'), 'Meu relatório final.pdf');
  assert.equal(extractFileSearchQuery('Onde fica o documento contrato.pdf no computador?'), 'contrato.pdf');
  assert.equal(extractFileSearchQuery('Onde está a pasta Projeto Aurora?'), 'Projeto Aurora');
  assert.equal(extractFileSearchQuery('Como está o tempo hoje?'), null);
});

test('loads the identity and requested skill Markdown files from the local skill directory', async () => {
  const loaded = await skills.loadSkills(['computer-environment', 'file-finder', 'skills-overview']);
  const ids = loaded.map((item) => item.id);
  assert.deepEqual(ids, ['aurora-identity', 'computer-environment', 'file-finder', 'skills-overview']);
  assert.match(loaded[0].content, /representação visual/i);
  assert.match(loaded[1].content, /Data e hora/i);
  assert.match(loaded[2].content, /RESULTADO REAL DA BUSCA LOCAL/i);
  assert.match(loaded[3].content, /Habilidades atualmente instaladas/i);
});

test('reports fresh local time, operating system, display and safe search locations', () => {
  const context = skills.getEnvironmentContext();
  assert.match(context, /Data e hora locais:/);
  assert.match(context, /Fuso horário:/);
  assert.match(context, /Sistema operacional:/);
  assert.match(context, /1920 × 1080/);
  assert.match(context, /Área de Trabalho/);
  assert.equal(context.includes(tempRoot), false);
});

test('finds matching filenames in allowed personal folders and reports exact paths', async () => {
  const nested = path.join(paths.documents, 'Projetos', 'Aurora');
  await fs.mkdir(nested, { recursive: true });
  const expectedPath = path.join(nested, 'Aurora-Checkpoint.txt');
  await fs.writeFile(expectedPath, 'checkpoint de teste', 'utf8');
  await fs.writeFile(path.join(paths.desktop, 'Outro-Arquivo.txt'), 'outro arquivo', 'utf8');

  const result = await skills.searchFiles('aurora checkpoint');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, expectedPath);
  assert.equal(result.results[0].kind, 'arquivo');
  assert.ok(result.scannedEntries > 0);

  const formatted = skills.formatFileSearchResult(result);
  assert.ok(formatted.includes(expectedPath));
  assert.match(formatted, /Não afirme que abriu/);
});

test('does not search hidden and system folders', async () => {
  const hidden = path.join(paths.documents, '.private');
  const nodeModules = path.join(paths.documents, 'node_modules');
  await fs.mkdir(hidden, { recursive: true });
  await fs.mkdir(nodeModules, { recursive: true });
  await fs.writeFile(path.join(hidden, 'segredo.txt'), 'conteudo');
  await fs.writeFile(path.join(nodeModules, 'segredo.txt'), 'conteudo');

  const result = await skills.searchFiles('segredo.txt');
  assert.equal(result.results.length, 0);
  assert.deepEqual(result.searchedRoots.sort(), [
    'Área de Trabalho', 'Documentos', 'Downloads', 'Imagens', 'Músicas', 'Vídeos',
  ].sort());
});

test('requires a meaningful query before scanning', async () => {
  const result = await skills.searchFiles('a');
  assert.match(result.error, /dois caracteres/);
  assert.equal(result.scannedEntries, 0);
});
