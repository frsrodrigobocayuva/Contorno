"""POST /restricoes/area (UC02): o desenho, ou o raio sobre um ponto (alternativo A), vira a área
proibida que o usuário confere."""

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

    Recusa, antes do domínio (DAS 6.10): pedido sem o desenho e sem o raio, ou com os dois;
    desenho fora de São Leopoldo e Novo Hamburgo, com menos de três vértices distintos ou que se
    cruza; raio fora dos limites, com o centro fora da região ou com o círculo passando dela.
    """
    config = dependencias.config
    if (pedido.poligono is None) == (pedido.raio is None):
        raise EntradaInvalida([{"campo": "poligono", "motivo": "POLIGONO_OU_RAIO"}])
    detalhes: list[dict[str, str]] = []
    desenho: Poligono | None = None
    if pedido.raio is not None:
        centro, metros = pedido.raio.centro, pedido.raio.metros
        if not config.no_recorte(*centro):
            detalhes.append({"campo": "raio.centro", "motivo": "FORA_DA_REGIAO"})
        if not config.raio_minimo_m <= metros <= config.raio_maximo_m:
            detalhes.append({"campo": "raio.metros", "motivo": "RAIO_FORA_DO_LIMITE"})
        if not detalhes:
            desenho = indexador.circulo(Coordenada(*centro), metros)
            if not all(config.no_recorte(c.longitude, c.latitude) for c in desenho.exterior):
                detalhes.append({"campo": "raio", "motivo": "FORA_DA_REGIAO"})
    elif pedido.poligono is not None:
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
        desenho=[(c.longitude, c.latitude) for c in desenho.exterior],
        area_desenhada_m2=round(area.area_desenhada_m2, 1),
        area_proibida_m2=round(area.area_proibida_m2, 1),
        conflitos=list(area.conflitos),
    )
