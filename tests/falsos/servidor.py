"""Falsos dos serviços públicos da OSM para o CI (plano, A5).

O CI nunca chama o Nominatim nem os tiles públicos; este servidor responde no lugar deles:
- GET /search?q=...     resposta gravada do Nominatim para a consulta (nominatim/consultas.json);
                        consulta não gravada responde 501, para o teste falhar com o motivo claro;
- GET /{z}/{x}/{y}.png  tile em branco de 256x256.

Uso: python tests/falsos/servidor.py [porta]   (no compose do CI: serviço falsos, porta 8080)
"""

import json
import re
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

FALSOS = Path(__file__).resolve().parent
NOMINATIM = FALSOS / "nominatim"
TILE = (FALSOS / "tile-em-branco.png").read_bytes()
CAMINHO_DE_TILE = re.compile(r"/\d+/\d+/\d+\.png")


def normalizar(consulta: str) -> str:
    return " ".join(consulta.split()).casefold()


def carregar_respostas() -> dict[str, bytes]:
    indice = json.loads((NOMINATIM / "consultas.json").read_text(encoding="utf-8"))
    return {
        normalizar(consulta): (NOMINATIM / arquivo).read_bytes()
        for consulta, arquivo in indice["consultas"].items()
    }


RESPOSTAS = carregar_respostas()


class Falsos(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        url = urlsplit(self.path)
        if url.path == "/search":
            consulta = normalizar(parse_qs(url.query).get("q", [""])[0])
            resposta = RESPOSTAS.get(consulta)
            if resposta is None:
                motivo = f"consulta não gravada: {consulta!r}".encode()
                self.responder(HTTPStatus.NOT_IMPLEMENTED, "text/plain; charset=utf-8", motivo)
            else:
                self.responder(HTTPStatus.OK, "application/json; charset=utf-8", resposta)
        elif CAMINHO_DE_TILE.fullmatch(url.path):
            self.responder(HTTPStatus.OK, "image/png", TILE)
        else:
            self.responder(HTTPStatus.NOT_FOUND, "text/plain; charset=utf-8", b"nao encontrado")

    def responder(self, status: HTTPStatus, tipo: str, corpo: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    ThreadingHTTPServer(("0.0.0.0", porta), Falsos).serve_forever()
