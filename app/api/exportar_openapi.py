"""Exporta o OpenAPI da API para o arquivo de onde o front gera os tipos do contrato (A7).

Uso: python -m app.api.exportar_openapi web/src/api/openapi.json
"""

import json
import sys
from pathlib import Path

from app.api.main import app


def main() -> None:
    destino = Path(sys.argv[1])
    texto = json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"
    destino.write_text(texto, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
