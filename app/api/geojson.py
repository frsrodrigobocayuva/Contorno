"""Polígonos do domínio em GeoJSON (DAS 6.1): [longitude, latitude], anéis fechados."""

from collections.abc import Sequence

from app.api.esquemas import MultiPoligonoGeoJSON, Ponto
from app.dominio.modelo import Anel, Poligono


def _anel(pontos: Anel) -> list[Ponto]:
    coordenadas = [(c.longitude, c.latitude) for c in pontos]
    return coordenadas if coordenadas[0] == coordenadas[-1] else [*coordenadas, coordenadas[0]]


def multipoligono(poligonos: Sequence[Poligono]) -> MultiPoligonoGeoJSON:
    return MultiPoligonoGeoJSON(
        coordinates=[[_anel(p.exterior), *(_anel(b) for b in p.buracos)] for p in poligonos]
    )
