# Contorno

Planejador de rotas web em que o usuário declara por onde **não** quer passar, e a rota obedece. O usuário desenha no mapa a área que quer evitar (ou define um raio a partir de um endereço) e escolhe quais classes de via prefere evitar; o sistema calcula a melhor rota dentro do espaço permitido, mostra quanto a escolha custou em tempo e distância e, quando não há rota possível, aponta qual restrição bloqueou o trajeto.

Recorte do MVP: São Leopoldo e Novo Hamburgo (RS), sobre dados abertos do OpenStreetMap.

> **Estado:** em implementação (Sprint 4). O ambiente sobe, mas as funcionalidades ainda não existem.

## Pilha

| Parte | Tecnologia |
|---|---|
| Cliente | React + TypeScript, Vite |
| Servidor | Python 3.13, FastAPI |
| Motor de rotas | GraphHopper 11.1 (CH para a rota irrestrita; LM para a restrita) |
| Dados | Extrato OpenStreetMap da Geofabrik, recortado com osmium |
| Ambiente | Docker Compose |

## Pré-requisitos

- Docker Desktop (com WSL2, no Windows)
- Para desenvolver: Python 3.13 e Node 24 LTS

## Subir a aplicação

```bash
cp .env.example .env    # preencha o contato em NOMINATIM_USER_AGENT
docker compose up --build
```

Abra http://localhost:8000. A primeira subida importa o grafo do GraphHopper e prepara as acelerações CH e LM, o que leva alguns minutos; as seguintes reaproveitam o volume `graph-cache`. `http://localhost:8000/health` responde `200` quando a API e o motor estão no ar.

Só a porta 8000 é publicada. O GraphHopper fica na rede interna do compose.

## Desenvolver

```bash
# Python
py -3.13 -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # Linux/macOS: .venv/bin/pip
.venv/Scripts/pre-commit install

# Front
cd web && npm ci && npm run dev    # chamadas à API vão para localhost:8000
```

Verificações:

```bash
ruff check . && ruff format --check . && mypy && pytest
cd web && npm run lint && npm run typecheck && npm test && npm run build
```

Testes de contrato contra o GraphHopper real, dentro da rede do compose:

```bash
docker compose run --rm dev pytest tests/contrato
```

## Dados do mapa

O recorte versionado fica em `motor/dados/recorte-sl-nh.osm.pbf`, e a fonte, a data e os hashes em `motor/dados/recorte-sl-nh.json`. Para regenerá-lo (decisão explícita):

```bash
python motor/recortar_extrato.py --data AAMMDD
docker compose down && docker volume rm contorno_graph-cache
```

Os dados são © OpenStreetMap contributors, sob a licença ODbL.

## Estrutura

```
app/        servidor, uma pasta por camada (api, aplicacao, dominio, infra)
web/        cliente React
motor/      GraphHopper: Dockerfile, config.yml e recorte do extrato
tests/      dominio, aplicacao, contrato, arquitetura
```

## Contribuição

O fluxo de trabalho (branches, commits, Definição de Pronto, padrões de código) está na wiki do projeto, em *Instruções de Implementação*.
