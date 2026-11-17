# Contorno

Planejador de rotas web em que o usuário declara por onde **não** quer passar, e a rota obedece. O usuário desenha no mapa a área que quer evitar (ou define um raio a partir de um endereço) e escolhe quais classes de via prefere evitar; o sistema calcula a melhor rota dentro do espaço permitido, mostra quanto a escolha custou em tempo e distância e, quando não há rota possível, aponta qual restrição bloqueou o trajeto.

Recorte do MVP: São Leopoldo e Novo Hamburgo (RS), sobre dados abertos do OpenStreetMap.

> **Estado:** MVP concluído na Sprint 6, versão [`v1.0.0`](https://github.com/frsrodrigobocayuva/Contorno/releases/tag/v1.0.0). O acompanhamento do projeto (quadro, sprints, wiki com a arquitetura e os ADRs) está no Azure DevOps.

## Funcionalidades

Das 8 funcionalidades planejadas no Grau A, 7 foram entregues e 1 foi cortada do MVP. Entraram também 3 além do plano. No total, são 10 entregues.

| # | Funcionalidade | Caso de uso |
|---|---|---|
| 1 | Origem e destino por busca de endereço ou toque no mapa (pontos fora da região são recusados) | UC01, UC06 |
| 2 | Rota normal (irrestrita) como linha de base, com tempo e distância | UC01 |
| 3 | Área proibida desenhada no mapa, com o contorno das células que o sistema aplica | UC02 |
| 4 | Área por raio a partir de um endereço, de 100 m a 2 km | UC02, UC06 |
| 5 | Preferências por classe de via: indiferente, evitar ou evitar fortemente | UC03 |
| 6 | Rota que obedece, sobreposta à normal, com o custo "+X min · +Y km" | UC01 |
| 7 | Diagnóstico: quando não há caminho, aponta as áreas que bloqueiam o trajeto | UC05 |
| + | Identidade visual e movimento: paleta, Atkinson Hyperlegible, brilho da rota e transições | — |
| + | Usabilidade do desenho e da rota: Desfazer área, confirmação ao cancelar, Esc em dois níveis, painéis com rolagem própria | — |
| + | Mapa base vetorial, nítido em qualquer zoom | — |

**Fora do MVP:**
- os perfis de restrição (funcionalidade 8, UC04: salvar, reaplicar, editar e excluir);
- desativar a área apontada pelo diagnóstico só para aquela consulta;
- o deploy público, adiado.

## Pilha

| Parte | Tecnologia |
|---|---|
| Cliente | React + TypeScript, Vite |
| Mapa | MapLibre GL JS; mapa base vetorial do OpenFreeMap, com estilo próprio (ADR-016) |
| Servidor | Python 3.13, FastAPI |
| Motor de rotas | GraphHopper 11.1 (CH para a rota irrestrita; LM para a restrita) |
| Dados | Extrato OpenStreetMap da Geofabrik, recortado com osmium |
| Ambiente | Docker Compose |

## Pré-requisitos

- Docker Desktop (com WSL2, no Windows)
- Para desenvolver: Python 3.13 e Node 24 LTS

## Subir a aplicação

```bash
cp .env.example .env    # preencha o contato em NOMINATIM_USER_AGENT: sem ele a API não sobe
docker compose up --build
```

Abra http://localhost:8000. A primeira subida importa o grafo do GraphHopper e prepara as acelerações CH e LM (cerca de 20 s no recorte atual); as seguintes reaproveitam o volume `graph-cache`. `http://localhost:8000/health` responde `200` quando a API e o motor estão no ar.

Só a porta 8000 é publicada. O GraphHopper fica na rede interna do compose.

A API, na mesma porta (contrato completo em `/docs`):

| Rota | O que faz |
|---|---|
| `POST /rotas/calculo` | rota normal entre origem e destino (`[longitude, latitude]`) e, com áreas ou preferências de via em `restricoes`, a rota que obedece; ou o diagnóstico quando não há caminho |
| `POST /restricoes/area` | o desenho de uma área (`poligono`) ou um raio sobre um ponto (`raio: {centro, metros}`, de 100 m a 2 km) vira células H3: devolve as células, o contorno, o `desenho` coberto (o polígono ou o círculo), a área desenhada e a proibida em m² e os conflitos com a origem e o destino |
| `GET /enderecos?q=` | até 5 endereços em São Leopoldo e Novo Hamburgo; sem resultado, lista vazia com o motivo |
| `GET /health` | 200 quando a API e o motor estão no ar |

## Desenvolver

```bash
# Python
py -3.13 -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # Linux/macOS: .venv/bin/pip
.venv/Scripts/pre-commit install

# Front
cd web && npm ci && npm run dev    # chamadas à API vão para localhost:8000
```

Verificações (o `pytest` roda com a rede bloqueada; só os testes de contrato podem abrir conexão):

```bash
ruff check . && ruff format --check . && mypy && pytest
cd web && npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

Testes de contrato contra o GraphHopper real, dentro da rede do compose, com o conjunto de validação de rotas (D16: nenhuma rota restrita cruza o contorno):

```bash
docker compose run --rm dev pytest tests/contrato --no-cov
```

Ponta a ponta (Playwright), contra o app do compose em `localhost:8000`:

```bash
cd web
npx playwright install chromium   # uma vez
npm run e2e
```

Tipos do contrato da API: quando a API mudar, gere de novo o OpenAPI e os tipos TypeScript, e versione os dois (`web/src/api/openapi.json` e `web/src/api/schema.ts`):

```bash
python -m app.api.exportar_openapi web/src/api/openapi.json
cd web && npm run generate:api-types
```

## Medições

Os scripts das medições do DAS 8 ficam em `motor/medicoes/` e rodam no serviço `dev`, dentro da rede do GraphHopper (compose no ar):

```bash
docker compose run --rm dev python motor/medicoes/resolucao.py     # [1] resolução H3 (A1)
docker compose run --rm dev python motor/medicoes/vias.py          # [2] classes de via e surface (D13)
docker compose run --rm dev python motor/medicoes/fatores.py       # [3] fatores de via (A3)
docker compose run --rm dev python motor/medicoes/diagnostico.py   # [5] diagnóstico (A2)
```

Os resultados ficam registrados no ADR-010 e no DAS 8, na wiki do projeto.

## Integração contínua

O GitHub Actions (`.github/workflows/ci.yml`) roda a cada PR para a `main` e a cada push na `main`. Os quatro checks são obrigatórios para o merge:

| Check | O que verifica |
|---|---|
| `python` | Ruff, mypy, testes sem rede e cobertura mínima de 90% em domínio e aplicação |
| `web` | Prettier, ESLint, TypeScript, Vitest e build |
| `openapi` | se os tipos versionados do contrato estão atualizados |
| `integracao` | sobe o compose com o GraphHopper e roda os testes de contrato |

O CI nunca chama os serviços públicos da OSM nem o OpenFreeMap, de onde vêm os tiles do mapa base vetorial (ADR-016): os hosts do Nominatim e dos tiles ficam bloqueados, e o serviço `falsos` (`compose.ci.yaml`) responde com as buscas gravadas em `tests/falsos/nominatim/`. Sem os tiles, o mapa fica só com o fundo do estilo, e os testes ponta a ponta conferem esse fundo e a atribuição. Para regravar as buscas (decisão explícita; usa o `NOMINATIM_USER_AGENT` do `.env`):

```bash
python tests/falsos/gravar_nominatim.py
```

## Dados do mapa

O recorte versionado fica em `motor/dados/recorte-sl-nh.osm.pbf`, e a fonte, a data e os hashes em `motor/dados/recorte-sl-nh.json`. Para regenerá-lo (decisão explícita):

```bash
python motor/recortar_extrato.py --data AAMMDD
docker compose down && docker volume rm contorno_graph-cache
```

Os dados são © OpenStreetMap contributors, sob a licença ODbL. O mapa base vem do OpenFreeMap (© OpenMapTiles), feito com os mesmos dados.

## Estrutura

```
app/        servidor, uma pasta por camada (api, aplicacao, dominio, infra)
web/        cliente React
motor/      GraphHopper: Dockerfile, config.yml e recorte do extrato
tests/      dominio, aplicacao, contrato, arquitetura; falsos da OSM para o CI
```

## Contribuição

O fluxo de trabalho (branches, commits, Definição de Pronto, padrões de código) está na wiki do projeto, em *Instruções de Implementação*.
