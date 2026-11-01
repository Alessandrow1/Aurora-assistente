# Geração de imagens da Aurora

A Aurora usa o **ComfyUI local** como motor de geração. O Qwen e a conversa continuam no Ollama; imagens são produzidas pelo serviço separado do ComfyUI, sem enviar prompts ou imagens para uma API de geração na nuvem.

## Preparação única

1. Instale e inicie o ComfyUI para Windows.
2. Baixe um checkpoint compatível com Stable Diffusion, como SD 1.5 ou SDXL, e coloque o arquivo .safetensors ou .ckpt em ComfyUI/models/checkpoints.
3. Inicie o servidor padrão do ComfyUI em http://127.0.0.1:8188. Mantenha o ComfyUI aberto enquanto a Aurora gerar imagens.

A Aurora detecta os checkpoints disponíveis automaticamente. Se encontrar um modelo SDXL Base, ele será priorizado; caso contrário, usa o primeiro checkpoint encontrado. O fluxo inicial usa apenas os nós nativos do ComfyUI.

## Como gerar

No chat, clique no botão de imagem para inserir o comando e complete a descrição. Exemplo:

Aurora, gere uma imagem de um gato astronauta caminhando em Marte, pintura digital cinematográfica.

Também é possível falar o pedido enquanto o modo de voz estiver ativo. A imagem aparece dentro da conversa e fica salva na pasta local de dados da Aurora. O botão abaixo da imagem abre essa pasta.

## Requisitos e limites

- O ComfyUI e um checkpoint precisam ser instalados à parte. O repositório não inclui modelos grandes nem uma distribuição do ComfyUI.
- O fluxo padrão produz uma imagem quadrada por pedido, em 512 × 512 (SD 1.5) ou 768 × 768 (SDXL), com 22 passos.
- O tempo depende da GPU, da memória de vídeo, do checkpoint e da fila atual do ComfyUI.
- Por segurança, a Aurora só conversa com o servidor local em 127.0.0.1:8188; não aceita endereços remotos vindos da interface.
- O histórico guarda o identificador local da imagem e tenta restaurar a prévia ao reabrir a conversa. Os arquivos ficam em userData/generated-images.
