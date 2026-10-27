"""GET /enderecos (UC06): busca de endereço só ao acionar Buscar (ADR-013)."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.dependencias import Deps
from app.api.erros import EntradaInvalida
from app.api.esquemas import Erro, LugarDTO, RespostaEnderecos

router = APIRouter()


@router.get("/enderecos", response_model=RespostaEnderecos, responses={422: {"model": Erro}})
async def buscar(q: Annotated[str, Query(max_length=200)], dependencias: Deps) -> RespostaEnderecos:
    """Até 5 lugares no recorte; sem resultado ou com o serviço fora do ar, lista vazia e motivo."""
    texto = q.strip()
    if not texto:
        raise EntradaInvalida([{"campo": "q", "motivo": "VAZIO"}])
    resultado = await dependencias.localizador.localizar(texto)
    return RespostaEnderecos(
        lugares=[
            LugarDTO(
                nome=lugar.nome, coordenada=(lugar.coordenada.longitude, lugar.coordenada.latitude)
            )
            for lugar in resultado.lugares
        ],
        motivo=resultado.motivo,
    )
