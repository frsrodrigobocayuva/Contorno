"""Tratamento de erros (DAS 6.9): só a apresentação conhece código HTTP; um formato só."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.esquemas import Erro
from app.dominio.excecoes import MotorIndisponivel

log = logging.getLogger("contorno.erros")


class EntradaInvalida(Exception):
    """Entrada que passou no esquema, mas não nas regras da apresentação (DAS 6.10)."""

    def __init__(self, detalhes: list[dict[str, str]]) -> None:
        super().__init__(detalhes)
        self.detalhes = detalhes


def _resposta(
    status: int, codigo: str, mensagem: str, detalhes: list[dict[str, str]] | None = None
) -> JSONResponse:
    erro = Erro(codigo=codigo, mensagem=mensagem, detalhes=detalhes)
    return JSONResponse(erro.model_dump(by_alias=True), status_code=status)


async def _validacao(_: Request, erro: Exception) -> JSONResponse:
    assert isinstance(erro, RequestValidationError)
    detalhes = [
        {"campo": ".".join(str(p) for p in e["loc"][1:]) or str(e["loc"][0]), "motivo": e["msg"]}
        for e in erro.errors()
    ]
    return _resposta(422, "VALIDACAO", "Entrada inválida.", detalhes)


async def _entrada_invalida(_: Request, erro: Exception) -> JSONResponse:
    assert isinstance(erro, EntradaInvalida)
    return _resposta(422, "VALIDACAO", "Entrada inválida.", erro.detalhes)


async def _motor_indisponivel(_: Request, erro: Exception) -> JSONResponse:
    log.warning("motor indisponível: %s", erro)
    return _resposta(503, "MOTOR_INDISPONIVEL", "Não foi possível calcular a rota agora.")


async def _interno(_: Request, erro: Exception) -> JSONResponse:
    log.exception("erro interno", exc_info=erro)
    return _resposta(500, "ERRO_INTERNO", "Erro interno.")


def registrar_tratadores(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validacao)
    app.add_exception_handler(EntradaInvalida, _entrada_invalida)
    app.add_exception_handler(MotorIndisponivel, _motor_indisponivel)
    app.add_exception_handler(Exception, _interno)
