# Aurora — assistente virtual gratuita para Windows

Versão 0.3.0: companheira 3D flutuante no desktop, visão local da tela, ações de mouse/teclado com confirmação, IA local e voz feminina mais aguda.

## Sem API paga ou assinatura

A Aurora conversa com modelos locais pelo [Ollama](https://ollama.com/). Não usa chave da OpenAI, não cobra por mensagem e não exige assinatura. O modelo é baixado uma vez para o computador; depois de instalado, o chat pode funcionar sem internet.

## O que há nesta versão

- Janela transparente e sem moldura, com a personagem 3D flutuando sobre a área de trabalho.
- Pose de repouso com os braços abaixados e movimentos suaves de cabeça, piscar e boca.
- Chat em painel compacto que pode ser aberto e fechado sem esconder a personagem.
- Respostas transmitidas em fluxo, aparecendo enquanto o modelo local gera o texto.
- Modelo `qwen3.5:2b` com suporte a texto e imagem pelo Ollama.
- Botão de visão: captura uma imagem da tela quando você pede e envia essa captura somente ao Ollama local.
- Comandos rápidos para abrir Calculadora, Bloco de Notas, Explorador, Paint, Gerenciador de Tarefas, Google e pastas conhecidas.
- Ações de clique, digitação e atalhos podem ser propostas após uma solicitação explícita. A Aurora mostra a ação e aguarda confirmação antes de executar.
- Voz `pt-BR-ThalitaNeural` com tom mais agudo. A voz neural usa o serviço online de fala do Microsoft Edge e precisa de internet.

## Privacidade e segurança

A captura de tela é feita somente quando você toca no botão de olho ou pede uma ação visual como clicar ou digitar. A imagem é processada pelo servidor local do Ollama em `127.0.0.1`, não por uma API de visão na nuvem.

A Aurora não fica monitorando a tela continuamente. O conteúdo que aparece na tela é tratado como dado não confiável: instruções encontradas em páginas, documentos ou mensagens não devem ser seguidas como ordens. Uma ação sugerida pelo modelo exige sua confirmação explícita.

O controle do computador nesta versão é limitado a um clique, texto ou atalho por vez, e somente após confirmação. A abertura de aplicativos e pastas usa uma lista de destinos permitidos. A Aurora não executa comandos arbitrários do PowerShell nem faz alterações silenciosas em arquivos ou configurações do Windows.

As mensagens de chat e imagens de tela são enviadas ao Ollama local. Para gerar a voz Thalita, o texto da resposta é enviado ao serviço online de síntese de voz do Microsoft Edge por meio do pacote comunitário `node-edge-tts`. Não é uma integração oficial contratada pela Microsoft e pode mudar ou sofrer limitações.

## Instalação

1. Instale o [Node.js 22 ou superior](https://nodejs.org/).
2. Baixe ou clone este repositório.
3. Execute `ATUALIZAR-AURORA.bat` para instalar as dependências e baixar o avatar VRM.
4. Execute `INSTALAR-IA-GRATUITA.bat`. O script instala o Ollama pelo `winget` quando disponível e baixa `qwen3.5:2b`.
5. Abra o Ollama pelo menu Iniciar e deixe-o em execução.
6. Inicie a Aurora com `INICIAR-AURORA.bat`.

Se o script automático não funcionar, instale o Ollama manualmente por https://ollama.com/download/windows e rode:

```powershell
ollama pull qwen3.5:2b
```

Depois que o modelo carregar, feche o terminal de teste e inicie a Aurora. O serviço do Ollama deve permanecer em execução em segundo plano.

## Modelos disponíveis

A Aurora permite selecionar estes modelos nas configurações:

- `qwen3.5:2b` — opção mais leve e compatível com análise de imagens.
- `qwen3.5:4b` — melhor qualidade, exige mais memória.
- `qwen3.5:9b` — mais pesado, indicado para computadores com mais RAM e GPU.

Cada modelo precisa ser baixado separadamente, por exemplo: `ollama pull qwen3.5:4b`.

## Executar em desenvolvimento

```powershell
npm install
npm run dev
```

## Gerar instalador do Windows

```powershell
npm install
npm run dist
```

O instalador será gerado na pasta `release`.

## Personagem anime e licença

O avatar padrão `anime_girl.vrm` é baixado do repositório público [GY19A/jev-stage](https://github.com/GY19A/jev-stage), que documenta este modelo como base VRoid Studio / pixiv sob licença CC0 1.0 (veja “Assets and licensing” no projeto de origem). O modelo é baixado durante a atualização em vez de ser armazenado no repositório.

## Tecnologias

- Electron + React + TypeScript + Three.js + `@pixiv/three-vrm`
- Ollama local (`http://127.0.0.1:11434`)
- Qwen 3.5 multimodal
- Voz Thalita por meio do pacote comunitário `node-edge-tts`

## Reconhecimento de voz

O botão do microfone usa a API de reconhecimento de fala do Chromium. Dependendo da instalação, pode exigir internet e processar o áudio fora do PC.

Não coloque tokens, senhas, chaves de API ou dados pessoais no repositório.