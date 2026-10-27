"""POST /rotas/calculo (UC01): a rota irrestrita como linha de base."""

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
from app.dominio.modelo import ConsultaDeRota, Coordenada, Diagnostico, Rota

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
    """A rota irrestrita entre origem e destino; sem caminho, o diagnóstico (D6)."""
    fora = [
        {"campo": campo, "motivo": "FORA_DA_REGIAO"}
        for campo, (longitude, latitude) in (("origem", pedido.origem), ("destino", pedido.destino))
        if not dependencias.config.no_recorte(longitude, latitude)
    ]
    if fora:
        raise EntradaInvalida(fora)
    consulta = ConsultaDeRota(Coordenada(*pedido.origem), Coordenada(*pedido.destino))
    resultado = await dependencias.orquestrador.calcular(consulta)
    if isinstance(resultado, Diagnostico):
        return RespostaDiagnostico(
            causa=resultado.causa,
            candidatas=list(resultado.candidatas),
            mensagem=resultado.mensagem(),
        )
    return RespostaRotas(irrestrita=_rota(resultado.irrestrita))
