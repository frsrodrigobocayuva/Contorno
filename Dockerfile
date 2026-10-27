# Imagem da API (DAS 7.4): o build do front e o servidor Python num contêiner só.

# 1. Build do front
FROM node:24.22.1-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2. Base Python com as dependências da aplicação
FROM python:3.13.18-slim-bookworm AS base
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ app/

# 3. Ferramentas: testes de contrato e medições, dentro da rede do compose
FROM base AS dev
COPY requirements-dev.txt pyproject.toml ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY tests/ tests/

# 4. Imagem final: só a porta 8000 é publicada (Diagrama de Implantação)
FROM base AS final
COPY --from=web /web/dist /srv/web/dist
ENV WEB_DIST=/srv/web/dist
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=4)"
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
