# Aurora — assistente virtual gratuita para Windows

Versão 0.4.0: personagem 3D flutuante, animações expressivas, voz feminina jovem de tom mais agudo, IA local e visão/controle assistido do desktop.

## Recursos

- Janela transparente e sem moldura, com a personagem 3D flutuando na área de trabalho.
- Câmera aproximada, pose de repouso e animações suaves de cabeça, corpo, braços e mãos; reação de riso quando a conversa fica divertida.
- Personalidade brincalhona, sarcástica com carinho e capaz de rir naturalmente, sem perder a empatia em assuntos sérios.
- Voz neural brasileira `pt-BR-LeticiaNeural`, com ajuste de pitch `+42Hz` e velocidade `+12%`.
- Chat local com Qwen 3.5 via Ollama, com respostas transmitidas em fluxo.
- Visão: captura da tela somente quando o usuário pede para analisar ou agir sobre o que aparece nela.
- Atalhos para abrir aplicativos, Configurações do Windows, Câmera, Ferramenta de Captura, pastas e páginas web; pesquisa rápida no Google e YouTube.
- Interação assistida com clique, rolagem, digitação e atalhos. A Aurora apresenta a ação proposta e aguarda confirmação antes de executar.

## Instalação

1. Instale o [Node.js 22 ou superior](https://nodejs.org/).
2. Baixe ou clone este repositório.
3. Execute `ATUALIZAR-AURORA.bat` para instalar dependências e baixar o avatar VRM.
4. Execute `INSTALAR-IA-GRATUITA.bat` para instalar o Ollama (quando `winget` estiver disponível) e baixar `qwen3.5:2b`.
5. Deixe o Ollama em execução e inicie com `INICIAR-AURORA.bat`.

## Voz

A voz padrão é `pt-BR-LeticiaNeural`, uma voz feminina de timbre mais jovem listada pelo serviço de fala da Microsoft. O projeto ajusta o pitch em +42 Hz e a velocidade em +12% para aproximar o resultado de uma voz de anime. A síntese é feita online pelo pacote comunitário `node-edge-tts`, não por uma API oficial contratada; precisa de internet e pode mudar ou sofrer limitações.

## Visão, autonomia e privacidade

A Aurora não fica observando a tela continuamente. A captura ocorre quando o usuário pede análise visual ou uma tarefa que dependa da tela. A imagem é enviada apenas ao servidor local do Ollama em `127.0.0.1` para interpretação; não é enviada a um serviço de visão na nuvem.

Ela pode abrir um conjunto limitado de aplicativos e pastas, pesquisar na web e propor uma ação de clique, rolagem, digitação ou tecla de atalho. Cada ação de controle do mouse/teclado requer confirmação explícita do usuário. Ações destrutivas, compras, envio de mensagens e execução arbitrária de comandos de terminal não são habilitadas.

O texto do chat e as imagens de captura são processados pelo Ollama local. A voz Leticia é sintetizada online e o texto falado é enviado ao serviço de fala do Edge. O reconhecimento do microfone usa a API de fala do Chromium e pode depender de internet.

## Modelos

- `qwen3.5:2b`: opção mais leve para iniciar e analisar imagens.
- `qwen3.5:4b`: qualidade maior, usa mais memória.
- `qwen3.5:9b`: opção mais pesada para computadores com mais memória e GPU.

Para baixar outro modelo, execute `ollama pull qwen3.5:4b` ou `ollama pull qwen3.5:9b`.

## Desenvolvimento e instalador

```powershell
npm install
npm run dev
```

Para gerar o instalador do Windows:

```powershell
npm run dist
```

O instalador é gerado na pasta `release`.

## Avatar e licença

O avatar `anime_girl.vrm` é baixado durante a atualização do repositório público [GY19A/jev-stage](https://github.com/GY19A/jev-stage), que declara o arquivo sob CC0 1.0. Consulte também `AVATAR-LICENSE.txt`.

## Tecnologias

Electron, React, TypeScript, Three.js, `@pixiv/three-vrm`, Ollama e `node-edge-tts`.

Não coloque tokens, senhas, chaves de API ou dados pessoais no repositório.