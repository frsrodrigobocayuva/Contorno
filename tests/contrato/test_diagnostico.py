"""Diagnóstico (UC05) contra o GraphHopper real do compose: o cenário da medição [5] da S4-04.

O centro de Novo Hamburgo fica isolado por 3 raios de 1.500 m, a 1.650 m dele, em anel (ao norte,
a sudoeste e a sudeste), sem ficar dentro de nenhum. Os dois do sul, juntos, cobrem as travessias
entre São Leopoldo e Novo Hamburgo dentro do recorte: tirar qualquer um deles abre caminho, tirar
o do norte não. Logo, só os dois do sul são candidatos.
"""

import math
import os

import httpx
import pytest
from pyproj import Transformer
from shapely import Point
from shapely.ops import transform

from app.aplicacao.diagnosticador import DiagnosticadorDeInviabilidade
from app.aplicacao.orquestrador import OrquestradorDeRota
from app.dominio import indexador
from app.dominio.modelo import (
    AreaExcluida,
    CausaDeInviabilidade,
    ConsultaDeRota,
    Coordenada,
    Diagnostico,
    Poligono,
)
from app.infra.graphhopper import AdaptadorGraphHopper

GRAPHHOPPER_URL = os.environ.get("GRAPHHOPPER_URL", "")

pytestmark = [
    pytest.mark.skipif(not GRAPHHOPPER_URL, reason="GraphHopper do compose não configurado"),
    pytest.mark.enable_socket,
    pytest.mark.anyio,
]

PARA_UTM = Transformer.from_crs("EPSG:4326", "EPSG:31982", always_xy=True)
PARA_GRAUS = Transformer.from_crs("EPSG:31982", "EPSG:4326", always_xy=True)
UNISINOS = Coordenada(-51.1549545, -29.7954567)
CENTRO_NH = Coordenada(-51.1429035, -29.6905705)
RAIO_M = 1500
DISTANCIA_M = 1650


def raio_em_volta_do_destino(angulo: float) -> Poligono:
    x, y = PARA_UTM.transform(CENTRO_NH.longitude, CENTRO_NH.latitude)
    centro = Point(
        x + DISTANCIA_M * math.cos(math.radians(angulo)),
        y + DISTANCIA_M * math.sin(math.radians(angulo)),
    )
    circulo = transform(PARA_GRAUS.transform, centro.buffer(RAIO_M, 16))
    return Poligono(tuple(Coordenada(lon, lat) for lon, lat in list(circulo.exterior.coords)[:-1]))


async def test_o_anel_em_volta_do_destino_aponta_os_dois_raios_do_sul() -> None:
    areas = tuple(
        AreaExcluida(id_, id_, indexador.celulas_de(raio_em_volta_do_destino(angulo), 11))
        for id_, angulo in (("norte", 90), ("sudoeste", 210), ("sudeste", 330))
    )
    regiao = indexador.consolidar([a.celulas for a in areas])
    assert not indexador.contem(regiao, CENTRO_NH)
    assert not indexador.contem(regiao, UNISINOS)

    async with httpx.AsyncClient() as cliente:
        motor = AdaptadorGraphHopper(cliente, GRAPHHOPPER_URL, 30)
        orquestrador = OrquestradorDeRota(motor, DiagnosticadorDeInviabilidade(motor, 4))
        resultado = await orquestrador.calcular(ConsultaDeRota(UNISINOS, CENTRO_NH, areas))

    assert resultado == Diagnostico(CausaDeInviabilidade.RESTRICAO_UNICA, ("sudoeste", "sudeste"))
