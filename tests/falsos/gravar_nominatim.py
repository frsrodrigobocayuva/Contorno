"""Grava as respostas do Nominatim que o falso do CI devolve (plano, A5; ADR-013).

Faz uma requisição por consulta, no máximo uma por segundo, com os parâmetros do ADR-013 e o
User-Agent com contato (NOMINATIM_USER_AGENT, do ambiente ou do .env). Grava cada resposta em
tests/falsos/nominatim/ e o índice consultas.json, com fonte, data e parâmetros.

Uso, a partir da raiz do repositório:
    python tests/falsos/gravar_nominatim.py

Regravar é decisão explícita: as respostas mudam quando o mapa muda, e os testes que dependem
delas podem precisar de ajuste.
"""

import datetime
import json
import os
import re
import time
import unicodedata
from pathlib import Path

import httpx

URL = "https://nominatim.openstreetmap.org/search"

# Retângulo do recorte (AREA_BBOX): min_lon, min_lat, max_lon, max_lat.
RETANGULO = "-51.2100287,-29.8302389,-50.9341246,-29.6377057"
PARAMETROS = {
    "format": "jsonv2",
    "viewbox": RETANGULO,
    "bounded": "1",
    "countrycodes": "br",
    "limit": "5",
}

# Um ponto de interesse, um endereço em cada município e uma busca fora do recorte (lista vazia).
CONSULTAS = [
    "UNISINOS",
    "Rua Independência, São Leopoldo",
    "Avenida Pedro Adams Filho, Novo Hamburgo",
    "Aeroporto Internacional Salgado Filho",
]

RAIZ = Path(__file__).resolve().parents[2]
DESTINO = Path(__file__).resolve().parent / "nominatim"


def user_agent() -> str:
    valor = os.environ.get("NOMINATIM_USER_AGENT")
    env = RAIZ / ".env"
    if valor is None and env.exists():
        for linha in env.read_text(encoding="utf-8").splitlines():
            chave, _, resto = linha.partition("=")
            if chave.strip() == "NOMINATIM_USER_AGENT":
                valor = resto.strip()
    if not valor or "preencher" in valor:
        raise SystemExit("defina NOMINATIM_USER_AGENT com um contato (política do Nominatim)")
    return valor


def arquivo_de(consulta: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", consulta).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", sem_acento.lower()).strip("-") + ".json"


def main() -> None:
    DESTINO.mkdir(exist_ok=True)
    indice: dict[str, str] = {}
    with httpx.Client(headers={"User-Agent": user_agent()}, timeout=20) as cliente:
        for i, consulta in enumerate(CONSULTAS):
            if i:
                time.sleep(1.1)  # no máximo uma requisição por segundo
            resposta = cliente.get(URL, params={"q": consulta, **PARAMETROS})
            resposta.raise_for_status()
            lugares = resposta.json()
            arquivo = arquivo_de(consulta)
            (DESTINO / arquivo).write_text(
                json.dumps(lugares, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            indice[consulta] = arquivo
            print(f"{consulta!r}: {len(lugares)} resultado(s) -> {arquivo}")

    metadados = {
        "fonte": URL,
        "gravado_em": datetime.date.today().isoformat(),
        "parametros": PARAMETROS,
        "consultas": indice,
    }
    (DESTINO / "consultas.json").write_text(
        json.dumps(metadados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


if __name__ == "__main__":
    main()
