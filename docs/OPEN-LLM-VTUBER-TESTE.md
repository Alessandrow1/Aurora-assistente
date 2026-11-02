# Teste híbrido: Open-LLM-VTuber com a Aurora

## Objetivo

Este é um experimento isolado. A Aurora original continua sendo o projeto principal; o teste não troca seu Electron, não altera o package.json, não substitui ElevenLabs/Kokoro e não modifica o avatar que ela usa hoje.

O teste usa a versão estável fixada do [Open-LLM-VTuber v1.2.1](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/releases/tag/v1.2.1), o mesmo Ollama/Qwen instalado no computador e uma cópia do Live2D 6xb.

## O que será comparado

| Parte | Aurora atual | Ambiente de teste |
|---|---|---|
| LLM | Ollama + Qwen 3.5 9B | O mesmo Ollama + Qwen 3.5 9B |
| ASR | Sherpa/Whisper Tiny já instalado na Aurora | Faster-Whisper base, CPU int8, idioma pt |
| Detecção de fala | Silero VAD / pipeline atual | Silero VAD do Open-LLM-VTuber |
| Voz | Provedores configurados na Aurora | Edge TTS pt-BR-LeticiaNeural, para ter uma configuração inicial sem chave |
| Avatar | Live2D 6xb integrado na Aurora | Cópia separada do Live2D 6xb |
| Memória | Memórias explícitas e armazenamento local da Aurora | Histórico básico da sessão; Letta não será ligado neste primeiro teste |

**Atenção:** a comparação de ASR, VAD, LLM e interrupção é útil, mas a voz não será uma comparação de qualidade equivalente porque o teste usa Edge TTS. A Aurora mantém seus provedores atuais sem alterações.

## Preparação no Windows

Pré-requisitos: Git, uv, FFmpeg, Ollama em execução e o modelo Qwen instalado. O projeto exige Python entre 3.10 e 3.12; o script solicita Python 3.12 pelo uv.

No terminal, dentro da pasta local do repositório Aurora:

~~~powershell
git fetch origin
git switch experiment/open-llm-vtuber-hybrid
git pull --ff-only origin experiment/open-llm-vtuber-hybrid
~~~

Instale as ferramentas que estiverem faltando:

~~~powershell
winget install --id Git.Git -e
winget install --id astral-sh.uv -e
winget install ffmpeg
~~~

Feche e reabra o terminal depois de instalar ferramentas. Em seguida execute o preparador:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-open-llm-vtuber-test.ps1
~~~

Por padrão, o teste será instalado em uma pasta irmã da Aurora chamada Open-LLM-VTuber-Test-v1.2.1. Nada será instalado dentro da pasta de produção da Aurora. Para escolher outro destino:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-open-llm-vtuber-test.ps1 -TargetPath "D:\IA\Open-LLM-VTuber-Test"
~~~

O script verifica se qwen3.5:9b está presente no Ollama antes de clonar o projeto. Para usar outro modelo, passe -OllamaModel "nome-do-modelo". O projeto de teste mantém o modelo residente no Ollama (keep_alive: -1) e não pede para descarregá-lo ao sair.

## Iniciar e encerrar

Depois que o preparador terminar, abra outro PowerShell:

~~~powershell
Set-Location "$env:USERPROFILE\Desktop\AURORA\Open-LLM-VTuber-Test-v1.2.1"
uv run run_server.py
~~~

A pasta padrão pode variar conforme o local do repositório. Use o caminho que o script imprimiu no final. Abra http://127.0.0.1:12393 no navegador.

Para encerrar, volte ao terminal do servidor e pressione Ctrl+C. Não execute Aurora e Open-LLM-VTuber simultaneamente durante a medição: ambos usam o mesmo Ollama e competiriam por CPU e memória.

## Configuração aplicada ao ambiente de teste

- LLM: ollama_llm apontando para http://127.0.0.1:11434/v1, com o mesmo modelo escolhido no script.
- Resposta antecipada: habilitada (faster_first_response).
- ASR: Faster-Whisper base, CPU, int8, idioma português. Os pesos serão baixados no primeiro uso.
- VAD: Silero.
- TTS: Edge TTS com voz brasileira pt-BR-LeticiaNeural.
- Avatar: a cópia recebe o nome aurora-6xb. O preparador verifica os arquivos referenciados pelo modelo e mapeia ParamMouthOpenY no grupo LipSync somente na cópia.

