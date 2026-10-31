# Aurora Desktop â€” checkpoint de integraÃ§Ã£o Live2D

Data do checkpoint: 31/10/2026
Branch: `feature/live2d-avatar`

## RepositÃ³rios: nÃ£o misturar

- **Aurora desktop:** `Alessandrow1/Aurora-assistente`, pasta local `C:\Users\Alessandro Linhares\Desktop\AURORA\Aurora-assistente`. Ã‰ o aplicativo Electron + React + TypeScript.
- **NOVAAURORA:** `Alessandrow1/NOVAAURORA`, pasta local `D:\Aurora-TTS-Lab\NOVAAURORA`. Ã‰ o laboratÃ³rio Python de voz/TTS, nÃ£o o aplicativo Electron. JÃ¡ recebeu commits anteriores para os testes de Chatterbox/ElevenLabs. NÃ£o copiar o app.py/requirements desse laboratÃ³rio para o projeto Electron.
- **chatterbox-ptbr:** repositÃ³rio separado ligado ao Hugging Face Space; nÃ£o alterar nem fazer push nele.

## Estado Git do Aurora desktop

- A branch `feature/live2d-avatar` foi criada localmente a partir de `poc/avatar-audio-lipsync`.
- A branch `main` nÃ£o foi alterada.
- Antes de criar esta documentaÃ§Ã£o, o script exige uma Ã¡rvore de trabalho limpa e confirma que estÃ¡ exatamente na branch `feature/live2d-avatar`.
- A POC de Ã¡udio/lipsync ainda nÃ£o foi integrada Ã  `main`.

## O aplicativo desktop atual

- Electron frameless/transparente, React 18, TypeScript, Vite 6 e Three.js.
- DependÃªncias VRM atuais: `three` e `@pixiv/three-vrm`.
- Componente visual atual: `src/components/Avatar3D.tsx`, que carrega `public/models/aurora-anime.vrm`.
- A janela Electron jÃ¡ tem `transparent: true`, `frame: false` e fundo `#00000000`.
- A captura de tela e o controle assistido jÃ¡ existem em `electron/main.cjs` / preload / `src/App.tsx`. A execuÃ§Ã£o de aÃ§Ãµes no computador tem validaÃ§Ãµes e confirmaÃ§Ã£o do usuÃ¡rio. Preservar esses recursos; nÃ£o fazer execuÃ§Ã£o arbitrÃ¡ria de comandos.
- A voz atualmente integrada ao desktop ainda usa `node-edge-tts` (Leticia Neural). O ElevenLabs foi testado separadamente no laboratÃ³rio NOVAAURORA, mas nÃ£o estÃ¡ conectado ao desktop.

## O que a POC de lipsync jÃ¡ oferece

A branch de origem `poc/avatar-audio-lipsync` contÃ©m alteraÃ§Ãµes em `src/components/Avatar3D.tsx` e `src/App.tsx` para passar `emotion` e um `AnalyserNode` ao avatar. O componente calcula RMS do Ã¡udio com `getByteTimeDomainData` e suaviza a abertura da boca. TambÃ©m hÃ¡ estados de emoÃ§Ã£o como happy/sad/surprised/curious. Reaproveitar a lÃ³gica de anÃ¡lise RMS para o parÃ¢metro Live2D, nÃ£o copiar as expressÃµes VRM literalmente.

## Arquivos Live2D da personagem â€” manter locais

Pasta local do material BOOTH: `D:\Aurora-TTS-Lab\AURORA BOOTH AVATAR`.

O protÃ³tipo inicial escolhido Ã© `6xb`:

- `6xb.model3.json` referencia `6xb.moc3`.
- Texturas: `6xb.4096\texture_00.png` e `6xb.4096\texture_01.png`.
- FÃ­sica: `6xb.physics3.json`.
- Display info: `6xb.cdi3.json`.
- ParÃ¢metros de boca: `ParamMouthOpenY` (abertura) e `ParamMouthForm` (formato).
- Piscada: `ParamEyeLOpen` e `ParamEyeROpen`.
- O model3 contÃ©m o grupo `LipSync` com `Ids: []`; isso nÃ£o impede o controle direto do parÃ¢metro `ParamMouthOpenY`.
- HÃ¡ expressÃµes `1.exp3.json` a `10.exp3.json`, `a.exp3.json`, `b.exp3.json` e `fz.exp3.json`. Em `6xb.prprl2d.json`, as teclas A/S/D/F/G/H/J/K estÃ£o associadas respectivamente a `Param4`, `Param5`, `Param6`, `Param7`, `Param8`, `Param9`, `Param10` e `Param28`.
- `6xb.prprl2d.json` tem mapeamentos faciais para cabeÃ§a, olhos, sobrancelhas e boca; Ã© um formato de configuraÃ§Ã£o adicional do pacote, nÃ£o um arquivo Live2D padrÃ£o que o Cubism model3 necessariamente carrega.
- NÃ£o foram encontrados arquivos `motion3.json` na listagem atual. A animaÃ§Ã£o idle/respiraÃ§Ã£o/balanÃ§o deverÃ¡ ser criada no app ou com os parÃ¢metros/physics existentes.

O pacote tambÃ©m contÃ©m o segundo modelo `xl`, mas o primeiro protÃ³tipo Ã© `6xb`.

## SDK Live2D local

Pasta local: `D:\Aurora-TTS-Lab\LIVE2D SDK`.

