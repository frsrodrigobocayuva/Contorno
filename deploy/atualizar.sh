#!/usr/bin/env bash
# Põe o Contorno da VM numa versão (ADR-015). Instalado como /usr/local/bin/contorno-atualizar.
# - pelo workflow de deploy: a chave do GitHub só roda este script (forced command no
#   authorized_keys do usuário deploy), e a versão chega em SSH_ORIGINAL_COMMAND;
# - à mão, na VM: sudo -u deploy contorno-atualizar v0.1.1
set -euo pipefail

REF="${1:-${SSH_ORIGINAL_COMMAND:-}}"
# Uma tag vX.Y.Z; main e branches de item só à mão, para testar antes do merge.
if [[ ! "$REF" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+|main|[a-z]+/AB[0-9]+-[a-z0-9-]+)$ ]]; then
	echo "versão inválida: '$REF' (use uma tag vX.Y.Z)" >&2
	exit 2
fi

# Um deploy por vez.
exec 9>/tmp/contorno-atualizar.lock
if ! flock -n 9; then
	echo "outro deploy está em andamento" >&2
	exit 3
fi

cd /opt/contorno
git fetch --quiet --prune --tags origin
if [[ "$REF" == v* ]]; then
	alvo="refs/tags/$REF"
else
	alvo="origin/$REF"
fi
git -c advice.detachedHead=false checkout --quiet --detach "$alvo"
echo "== Contorno em $REF ($(git rev-parse --short HEAD))"

# --wait: só termina com a API e o motor saudáveis; falha se algum não ficar.
docker compose -f compose.yaml -f compose.prod.yaml up -d --build --remove-orphans --wait
docker image prune -f >/dev/null
echo "== no ar: $REF"
