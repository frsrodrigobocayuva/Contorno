"""Log em JSON por linha (plano, A9): uma linha por requisição da API, com o tempo total e o de
cada chamada ao motor (DAS 6.12). O texto buscado não vai para o log: pode ser o endereço de alguém.
"""

import json
import logging
import sys
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from fastapi import FastAPI, Request, Response

from app.infra import medicao

ROTAS_DA_API = ("/rotas", "/enderecos", "/health")

log = logging.getLogger("contorno.requisicoes")


class FormatoJSON(logging.Formatter):
    def format(self, registro: logging.LogRecord) -> str:
        dados = {
            "momento": datetime.fromtimestamp(registro.created, UTC).isoformat(
                timespec="milliseconds"
            ),
            "nivel": registro.levelname,
            "evento": registro.getMessage(),
            **getattr(registro, "dados", {}),
        }
        if registro.exc_info:
            dados["erro"] = self.formatException(registro.exc_info)
        return json.dumps(dados, ensure_ascii=False)


def configurar_log() -> None:
    contorno = logging.getLogger("contorno")
    if any(isinstance(h.formatter, FormatoJSON) for h in contorno.handlers):
        return
    saida = logging.StreamHandler(sys.stdout)
    saida.setFormatter(FormatoJSON())
    contorno.addHandler(saida)
    contorno.setLevel(logging.INFO)


def registrar_requisicoes(app: FastAPI) -> None:
    @app.middleware("http")
    async def _registrar(
        request: Request, seguinte: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if not request.url.path.startswith(ROTAS_DA_API):
            return await seguinte(request)
        chamadas = medicao.abrir()
        inicio = time.perf_counter()
        status = 500
        try:
            resposta = await seguinte(request)
            status = resposta.status_code
            return resposta
        finally:
            log.info(
                "requisicao",
                extra={
                    "dados": {
                        "metodo": request.method,
                        "caminho": request.url.path,
                        "status": status,
                        "ms_total": round((time.perf_counter() - inicio) * 1000, 1),
                        "ms_motor": [round(s * 1000, 1) for s in chamadas],
                    }
                },
            )