- `Core\live2dcubismcore.js`, `live2dcubismcore.min.js` e `live2dcubismcore.d.ts` aparecem na lista `Core\RedistributableFiles.txt`.
- `Framework\src` contÃ©m o Framework TypeScript.
- Exemplo oficial: `Samples\TypeScript\Demo\src`.
- A configuraÃ§Ã£o do exemplo Ã© `vite.config.mts` (nÃ£o `vite.config.ts`). O alias `@framework` aponta para `../../../Framework/src`.
- InicializaÃ§Ã£o do exemplo: `LAppDelegate.initialize()` chama `CubismFramework.startUp()` e `CubismFramework.initialize()`, cria canvas e `LAppSubdelegate`; o manager cria `LAppModel`, carrega o model3 e desenha.
- O exemplo foi feito para um demo com canvas adicionado em `document.body`; nÃ£o copiar sem adaptar para um Ãºnico canvas dentro do elemento React do avatar.
- AtenÃ§Ã£o Ã  transparÃªncia: inspecionar/adaptar o `gl.clearColor` do exemplo (ele usa alpha 1.0 no `LAppSubdelegate.update()`), de modo que o canvas/renderer preserve alpha e limpe com alpha 0.0.

## Progresso tÃ©cnico confirmado

- Os formatos dos arquivos e os caminhos do model3/texturas/physics foram identificados.
- Foi confirmada a branch `feature/live2d-avatar` local.
- Ainda **nÃ£o** foram copiadas dependÃªncias Live2D para o aplicativo, nÃ£o foi escrito o renderer Live2D e nÃ£o foi feito build/teste de personagem dentro do Electron.
- O erro anterior de `vite.config.ts` no demo era apenas o nome incorreto; o arquivo correto Ã© `vite.config.mts`.

## LicenÃ§as e limites para este checkpoint

- O diretÃ³rio do pacote BOOTH nÃ£o contÃ©m README, LICENSE, termos ou instruÃ§Ãµes localizadas pela busca de nomes. A pÃ¡gina consultada tambÃ©m nÃ£o apresentou termos de uso identificÃ¡veis durante esta sessÃ£o. **NÃ£o enviar ao GitHub** o `.zip`, `.moc3`, texturas `.png`, `.physics3.json`, `.exp3.json`, `.cdi3.json`, `.prprl2d.json`, nem qualquer outro arquivo do personagem. Manter somente na mÃ¡quina atÃ© conseguir confirmaÃ§Ã£o escrita/termos claros do criador para uso no aplicativo e eventual redistribuiÃ§Ã£o.
- O `Core\RedistributableFiles.txt` lista trÃªs arquivos do Core como redistribuÃ­veis sob a licenÃ§a proprietÃ¡ria, mas isso nÃ£o Ã© autorizaÃ§Ã£o genÃ©rica para arquivÃ¡-los num repositÃ³rio GitHub como backup. NÃ£o enviar o SDK/Core/Framework inteiro ao GitHub neste checkpoint; guardar o SDK na pasta local indicada e preservar os avisos/licenÃ§as. Avaliar distribuiÃ§Ã£o do runtime apenas conforme os contratos Live2D aplicÃ¡veis.
- A licenÃ§a Open Software da Live2D define â€œExpandable Applicationâ€ incluindo aplicaÃ§Ãµes que podem carregar/generar quantidades indefinidas de modelos por adiÃ§Ã£o/combinaÃ§Ã£o de arquivos/dados, como avatares. Ela exige acordo especÃ­fico de publicaÃ§Ã£o para publicar aplicaÃ§Ãµes expansÃ­veis. A pÃ¡gina oficial tambÃ©m informa que a isenÃ§Ã£o para indivÃ­duos/pequenas empresas nÃ£o abrange aplicaÃ§Ãµes expansÃ­veis. A classificaÃ§Ã£o da Aurora deve ser confirmada diretamente com Live2D antes de qualquer distribuiÃ§Ã£o pÃºblica/comercial; nÃ£o presumir isenÃ§Ã£o.
- Este repositÃ³rio checkpoint contÃ©m apenas cÃ³digo/documentaÃ§Ã£o prÃ³pria do projeto e caminhos locais; nÃ£o inclui SDK nem assets BOOTH.

## PrÃ³ximas etapas para o prÃ³ximo chat

1. Confirmar que o push da branch `feature/live2d-avatar` concluiu.
2. Inspecionar a estrutura/imports completos do exemplo Live2D e APIs do `LAppModel` (obter modelo subjacente, `update`, `draw`, parÃ¢metros, carregamento de expressÃµes).
3. Definir estratÃ©gia de dependÃªncia local do Framework e do Core sem comprometer licenÃ§as ou alterar a `main`.
4. Copiar localmente o `6xb` para uma pasta ignorada pelo Git, por exemplo `public/models/booth-6xb/`, preservando os arquivos originais.
5. Criar componente React `Live2DAvatar` com um canvas Ãºnico dentro de `.avatar-canvas`; nÃ£o adicionar canvas ao `document.body`.
6. Inicializar Cubism, carregar `6xb.model3.json`, desenhar com alpha transparente e redimensionamento compatÃ­vel com `ResizeObserver`.
7. Testar primeiro somente a renderizaÃ§Ã£o visual. Depois ligar RMS do `AnalyserNode` ao parÃ¢metro `ParamMouthOpenY`, expressÃµes aos estados emocionais e movimentos sutis/physics.
8. Preservar chat, voz, captura de tela, aÃ§Ãµes com confirmaÃ§Ã£o e controles existentes.
9. Rodar `npm run build`, corrigir erros e sÃ³ entÃ£o executar `npm run dev` para teste visual.

## Importante para continuidade

NÃ£o presumir que a integraÃ§Ã£o Live2D jÃ¡ existe. NÃ£o misturar o repositÃ³rio NOVAAURORA com Aurora-assistente. NÃ£o enviar assets BOOTH ou o pacote SDK para o GitHub sem autorizaÃ§Ã£o/licenÃ§a apropriada. Continuar na branch `feature/live2d-avatar` e manter `main` intacta.
