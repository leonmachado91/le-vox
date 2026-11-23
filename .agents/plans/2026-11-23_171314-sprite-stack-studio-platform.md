# Plano: Sprite Stack Studio Core — Motor Gráfico Agnóstico & Skill de Criação Visual

**Objetivo:** Empacotar um motor gráfico WebGL2 estável, leve e agnóstico para renderização 3D em estética pixel art / sprite-stacking (com DSL declarativa, importadores, prefabs, animação IK e hooks de controle/captura), acompanhado de uma skill reutilizável por qualquer agente ou projeto consumidor.
**Tipo:** arquitetura e implementação
**Projeto alvo:** `/home/leon/Documentos/sprite-stack-studio`

## Contexto confirmado
- Base existente em `/home/leon/Documentos/sprite-stack-studio/`:
  - `sprite-stack-engine/` (upstream `loktar00/sprite-stack-engine` intacto: `art.js`, `rig.js`, `engine.js`).
  - `sprite-stacking/` (upstream `danielwh2/sprite-stacking` intacto: `views_to_slices.py` funcional com `Pillow` + `numpy`).
  - `scenes/` com 3 provas visuais funcionais (`turbo86-garage/`, `lost-crash/`, `neon-arena/`).
- Limites técnicos reais identificados nos protótipos:
  - Rotação apenas no eixo Z (`a_rot`) por instância.
  - Limite fixo de `8` lâmpadas dinâmicas (`LAMPS = 8`) e `48` passos fixos no *shadow march*.
  - Dither Bayer 4×4 + quantização rodam em um 2º canvas WebGL2 separado (`post_dither.js`).
  - Modelagem direta por fórmulas `fn(x, y, z)` aumenta custo de geração para agentes e dificulta reuso entre projetos.

## Estratégia
- Separar estritamente o **motor visual** de qualquer lógica de aplicação (jogos, pipelines de vídeo ou UIs externas).
- Construir o pacote em `/home/leon/Documentos/sprite-stack-studio/core/` + `prefabs/` + `skill/` mantendo os repositórios originais intactos.
- Expor apenas primitivas visuais puras e agnósticas: montagem de cena declarativa, controle determinístico de tempo/câmera (`setTime`, `setCamera`, `screenToWorld`), efeitos de fatia (`sliceFX`) e captura de imagem/canvas para que ferramentas externas gravem vídeo, montem jogos ou incorporem em UIs próprias.

---

## Fatias e tarefas

### 1. Motor de Renderização Evoluído (`core/engine.js`)
- **Critérios:** AC-01 (dither e quantização integrados em 1 passada, `pitch/roll` por instância, iluminação escalável e perfil leve sem GPU dedicada).
- **Arquivos:**
  - Criar `/home/leon/Documentos/sprite-stack-studio/core/engine.js`
- **Contrato:**
  - Suportar `pitch` e `roll` opcionais além de `rot` (yaw) por instância nos shaders `VS_VOXEL` e `VS_SLICE`, com *ray-walk* transformado para o espaço local da instância.
  - Integrar Bayer 4×4 + quantização (Posterize e Paletas OKLab) + *outline* 1px opcional direto no `FS_POST` em passada única.
  - Aumentar `LAMPS` de `8` para `32` com seleção automática por distância ao foco da câmera.
  - Expor parâmetros de qualidade em `E.render(opt)`: `scale` (1–6×), `shadowSteps` (`0 | 16 | 32 | 48`), `aoSamples` (`0 | 8 | 16`), `voxel` (`auto | true | false`) e `dither` (`{ enabled, strength, levels, palette }`).
  - Exportar `E.screenToWorld(cam, sx, sy, planeZ)` diretamente na API pública.
- **Prova:** Página de verificação `core/verify.html` + script em Node validando `node --check`, zero erros de shader e renderização comparativa `dither ON/OFF` e `pitch/roll`.
- **Risco:** Erro de precisão em `depthOf` ou `WALK` com `pitch/roll` próximos a 90°; mitigar calculando a matriz inversa 3×3 por instância no vertex shader e validando com caixa rotacionada em múltiplos ângulos.

### 2. DSL Declarativa, Importadores e Biblioteca de Prefabs (`core/art.js`, `core/dsl.js`, `core/importers.js`, `prefabs/`)
- **Critérios:** AC-02 (criar assets com menos código/tokens e importar ativos 2D/voxel externos sem reescrever matemática).
- **Arquivos:**
  - Criar `/home/leon/Documentos/sprite-stack-studio/core/art.js`
  - Criar `/home/leon/Documentos/sprite-stack-studio/core/dsl.js`
  - Criar `/home/leon/Documentos/sprite-stack-studio/core/importers.js`
  - Criar `/home/leon/Documentos/sprite-stack-studio/core/rig.js`
  - Criar `/home/leon/Documentos/sprite-stack-studio/prefabs/` (`vehicles.js`, `architecture.js`, `nature.js`, `props.js`, `characters.js`)
