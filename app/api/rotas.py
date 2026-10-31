"""POST /rotas/calculo (UC01): a irrestrita como linha de base e, com áreas, a restrita validada."""

from fastapi import APIRouter

from app.api.dependencias import Deps
from app.api.erros import EntradaInvalida
from app.api.esquemas import (
    Erro,
    LinhaGeoJSON,
    PedidoDeRota,
    RespostaCalculo,
    RespostaDiagnostico,
    RespostaRotas,
    RotaDTO,
)
from app.dominio import indexador
from app.dominio.modelo import AreaExcluida, ConsultaDeRota, Coordenada, Diagnostico, Rota

# Teto de células de uma área descompactada: o recorte inteiro, na resolução 11, tem cerca de
# 265 mil. Protege a API de um conjunto compactado que explodiria na descompactação.
LIMITE_DE_CELULAS = 300_000

router = APIRouter()


def _rota(rota: Rota) -> RotaDTO:
    return RotaDTO(
        geometria=LinhaGeoJSON(coordinates=[(c.longitude, c.latitude) for c in rota.geometria]),
        duracao_segundos=rota.duracao_segundos,
        distancia_metros=rota.distancia_metros,
    )


@router.post(
    "/rotas/calculo",
    response_model=RespostaCalculo,
    responses={422: {"model": Erro}, 503: {"model": Erro}},
)
async def calcular(pedido: PedidoDeRota, dependencias: Deps) -> RespostaRotas | RespostaDiagnostico:
    """A irrestrita e, com áreas, a restrita validada; sem caminho, o diagnóstico (D6)."""
    fora = [
        {"campo": campo, "motivo": "FORA_DA_REGIAO"}
        for campo, (longitude, latitude) in (("origem", pedido.origem), ("destino", pedido.destino))
        if not dependencias.config.no_recorte(longitude, latitude)
    ]
    if fora:
        raise EntradaInvalida(fora)
    ids = [r.id for r in pedido.restricoes]
    if len(set(ids)) != len(ids):
        raise EntradaInvalida([{"campo": "restricoes", "motivo": "ID_REPETIDO"}])
    try:
        areas = tuple(
            AreaExcluida(
                r.id,
                r.rotulo,
                indexador.descompactar(
                    (int(c, 16) for c in r.celulas),
                    dependencias.config.resolucao_h3,
                    LIMITE_DE_CELULAS,
                ),
            )
            for r in pedido.restricoes
        )
    except ValueError as erro:
        raise EntradaInvalida([{"campo": "restricoes", "motivo": str(erro)}]) from erro
    consulta = ConsultaDeRota(Coordenada(*pedido.origem), Coordenada(*pedido.destino), areas)
    resultado = await dependencias.orquestrador.calcular(consulta)
    if isinstance(resultado, Diagnostico):
        return RespostaDiagnostico(
            causa=resultado.causa,
            candidatas=list(resultado.candidatas),
            mensagem=resultado.mensagem(),
        )
    return RespostaRotas(
        irrestrita=_rota(resultado.irrestrita),
        restrita=_rota(resultado.restrita) if resultado.restrita else None,
    )
