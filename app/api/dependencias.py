"""O que as rotas HTTP usam, montado uma vez na subida (main.py) e lido de cada requisição."""

from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, Request

from app.api.config import Configuracao
from app.aplicacao.enderecos import LocalizadorDeEndereco
from app.aplicacao.orquestrador import OrquestradorDeRota


@dataclass(frozen=True)
class Dependencias:
    config: Configuracao
    cliente: httpx.AsyncClient
    orquestrador: OrquestradorDeRota
    localizador: LocalizadorDeEndereco


def _dependencias(request: Request) -> Dependencias:
    dependencias: Dependencias = request.app.state.dependencias
    return dependencias


Deps = Annotated[Dependencias, Depends(_dependencias)]
