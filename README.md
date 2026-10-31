# Aurora — assistente virtual gratuita para Windows

Versão 0.2.3: avatar VRM de anime com movimentos suaves, janela flutuante, chat com IA local gratuita e voz neural feminina Francisca.

## Sem API paga ou assinatura

A Aurora conversa com modelos locais pelo [Ollama](https://ollama.com/). Não usa chave da OpenAI, não cobra por mensagem e não exige assinatura. O modelo é baixado uma vez para o computador; depois de instalado, o chat pode funcionar sem internet.

## Voz natural da Aurora

A Aurora usa a voz neural `pt-BR-FranciscaNeural` do serviço de leitura do Microsoft Edge. Não precisa de chave de API, cartão ou assinatura, mas precisa de internet para sintetizar cada resposta.

O pacote `node-edge-tts` é comunitário e utiliza o serviço online do Edge; não é uma integração oficial contratada pela Microsoft e pode deixar de funcionar se o serviço mudar ou limitar requisições.

## Instalação rápida

1. Instale o [Node.js 22 ou superior](https://nodejs.org/).
2. Baixe ou clone este repositório.
3. Execute `ATUALIZAR-AURORA.bat` para instalar as dependências e baixar o avatar de anime.
4. Execute `INSTALAR-IA-GRATUITA.bat`. O script instala o Ollama pelo `winget` quando disponível e baixa `qwen3.5:2b`.
5. Abra o Ollama pelo menu Iniciar e deixe-o em execução.
6. Inicie a Aurora com `INICIAR-AURORA.bat`.

Se o script automático não funcionar, instale o Ollama manualmente por https://ollama.com/download/windows e rode estes comandos no Prompt de Comando:

```powershell
ollama pull qwen3.5:2b
ollama run qwen3.5:2b
```

Depois que o modelo carregar, feche a janela do terminal do teste e inicie a Aurora. O serviço do Ollama deve permanecer aberto em segundo plano.

## Modelos disponíveis

A Aurora permite selecionar estes modelos nas configurações:

- `qwen3.5:2b` — opção mais leve para começar.
- `qwen3.5:4b` — resposta mais capaz, consome mais memória.
- `qwen3.5:9b` — mais pesado, indicado para computadores com mais RAM e GPU.

Os tamanhos variam conforme a quantização publicada. O modelo selecionado precisa ser baixado separadamente, por exemplo: `ollama pull qwen3.5:4b`.

## O que funciona nesta versão

- Janela flutuante sempre visível.
- Personagem 3D estilo anime carregada em formato VRM, com movimentos sutis de cabeça, piscar e animação de boca enquanto fala.
- Avatar alternativo integrado caso o download do modelo VRM falhe.
- Chat com modelo de IA executado localmente pelo Ollama.
- Histórico recente da conversa enquanto a janela está aberta.
- Leitura das respostas com a voz neural feminina `pt-BR-FranciscaNeural` pelo serviço online de fala do Microsoft Edge, sem API key ou assinatura.
- Seleção do modelo local nas configurações.

## Limitações conhecidas

- O reconhecimento de fala pelo botão do microfone usa a API de reconhecimento do Chromium. Dependendo da instalação, pode exigir internet e processar áudio fora do PC. Para privacidade e funcionamento offline completos, esse recurso deverá ser substituído por Whisper local numa próxima versão.
- A voz neural Francisca precisa de conexão com a internet. O chat continua local e gratuito pelo Ollama. A voz é obtida pelo serviço de leitura do Microsoft Edge por meio do pacote comunitário `node-edge-tts`; o serviço pode mudar ou impor limites, pois não é uma API oficial contratada.
- A Aurora ainda não enxerga a tela nem controla programas ou arquivos.
- Modelos locais podem responder mais devagar e com menor capacidade do que serviços de IA pagos; a velocidade depende do processador, memória e placa de vídeo.

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

O instalador será gerado em `release`.

## Personagem anime e licença

O avatar padrão `anime_girl.vrm` é baixado do repositório público [GY19A/jev-stage](https://github.com/GY19A/jev-stage), que documenta este modelo como base VRoid Studio / pixiv sob licença CC0 1.0 (veja a seção “Assets and licensing” do repositório de origem). A Aurora baixa o arquivo durante a atualização em vez de embutir o modelo no repositório.

A origem e a licença declarada estão registradas em [AVATAR-LICENSE.txt](AVATAR-LICENSE.txt).

## Tecnologias

- Electron + React + TypeScript + Three.js + `@pixiv/three-vrm`
- Ollama local (`http://127.0.0.1:11434`)
- Modelo Qwen 3.5 (selecionável)
- Voz Francisca por meio do pacote comunitário `node-edge-tts`

## Privacidade

As mensagens do chat são enviadas apenas para o servidor local do Ollama em `127.0.0.1`. O aplicativo não contém API key. Para a voz Francisca, o texto da resposta é enviado ao serviço online de síntese de voz do Microsoft Edge. O reconhecimento do microfone pelo Chromium também pode usar serviço externo.

Não coloque tokens, senhas, chaves de API ou dados pessoais neste repositório.
