const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const BUILT_IN_SKILLS = Object.freeze({
  'aurora-identity': { title: 'Identidade da Aurora', file: 'aurora-identity/SKILL.md' },
  'live2d-self-perception': { title: 'Percepção do próprio avatar Live2D', file: 'live2d-self-perception/SKILL.md' },
  'computer-environment': { title: 'Consciência operacional do computador', file: 'computer-environment/SKILL.md' },
  'file-finder': { title: 'Localização de arquivos e pastas', file: 'file-finder/SKILL.md' },
  'skills-overview': { title: 'Catálogo de habilidades instaladas', file: 'skills-overview/SKILL.md' },
});

const SKIP_DIRECTORY_NAMES = new Set([
  'appdata', 'application data', 'cache', 'caches', 'node_modules', '.git',
  '.cache', '.npm', '.ollama', '$recycle.bin', 'system volume information',
  'windows', 'program files', 'program files (x86)', 'programdata',
]);

function normalizeSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFileSearchQuery(message) {
  const original = String(message || '').trim();
  const normalized = normalizeSearchText(original);
  const hasSearchIntent = /\b(onde (?:que )?(?:esta|ta)|onde fica|cade|acha|acho|achar|encontre|encontro|encontrar|localize|localizar|procure|procurar|busque|buscar)\b/.test(normalized);
  const hasFileTarget = /\b(arquivo|ficheiro|documento|pasta)\b/.test(normalized);
  if (!hasSearchIntent || !hasFileTarget) return null;

  const quoted = original.match(/["“']([^"”']{2,120})["”']/);
  if (quoted && quoted[1]) return quoted[1].trim();

  const withExtension = original.match(/([^\s"'<>|?*]+\.[a-zA-Z0-9]{1,12})(?=$|[\s?.,;])/);
  if (withExtension && withExtension[1]) return withExtension[1].replace(/[.,;?]+$/, '');

  const targetMatch = original.match(/\b(?:arquivo|ficheiro|documento|pasta)\s+(?:chamado\s+|chamada\s+|com\s+nome\s+|nomeado\s+|nomeada\s+)?(.+?)\s*$/i);
  if (!targetMatch || !targetMatch[1]) return null;
  return targetMatch[1]
    .replace(/[?!.]+$/, '')
    .replace(/\s+(?:no meu computador|no computador|no pc|no windows|aqui no pc|aqui no computador)$/i, '')
    .trim()
    .slice(0, 120) || null;
}

function selectSkills({ message = '', avatarImageAttached = false } = {}) {
  const normalized = normalizeSearchText(message);
  const ids = ['aurora-identity'];
  const ownAvatarIntent = avatarImageAttached || /\b(como voce e|como voce ta|como e seu avatar|qual e sua aparencia|descreva sua aparencia|fale sobre sua aparencia|como voce aparece|como voce se parece|olha pra voce|olhe para voce|veja seu avatar|se veja|se olhe|o que voce (?:esta|ta) vestindo|o que voce (?:esta|ta) usando|como e seu cabelo|como e seu rosto|qual expressao voce esta|essa e voce|essa personagem e voce|seu modelo live2d|sua boneca|sua personagem)\b/.test(normalized);
  const desktopIntent = /\b(horas?|horario|data|que dia|qual dia|dia de hoje|hoje|agora|computador|windows|sistema operacional|sistema do pc|memoria ram|processador|espaco em disco|desktop|area de trabalho|pasta|arquivo|programa|aplicativo|janela|tela)\b/.test(normalized);
  const fileSearchQuery = extractFileSearchQuery(message);
  const asksSkills = /\b(quais skills|que skills|suas skills|quais habilidades|que habilidades|suas habilidades|o que voce sabe fazer|o que voce consegue fazer|suas capacidades|habilidades instaladas)\b/.test(normalized);

  if (ownAvatarIntent) ids.push('live2d-self-perception');
  if (desktopIntent) ids.push('computer-environment');
  if (fileSearchQuery) ids.push('file-finder');
  if (asksSkills) ids.push('skills-overview');

  return {
    ids: [...new Set(ids)],
    fileSearchQuery,
    ownAvatarIntent,
    desktopIntent,
  };
}

function createAuroraSkills({ app, screen, os, skillsDirectory = path.resolve(__dirname, '..', 'skills') }) {
  if (!app || typeof app.getPath !== 'function') throw new TypeError('Aurora Skills precisa do serviço de caminhos do Electron.');
  if (!os) throw new TypeError('Aurora Skills precisa do módulo de sistema operacional.');

  function getSearchRoots() {
    const definitions = [
      ['Área de Trabalho', () => app.getPath('desktop')],
      ['Documentos', () => app.getPath('documents')],
      ['Downloads', () => path.join(app.getPath('home'), 'Downloads')],
      ['Imagens', () => app.getPath('pictures')],
      ['Vídeos', () => app.getPath('videos')],
      ['Músicas', () => app.getPath('music')],
    ];
    const seen = new Set();
    const roots = [];
    for (const item of definitions) {
      const label = item[0];
      const getPath = item[1];
      try {
        const target = path.resolve(getPath());
        const normalized = process.platform === 'win32' ? target.toLowerCase() : target;
        if (!seen.has(normalized) && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
          seen.add(normalized);
          roots.push({ label, path: target });
        }
      } catch {
        // Pastas especiais podem não existir ou estar indisponíveis neste computador.
      }
    }
    return roots;
  }

  function getEnvironmentContext() {
    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'fuso horário local do Windows';
    const localDateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'medium' }).format(now);
    const systemName = typeof os.type === 'function' ? os.type() : process.platform;
    const systemRelease = typeof os.release === 'function' ? os.release() : 'desconhecida';
    const architecture = typeof os.arch === 'function' ? os.arch() : process.arch;
    const cpuCount = typeof os.cpus === 'function' ? os.cpus().length : null;
    const totalMemoryGb = typeof os.totalmem === 'function' ? (os.totalmem() / 1024 ** 3).toFixed(1) : null;
    const freeMemoryGb = typeof os.freemem === 'function' ? (os.freemem() / 1024 ** 3).toFixed(1) : null;
    let display = 'tela principal indisponível';
    try {
      const size = screen && screen.getPrimaryDisplay && screen.getPrimaryDisplay().size;
      if (size && size.width && size.height) display = size.width + ' × ' + size.height;
    } catch {
      // A janela pode estar inicializando durante a primeira consulta.
    }
    const roots = getSearchRoots().map((root) => root.label).join(', ') || 'nenhuma pasta pessoal disponível para busca';
    return [
      'CONTEXTO LOCAL ATUAL (dados obtidos agora pelo próprio aplicativo):',
      'Data e hora locais: ' + localDateTime + '.',
      'Fuso horário: ' + timeZone + '.',
      'Data/hora ISO do computador: ' + now.toISOString() + '.',
      'Sistema operacional: ' + systemName + ' ' + systemRelease + ' (' + architecture + ').',
      'Processadores lógicos: ' + (cpuCount === null ? 'não informado' : cpuCount) +
        '. RAM total/livre: ' + (totalMemoryGb || 'não informada') + ' GB / ' + (freeMemoryGb || 'não informada') + ' GB.',
      'Resolução da tela principal: ' + display + '.',
      'Pastas pessoais que a habilidade de localização pode pesquisar: ' + roots + '.',
      'Limites de percepção: não existe observação contínua da tela, da webcam, do microfone ou dos processos. A tela só é analisada quando uma captura é anexada a um pedido; informações de arquivos só são conhecidas após uma busca real. Não invente janelas ativas, arquivos, eventos nem ações concluídas.',
    ].join('\n');
  }

  async function loadSkills(ids = []) {
    const uniqueIds = [...new Set(['aurora-identity', ...ids])];
    const loaded = [];
    for (const id of uniqueIds) {
      const definition = BUILT_IN_SKILLS[id];
      if (!definition) continue;
      const root = path.resolve(skillsDirectory);
      const target = path.resolve(root, definition.file);
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      try {
        const content = await fsp.readFile(target, 'utf8');
        loaded.push({ id, title: definition.title, content: content.trim().slice(0, 12000) });
      } catch (error) {
        loaded.push({
          id,
          title: definition.title,
          content: 'Habilidade ' + definition.title + ' cadastrada, mas seu arquivo SKILL.md não pôde ser carregado: ' +
            (error instanceof Error ? error.message : String(error)) + '.',
        });
      }
    }
    return loaded;
  }

  async function searchFiles(rawQuery, options = {}) {
    const query = String(rawQuery || '').trim().slice(0, 120);
    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery.length < 2) {
      return { query, results: [], searchedRoots: [], scannedEntries: 0, truncated: false, error: 'Informe ao menos dois caracteres do nome do arquivo ou pasta.' };
    }

    const roots = getSearchRoots();
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    const maxResults = Math.max(1, Math.min(Number(options.maxResults) || 15, 25));
    const maxEntries = Math.max(100, Math.min(Number(options.maxEntries) || 12000, 30000));
    const maxDirectories = Math.max(50, Math.min(Number(options.maxDirectories) || 2500, 5000));
    const timeLimitMs = Math.max(1000, Math.min(Number(options.timeLimitMs) || 7000, 12000));
    const maxDepth = Math.max(1, Math.min(Number(options.maxDepth) || 6, 8));
    const deadline = Date.now() + timeLimitMs;
    const queue = roots.map((root) => ({ label: root.label, path: root.path, depth: 0 }));
    const results = [];
    const visited = new Set();
    let scannedEntries = 0;
    let visitedDirectories = 0;
    let truncated = false;

    while (queue.length && results.length < maxResults && scannedEntries < maxEntries &&
      visitedDirectories < maxDirectories && Date.now() < deadline) {
      const current = queue.shift();
      const key = process.platform === 'win32' ? current.path.toLowerCase() : current.path;
      if (visited.has(key)) continue;
      visited.add(key);
      visitedDirectories += 1;

      let entries;
      try {
        entries = await fsp.readdir(current.path, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        scannedEntries += 1;
        if (scannedEntries >= maxEntries || results.length >= maxResults || Date.now() >= deadline) {
          truncated = true;
          break;
        }
        const isDirectory = entry.isDirectory();
        const isFile = entry.isFile();
        if (!isDirectory && !isFile) continue;
        const normalizedName = normalizeSearchText(entry.name);
        if (queryTokens.every((token) => normalizedName.includes(token))) {
          let details = { size: null, modifiedAt: null };
          if (isFile) {
            try {
              const stat = await fsp.stat(path.join(current.path, entry.name));
              details = { size: stat.size, modifiedAt: stat.mtime.toISOString() };
            } catch {
              // Um arquivo pode ser removido enquanto a busca está acontecendo.
            }
          }
          results.push({
            name: entry.name,
            kind: isDirectory ? 'pasta' : 'arquivo',
            path: path.join(current.path, entry.name),
            root: current.label,
            size: details.size,
            modifiedAt: details.modifiedAt,
          });
          if (results.length >= maxResults) {
            truncated = true;
            break;
          }
        }
        if (isDirectory && current.depth < maxDepth && !entry.name.startsWith('.') &&
          !SKIP_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
          queue.push({
            label: current.label,
            path: path.join(current.path, entry.name),
            depth: current.depth + 1,
          });
        }
      }
    }

    if (queue.length && (scannedEntries >= maxEntries || visitedDirectories >= maxDirectories || Date.now() >= deadline)) {
      truncated = true;
    }
    return {
      query,
      results,
      searchedRoots: roots.map((root) => root.label),
      scannedEntries,
      truncated,
    };
  }

  function formatFileSearchResult(result) {
    if (!result) return '';
    const lines = [
      'RESULTADO REAL DA BUSCA LOCAL pelo nome "' + result.query + '".',
      'Pastas pesquisadas: ' + (result.searchedRoots.join(', ') || 'nenhuma') + '.',
      'Entradas examinadas: ' + result.scannedEntries + '.',
    ];
    if (result.results.length) {
      lines.push('Correspondências encontradas:');
      for (const item of result.results) {
        const size = Number.isFinite(item.size) ? '; tamanho ' + item.size + ' bytes' : '';
        const modified = item.modifiedAt ? '; modificado em ' + item.modifiedAt : '';
        lines.push('- ' + item.kind + ': ' + item.name + '; caminho completo: ' + item.path + '; pasta-base: ' + item.root + size + modified);
      }
    } else {
      lines.push('Nenhuma correspondência foi encontrada nas pastas pesquisadas. Não diga que procurou no disco inteiro.');
    }
    if (result.truncated) lines.push('A busca atingiu um limite de segurança/tempo e pode não ter percorrido todas as subpastas.');
    lines.push('Não afirme que abriu, leu, moveu ou alterou o arquivo. A busca localizou nomes e caminhos; ela não abriu o conteúdo.');
    return lines.join('\n');
  }

  return { getEnvironmentContext, getSearchRoots, loadSkills, selectSkills, searchFiles, formatFileSearchResult };
}

module.exports = {
  BUILT_IN_SKILLS,
  createAuroraSkills,
  extractFileSearchQuery,
  normalizeSearchText,
  selectSkills,
};
