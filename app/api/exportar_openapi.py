"""Exporta o OpenAPI da API para o arquivo de onde o front gera os tipos do contrato (A7).

Uso: python -m app.api.exportar_openapi web/src/api/openapi.json
"""

import json
import os
import sys
from pathlib import Path

# O esquema não depende da configuração; o valor só satisfaz a leitura feita na subida.
os.environ.setdefault("GRAPHHOPPER_URL", "http://graphhopper:8989")

from app.api.main import app  # noqa: E402


def main() -> None:
    destino = Path(sys.argv[1])
    texto = json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"
    destino.write_text(texto, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
