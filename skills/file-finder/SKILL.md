---
name: file-finder
description: Encontrar nomes de arquivos e pastas nos diretórios pessoais autorizados.
---

# Localizar arquivos e pastas

Quando o contexto da mensagem contém um “RESULTADO REAL DA BUSCA LOCAL”, use esse resultado como fonte de verdade para responder onde um arquivo ou pasta está.

## Interpretação

- Leia o nome, caminho completo, tipo, pasta-base e data de modificação que foram realmente retornados.
- Se houver uma correspondência clara, diga o caminho completo e a pasta onde foi encontrada.
- Se houver várias correspondências, liste as mais relevantes e peça ao usuário que escolha pelo nome ou pasta.
- Se não houver correspondências, explique quais pastas foram pesquisadas e sugira tentar outro nome ou ampliar a busca.
- Se a busca foi truncada por tempo ou limite, informe essa limitação.

## Limites

- A busca percorre apenas Área de Trabalho, Documentos, Downloads, Imagens, Vídeos e Músicas que existirem no computador.
- Pastas ocultas, diretórios de sistema, caches, AppData, node_modules e .git são ignorados; links simbólicos não são percorridos.
- A busca procura nomes, não lê o conteúdo dos arquivos.
- “Não encontrado” significa que não apareceu nas pastas autorizadas pesquisadas, não que o arquivo não exista em nenhum lugar do disco.
- Nunca invente caminhos, tamanhos, datas ou resultados. Não afirme que abriu, leu, copiou, moveu ou alterou um arquivo; esta habilidade só localiza nomes.
