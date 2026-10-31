"""POST /restricoes/area (UC02): o desenho vira a área proibida que o usuário confere."""

from fastapi import APIRouter

from app.api.dependencias import Deps
from app.api.erros import EntradaInvalida
from app.api.esquemas import Erro, PedidoDeArea, RespostaArea
from app.api.geojson import multipoligono
from app.dominio import indexador
from app.dominio.modelo import Coordenada, Poligono

router = APIRouter()


@router.post("/restricoes/area", response_model=RespostaArea, responses={422: {"model": Erro}})
async def definir_area(pedido: PedidoDeArea, dependencias: Deps) -> RespostaArea:
    """As células da área, o contorno delas e os conflitos com a origem e o destino (UC02).

    Recusa, antes do domínio (DAS 6.10), desenho fora de São Leopoldo e Novo Hamburgo, com menos
    de três vértices distintos ou que se cruza.
    """
    config = dependencias.config
    detalhes: list[dict[str, str]] = []
    if not all(config.no_recorte(lon, lat) for lon, lat in pedido.poligono):
        detalhes.append({"campo": "poligono", "motivo": "FORA_DA_REGIAO"})
    try:
        desenho = Poligono(tuple(Coordenada(lon, lat) for lon, lat in pedido.poligono))
    except ValueError:
        desenho = None
    if desenho is None or not indexador.desenho_valido(desenho):
        detalhes.append({"campo": "poligono", "motivo": "POLIGONO_INVALIDO"})
    for campo, ponto in (("origem", pedido.origem), ("destino", pedido.destino)):
        if ponto is not None and not config.no_recorte(*ponto):
            detalhes.append({"campo": campo, "motivo": "FORA_DA_REGIAO"})
    if detalhes or desenho is None:
        raise EntradaInvalida(detalhes)

    area = dependencias.gestor.definir_area(
        desenho,
        Coordenada(*pedido.origem) if pedido.origem else None,
        Coordenada(*pedido.destino) if pedido.destino else None,
    )
    return RespostaArea(
        celulas=[f"{indice:x}" for indice in area.compactadas],
        contorno=multipoligono(area.contorno),
        area_desenhada_m2=round(area.area_desenhada_m2, 1),
        area_proibida_m2=round(area.area_proibida_m2, 1),
        conflitos=list(area.conflitos),
    )
