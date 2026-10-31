"""Indexador Espacial (DAS 6.3; ADR-010 e ADR-011): áreas em células H3 e o contorno das células.

Cálculo puro, sem rede: h3 para as células, shapely para a geometria e pyproj para medir em metros,
na projeção UTM 22S, a mesma do raio. O h3 não traz tipos; o que sai dele é tipado aqui.
"""

from collections.abc import Iterable, Sequence
from functools import reduce
from typing import cast

import h3
import h3.api.basic_int as h3int
from pyproj import Transformer
from shapely import Polygon
from shapely.ops import transform

from app.dominio.modelo import Anel, ConjuntoDeCelulas, Coordenada, Poligono

_PARA_UTM = Transformer.from_crs("EPSG:4326", "EPSG:31982", always_xy=True)


def forma_de(poligono: Poligono) -> Polygon:
    """O polígono do domínio na geometria do shapely, em graus (longitude, latitude)."""

    def pontos(anel: Anel) -> list[tuple[float, float]]:
        return [(c.longitude, c.latitude) for c in anel]

    return Polygon(pontos(poligono.exterior), [pontos(b) for b in poligono.buracos])


def desenho_valido(poligono: Poligono) -> bool:
    """Polígono sem autointerseção (DAS 6.10)."""
    return bool(forma_de(poligono).is_valid)


def celulas_de(poligono: Poligono, resolucao: int) -> ConjuntoDeCelulas:
    """Cobertura por sobreposição (ADR-010): toda célula que toca a área entra."""

    def anel(pontos: Anel) -> list[tuple[float, float]]:
        return [(c.latitude, c.longitude) for c in pontos]

    forma = h3.LatLngPoly(anel(poligono.exterior), *(anel(b) for b in poligono.buracos))
    indices = cast(
        list[int], h3int.h3shape_to_cells_experimental(forma, resolucao, contain="overlap")
    )
    return ConjuntoDeCelulas(resolucao, frozenset(indices))


def compactar(conjunto: ConjuntoDeCelulas) -> tuple[int, ...]:
    """Só para o transporte (ADR-011): o mapa e o motor usam as células descompactadas."""
    return tuple(sorted(cast(list[int], h3int.compact_cells(list(conjunto.indices)))))


def descompactar(indices: Iterable[int], resolucao: int, limite: int) -> ConjuntoDeCelulas:
    """O conjunto de volta na resolução configurada, conferindo cada índice antes (DAS 6.10).

    Levanta ValueError para índice que não é célula H3, célula mais fina que a resolução ou um
    conjunto que, descompactado, passaria do limite de células.
    """
    lista = list(dict.fromkeys(indices))
    if not lista:
        raise ValueError("área sem células")
    total = 0
    for indice in lista:
        if not h3int.is_valid_cell(indice):
            raise ValueError(f"índice {indice:x} não é uma célula H3")
        nivel = cast(int, h3int.get_resolution(indice))
        if nivel > resolucao:
            raise ValueError(f"célula {indice:x} na resolução {nivel}, acima de {resolucao}")
        total += 7 ** (resolucao - nivel)
        if total > limite:
            raise ValueError(f"a área passa de {limite} células")
    return ConjuntoDeCelulas(
        resolucao, frozenset(cast(list[int], h3int.uncompact_cells(lista, resolucao)))
    )


def poligonos_de(conjunto: ConjuntoDeCelulas) -> tuple[Poligono, ...]:
    """O contorno da união das células (ADR-011), um polígono por parte, com os buracos."""
    forma = h3int.cells_to_h3shape(list(conjunto.indices), tight=False)

    def anel(pontos: Sequence[tuple[float, float]]) -> Anel:
        return tuple(Coordenada(lng, lat) for lat, lng in pontos)

    return tuple(
        Poligono(anel(parte.outer), tuple(anel(b) for b in parte.holes)) for parte in forma
    )


def contem(conjunto: ConjuntoDeCelulas, ponto: Coordenada) -> bool:
    """O ponto pela célula que o contém, teste exato para pontos (DAS 6.3)."""
    celula = cast(int, h3int.latlng_to_cell(ponto.latitude, ponto.longitude, conjunto.resolucao))
    return conjunto.contem(celula)


def consolidar(conjuntos: Sequence[ConjuntoDeCelulas]) -> ConjuntoDeCelulas:
    """Áreas sobrepostas viram um conjunto só, sem duplicidade (RN05), no momento do cálculo."""
    if not conjuntos:
        raise ValueError("nada a consolidar")
    return reduce(ConjuntoDeCelulas.unir, conjuntos)


def area_m2(poligonos: Sequence[Poligono]) -> float:
    """Área em metros quadrados, medida em UTM 22S, descontando os buracos."""
    return sum(transform(_PARA_UTM.transform, forma_de(p)).area for p in poligonos)
