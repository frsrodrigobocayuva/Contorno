"""Validador de Rota: interseção exata com o contorno (ADR-012), nível 1 do conjunto D16.

Os casos de segmento são os da medição do ADR-012: um trecho que corta só a ponta de uma célula,
com as duas pontas fora da área, precisa ser pego; um trecho que passa rente, por fora, não.
"""

import math

import pytest
from pyproj import Transformer
from shapely import LineString, Point, Polygon
from shapely.ops import transform

from app.dominio.indexador import celulas_de, forma_de, poligonos_de
from app.dominio.modelo import Coordenada, Poligono, Rota
from app.dominio.validador import ContornoProibido, violacoes

PARA_UTM = Transformer.from_crs("EPSG:4326", "EPSG:31982", always_xy=True)
PARA_GRAUS = Transformer.from_crs("EPSG:31982", "EPSG:4326", always_xy=True)

DESENHO = Poligono(
    (
        Coordenada(-51.150, -29.765),
        Coordenada(-51.145, -29.765),
        Coordenada(-51.145, -29.760),
        Coordenada(-51.150, -29.760),
    )
)
CONTORNO = poligonos_de(celulas_de(DESENHO, 11))


def rota(*pontos: tuple[float, float]) -> Rota:
    return Rota(tuple(Coordenada(lon, lat) for lon, lat in pontos), 60, 500)


def corda_na_ponta(profundidade_m: float) -> tuple[tuple[float, float], tuple[float, float]]:
    """Trecho de 40 m perpendicular à bissetriz de um canto convexo do contorno.

    Profundidade positiva entra na ponta da célula, com as duas pontas do trecho fora da área;
    negativa passa rente, por fora, sem tocar em nada.
    """
    area: Polygon = transform(PARA_UTM.transform, forma_de(CONTORNO[0]))
    anel = list(area.exterior.coords)[:-1]
    for i, (vx, vy) in enumerate(anel):
        (ax, ay), (bx, by) = anel[i - 1], anel[(i + 1) % len(anel)]
        na, nb = math.hypot(ax - vx, ay - vy), math.hypot(bx - vx, by - vy)
        dx, dy = (ax - vx) / na + (bx - vx) / nb, (ay - vy) / na + (by - vy) / nb
        norma = math.hypot(dx, dy)
        if norma < 1e-9 or not area.contains(Point(vx + dx / norma, vy + dy / norma)):
            continue  # canto reto ou côncavo
        dx, dy = dx / norma, dy / norma
        cx, cy = vx + dx * profundidade_m, vy + dy * profundidade_m
        ponta1, ponta2 = (cx - dy * 20, cy + dx * 20), (cx + dy * 20, cy - dx * 20)
        trecho = LineString([ponta1, ponta2])
        fora = not area.intersects(Point(ponta1)) and not area.intersects(Point(ponta2))
        if profundidade_m > 0 and fora and area.intersection(trecho).length < 5:
            return PARA_GRAUS.transform(*ponta1), PARA_GRAUS.transform(*ponta2)
        if profundidade_m < 0 and not area.intersects(trecho):
            return PARA_GRAUS.transform(*ponta1), PARA_GRAUS.transform(*ponta2)
    raise AssertionError("nenhum canto convexo serve para o caso")


def test_rota_longe_da_area_nao_viola() -> None:
    assert violacoes(rota((-51.16, -29.77), (-51.16, -29.75)), ContornoProibido(CONTORNO)) == ()


def test_rota_que_atravessa_aponta_os_trechos() -> None:
    atravessa = rota((-51.16, -29.7625), (-51.147, -29.7625), (-51.140, -29.7625), (-51.14, -29.75))

    assert violacoes(atravessa, ContornoProibido(CONTORNO)) == (0, 1)


def test_trecho_que_corta_so_a_ponta_de_uma_celula_e_pego() -> None:
    ponta1, ponta2 = corda_na_ponta(profundidade_m=0.5)

    assert violacoes(rota(ponta1, ponta2), ContornoProibido(CONTORNO)) == (0,)


def test_trecho_que_passa_rente_por_fora_nao_viola() -> None:
    ponta1, ponta2 = corda_na_ponta(profundidade_m=-0.5)

    assert violacoes(rota(ponta1, ponta2), ContornoProibido(CONTORNO)) == ()


def test_contorno_vazio_e_erro() -> None:
    with pytest.raises(ValueError):
        ContornoProibido(())
