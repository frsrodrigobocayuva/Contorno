# Imagem mínima com o osmium-tool, usada só para recortar o extrato (plano, D15).
FROM debian:bookworm-20261020-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends osmium-tool \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /dados
ENTRYPOINT ["osmium"]
