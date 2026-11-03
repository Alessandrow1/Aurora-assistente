# Aurora Skills

As habilidades da Aurora são arquivos Markdown locais carregados pelo núcleo Electron conforme o assunto da conversa.

## Habilidades incluídas

- `aurora-identity/SKILL.md`: identidade, personalidade, limites e relação com o avatar.
- `live2d-self-perception/SKILL.md`: observação do próprio avatar a partir de uma captura real do canvas Live2D.
- `computer-environment/SKILL.md`: data/hora local, sistema operacional, recursos e limites de percepção do computador.
- `file-finder/SKILL.md`: busca de nomes de arquivos e pastas nas pastas pessoais autorizadas.

## Como adicionar uma habilidade interna

1. Crie uma pasta dentro de `skills/` e coloque nela um arquivo `SKILL.md`.
2. Registre o identificador, título e caminho no objeto `BUILT_IN_SKILLS` em `electron/aurora-skills.cjs`.
3. Adicione a regra de ativação em `selectSkills()`.
4. Acrescente testes para a nova ativação ou ferramenta.

Os arquivos SKILL.md fornecem instruções de comportamento e conhecimento. Eles não executam código nem concedem acesso a ferramentas. Todas as ações continuam mediadas por funções explícitas do Electron e pelas permissões do aplicativo.