- **Contrato:**
  - `DSL.compile(spec)` transforma JSON declarativo (`box`, `cyl`, `ellipsoid`, `ramp`, `dome`, `subtract`, `paint`, `mirrorY`, `noiseFill`) em definição compatível com `Art.buildStack`, mantendo normais suavizadas em raio de 2px.
  - `Importers.fromVox(arrayBuffer)` lê arquivos MagicaVoxel `.vox` (`SIZE`, `XYZI`, `RGBA`) e `Importers.fromSliceStrip(image, frameW, frameH)` converte tiras horizontais PNG (como saída do `views_to_slices.py`) em stacks nativas com normais 3D.
  - Prefabs parametrizáveis (ex: `Prefabs.coupe({ color, stripe })`, `Prefabs.palmTree({ height })`, `Prefabs.humanoid({ palette })`) prontos para instanciar e recolorir.
- **Prova:** Teste automatizado em Node (`tests/test_core.mjs`) compilando specs da DSL, decodificando um buffer `.vox` binário sintético e empacotando todos os prefabs em um `Art.Atlas(2048)` sem materiais ausentes ou estouro de atlas.
- **Risco:** Estouro do `Atlas(2048)` se cenas importarem muitos assets grandes juntos; mitigar expondo `atlasSize` configurável (`2048 | 4096`) e métrica clara de ocupação (`atlas.usage()`).

### 3. Camada de Cena Agnóstica & Hooks de Integração (`core/studio.js`, `core/scene-schema.md`)
- **Critérios:** AC-03 (instanciar, animar e capturar quadros de qualquer cena por configuração simples, pronto para ser acoplado por qualquer host externo).
- **Arquivos:**
  - Criar `/home/leon/Documentos/sprite-stack-studio/core/studio.js`
  - Criar `/home/leon/Documentos/sprite-stack-studio/core/scene-schema.md`
- **Contrato:**
  - `Studio.mount(canvas, sceneSpec, options)` inicializa atlas, height map, chunks `48×48` com *frustum culling*, `ResizeObserver`, iluminação por `tod` e câmera (`ortho | persp`, `orbit`, `free`).
  - Controle externo limpo para qualquer consumidor:
    - `instance.updateScene(patch)` / `instance.setTime(tSec)` (atualização determinística para timeline ou simulação externa).
    - `instance.setCamera(cam)` e `instance.screenToWorld(x, y, z)`.
    - `instance.renderFrame()` e `instance.readPixels() / toBlob()` para captura externa quando necessário.
    - `instance.pause()` / `instance.resume()` / `instance.destroy()` para ciclo de vida seguro dentro de UIs ou abas ocultas.
- **Prova:** Teste em Node validando parsing de `sceneSpec`, *frustum culling* de chunks e `setTime(t)` determinístico, além de migração limpa de uma das cenas existentes (`turbo86-garage`) como prova de equivalência visual.
- **Risco:** Vazamento de contextos/buffers WebGL2 em mounts repetidos por hosts externos; mitigar implementando `destroy()` explícito liberando texturas, FBOs, VAOs e observers.

### 4. Empacotamento e Skill Agnóstica (`skill/SKILL.md` + `dist/`)
- **Critérios:** AC-04 (pacote único autocontido e skill agnóstica pronta para ser copiada/usada por qualquer agente sem depender de caso de uso específico).
- **Arquivos:**
  - Criar `/home/leon/Documentos/sprite-stack-studio/dist/sprite-stack-studio.js` (bundle único sem dependências externas, compatível com `file://` e `<script>` ou ESM).
  - Criar `/home/leon/Documentos/sprite-stack-studio/skill/SKILL.md` (manual objetivo de uso para agentes: contrato do `Studio`, sintaxe da DSL, importadores `.vox`/`slices.png`, tabela de prefabs, regras de performance sem GPU e hooks `setTime`/`renderFrame`/`screenToWorld`).
- **Contrato:**
  - A skill ensina exclusivamente como modelar, compor cenas, configurar iluminação/dither/câmera e expor os ganchos do motor — sem acoplar lógica de jogo, áudio, vídeo ou plugin específico.
  - O `dist/` funciona offline sem servidor ou build no projeto consumidor.
- **Prova:** Build do bundle via `node` + teste carregando o bundle em isolamento (`tests/test_bundle.mjs`) validando toda a API pública (`Art`, `Rig`, `DSL`, `Importers`, `Prefabs`, `Studio`).
- **Risco:** Divergência entre código modular em `core/` e o bundle em `dist/`; mitigar incluindo um script simples `scripts/build_dist.mjs` que concatena/empacota na hora e valida o resultado.

---

## Validação final
1. Suite `tests/` em Node (`tests/test_core.mjs`, `tests/test_bundle.mjs`) passando 100%.
2. Validação `node --check` em todos os arquivos `.js` de `core/`, `prefabs/` e `dist/`.
3. Cena de referência (`turbo86-garage` ou equivalente) rodando sobre `core/` com paridade ou melhoria visual sobre a versão anterior.
4. Cenas atuais (`scenes/turbo86-garage`, `scenes/lost-crash`, `scenes/neon-arena`) preservadas funcionando.

## Decisões e perguntas restantes
- Confirmar após a implementação onde você deseja instalar/referenciar a skill agnóstica (`skill/SKILL.md`) nos perfis (ex: global `~/.hermes/skills/` ou perfis específicos).
