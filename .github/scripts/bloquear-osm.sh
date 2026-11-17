#!/usr/bin/env bash
# O CI nunca chama os serviços públicos da OSM (plano, A5) nem o OpenFreeMap, de onde vêm os
# tiles do mapa base vetorial (#107, ADR-016). No runner, esses hosts passam a apontar para lugar
# nenhum: qualquer chamada falha na hora. No mapa, sem os tiles, fica só o fundo areia do estilo.
# Nos contêineres, o mesmo bloqueio está no compose.ci.yaml (extra_hosts).
set -euo pipefail

hosts=(
  nominatim.openstreetmap.org
  tile.openstreetmap.org
  a.tile.openstreetmap.org
  b.tile.openstreetmap.org
  c.tile.openstreetmap.org
  tiles.openfreemap.org
)

for host in "${hosts[@]}"; do
  printf '0.0.0.0 %s\n:: %s\n' "$host" "$host" | sudo tee -a /etc/hosts > /dev/null
done

for host in "${hosts[@]}"; do
  for endereco in $(getent ahosts "$host" | awk '{print $1}' | sort -u); do
    if [ "$endereco" != "0.0.0.0" ] && [ "$endereco" != "::" ]; then
      echo "::error::bloqueio de $host falhou: resolve para $endereco"
      exit 1
    fi
  done
done

echo "Serviços públicos bloqueados: ${hosts[*]}"