O arquivo 6xb atual não declara um conjunto de expressões no 6xb.model3.json. Por isso, este primeiro teste não inventa um mapa de expressões nem liga arquivos .exp3 sem conferir seus identificadores. O objetivo inicial é validar carregamento visual e movimento da boca; as expressões ficam para uma etapa própria.

O teste usa o agente básico. A memória de longo prazo via Letta não será habilitada agora: ela exige um serviço adicional e mudaria a variável de latência que queremos medir. Também não será configurado Piper ou Kokoro dentro deste framework nesta primeira passagem; a voz é mantida deliberadamente simples e gratuita.

## Roteiro A/B

Faça primeiro o teste na Aurora atual e depois no Open-LLM-VTuber. Antes de cada rodada, feche o outro aplicativo. Use o mesmo modelo e, quando possível, as mesmas condições de temperatura/estado do Ollama.

| Medida | Como observar | Aurora | Open-LLM-VTuber |
|---|---|---:|---:|
| Tempo até primeira fala | Do fim da sua frase até o primeiro áudio audível | | |
| Tempo de resposta completa | Do fim da sua frase até o fim da fala | | |
| Precisão da transcrição | Conte erros em 5 frases em português | | |
| Interrupção | Fale por cima da resposta e meça quanto demora para parar | | |
| Continuidade | Faça 3 perguntas encadeadas sobre o mesmo assunto | | |
| Avatar | Carrega? Pisca? A boca acompanha a fala? | | |
| CPU/RAM | Observe no Gerenciador de Tarefas | | |
| Estabilidade | Teste por 10 minutos sem travar ou perder o microfone | | |

Use também estas frases, nas duas instalações:

1. “Me explique em duas frases a diferença entre memória RAM e armazenamento.”
2. “Se um produto custa 80 reais e recebe 15% de desconto, quanto eu pago?”
3. “Nesta conversa, use a palavra-chave AZUL-731 como referência. Agora me diga qual referência eu acabei de passar.”
4. Durante uma resposta falada, interrompa com: “Aurora, espera, deixa eu terminar.”
5. Faça uma frase longa em português brasileiro, com nomes próprios, números e pontuação.

Registre a mediana de pelo menos cinco respostas para a latência, não apenas a melhor tentativa. Anote também se o primeiro áudio começa mais cedo, mas fica truncado ou artificial.

## Como interpretar o resultado

- Se o tempo até a primeira fala melhorar bastante, vale estudar o streaming de frases do Open-LLM-VTuber para trazer essa ideia à Aurora.
- Se a interrupção for mais confiável, vale portar apenas a lógica de VAD/interrupção, depois de testar o microfone e o cancelamento de TTS.
- Se Faster-Whisper base não superar o Whisper Tiny em velocidade ou precisão, mantenha o ASR atual. O processador do computador é forte, mas a GT 1030 tem pouca VRAM; por isso o teste está em CPU int8, sem presumir aceleração CUDA.
- Se o avatar não carregar ou não sincronizar a boca, isso é um bloqueio de compatibilidade a resolver antes de qualquer migração. A personagem original não será substituída.
- Se a qualidade geral não for claramente superior, mantemos a arquitetura Aurora e aproveitamos só o componente que demonstrar ganho real.

## Segurança e reversão

A branch experiment/open-llm-vtuber-hybrid contém apenas scripts e documentação do experimento. A pasta externa do Open-LLM-VTuber pode ser apagada depois do teste sem remover dados da Aurora. O modelo Live2D original e as configurações atuais da Aurora permanecem no lugar.

Fontes oficiais:
- [Open-LLM-VTuber v1.2.1](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/releases/tag/v1.2.1)
- [Guia de instalação](https://open-llm-vtuber.github.io/)
- [Guia de ASR](https://open-llm-vtuber.github.io/docs/ASR/)
- [Guia de Live2D](https://open-llm-vtuber.github.io/docs/Live2D/)
