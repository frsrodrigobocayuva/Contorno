"""Peças comuns às medições do DAS 8 (S4-04): áreas montadas como a S5-01 vai montá-las,
chamadas ao GraphHopper e estatística.

Os scripts rodam no serviço dev do compose, que está na rede do GraphHopper:
    docker compose run --rm dev python motor/medicoes/<script>.py
"""

import math
import os
import time
from collections.abc import Iterable, Sequence
from typing import Any

import h3
import httpx
from pyproj import Geod, Transformer
from shapely import prepare
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union

GRAPHHOPPER_URL = os.environ["GRAPHHOPPER_URL"]

Ponto = tuple[float, float]  # (longitude, latitude)

# Os mesmos pontos dos testes de contrato: um trajeto intermunicipal, São Leopoldo -> Novo Hamburgo.
UNISINOS: Ponto = (-51.1549545, -29.7954567)
CENTRO_NOVO_HAMBURGO: Ponto = (-51.1429035, -29.6905705)

# Retângulo do recorte (AREA_BBOX): min_lon, min_lat, max_lon, max_lat.
RETANGULO = (-51.2100287, -29.8302389, -50.9341246, -29.6377057)

# O círculo é construído em metros na UTM 22S (SIRGAS 2000) e só depois vira células (DAS 6.3).
_PARA_UTM = Transformer.from_crs("EPSG:4326", "EPSG:31982", always_xy=True)
_PARA_GRAUS = Transformer.from_crs("EPSG:31982", "EPSG:4326", always_xy=True)
_GEOD = Geod(ellps="WGS84")


def para_utm(geometria: BaseGeometry) -> BaseGeometry:
    return transform(_PARA_UTM.transform, geometria)


def para_graus(geometria: BaseGeometry) -> BaseGeometry:
    return transform(_PARA_GRAUS.transform, geometria)


def ponto_utm(ponto: Ponto) -> Point:
    return Point(_PARA_UTM.transform(*ponto))


def circulo(centro_utm: Point, raio_m: float) -> Polygon:
    """Círculo em graus, construído em metros em volta de um centro em UTM."""
    return para_graus(centro_utm.buffer(raio_m, quad_segs=32))


def ao_lado_da_linha(linha_utm: LineString, fracao: float, deslocamento_m: float) -> Point:
    """Ponto a `fracao` do comprimento da linha, deslocado na perpendicular (+ = esquerda)."""
    aqui = linha_utm.interpolate(fracao, normalized=True)
    adiante = linha_utm.interpolate(min(fracao + 0.002, 1.0), normalized=True)
    dx, dy = adiante.x - aqui.x, adiante.y - aqui.y
    norma = math.hypot(dx, dy) or 1.0
    return Point(aqui.x - dy / norma * deslocamento_m, aqui.y + dx / norma * deslocamento_m)


def celulas(area: Polygon, resolucao: int) -> set[str]:
    """Cobertura por sobreposição (ADR-010): toda célula que toca a área entra."""
    forma = h3.geo_to_h3shape(area)
    return set(h3.h3shape_to_cells_experimental(forma, resolucao, contain="overlap"))


def contem(celulas_: set[str], ponto: Ponto, resolucao: int) -> bool:
    """Teste de pertencimento de um ponto pela célula que o contém (DAS 6.3)."""
    return h3.latlng_to_cell(ponto[1], ponto[0], resolucao) in celulas_


def contorno(celulas_: Iterable[str]) -> list[Polygon]:
    """Contorno da união das células (ADR-011), um polígono por parte."""
    geometria = shape(h3.h3shape_to_geo(h3.cells_to_h3shape(list(celulas_))))
    return list(getattr(geometria, "geoms", [geometria]))


def vertices(poligonos: Sequence[Polygon]) -> int:
    return sum(
        len(p.exterior.coords) + sum(len(anel.coords) for anel in p.interiors) for p in poligonos
    )


def contorno_preparado(poligonos: Sequence[Polygon]) -> BaseGeometry:
    """Contorno pronto para testes repetidos de interseção (ADR-012)."""
    geometria = unary_union(poligonos)
    prepare(geometria)
    return geometria


def viola(caminho: dict[str, Any], contorno_: BaseGeometry) -> bool:
    """Validação pós-cálculo: interseção exata da rota com o contorno (ADR-006, ADR-012)."""
    return bool(LineString(caminho["points"]["coordinates"]).intersects(contorno_))


def modelo_com_areas(
    poligonos: Sequence[Polygon], regras: Sequence[dict[str, str]] = ()
) -> dict[str, Any]:
    """custom_model da rota restrita (DAS 6.4): uma feature por polígono, prioridade 0 em cada."""
    features = [
        {"type": "Feature", "id": f"a{i}", "properties": {}, "geometry": mapping(p)}
        for i, p in enumerate(poligonos)
    ]
    prioridade = [{"if": f"in_a{i}", "multiply_by": "0"} for i in range(len(poligonos))]
    return {
        "areas": {"type": "FeatureCollection", "features": features},
        "priority": prioridade + list(regras),
    }


def corpo_irrestrita(origem: Ponto, destino: Ponto) -> dict[str, Any]:
    return {"profile": "car", "points": [origem, destino], "points_encoded": False}


def corpo_restrita(
    origem: Ponto, destino: Ponto, modelo: dict[str, Any], detalhes: Sequence[str] = ()
) -> dict[str, Any]:
    """Rota restrita: CH desligado, acelerada por LM (ADR-014)."""
    corpo = {**corpo_irrestrita(origem, destino), "ch.disable": True, "custom_model": modelo}
    if detalhes:
        corpo["details"] = list(detalhes)
    return corpo


def cliente() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=GRAPHHOPPER_URL, timeout=60)


async def rota(cliente_: httpx.AsyncClient, corpo: dict[str, Any]) -> dict[str, Any] | None:
    """O caminho da resposta, ou None quando o motor não encontra conexão (rota vazia, DAS 6.4)."""
    resposta = await cliente_.post("/route", json=corpo)
    if resposta.status_code == 400 and "ConnectionNotFound" in resposta.text:
        return None
    resposta.raise_for_status()
    caminho: dict[str, Any] = resposta.json()["paths"][0]
    return caminho


def metros(coordenadas: Sequence[Sequence[float]]) -> float:
    """Comprimento geodésico de uma sequência de [longitude, latitude]."""
    if len(coordenadas) < 2:
        return 0.0
    lons, lats = zip(*((c[0], c[1]) for c in coordenadas), strict=True)
    return float(_GEOD.line_length(lons, lats))


def p95(amostras: Sequence[float]) -> float:
    """Percentil 95 por posição (com 20 amostras, a 19ª menor)."""
    ordenadas = sorted(amostras)
    return ordenadas[math.ceil(0.95 * len(ordenadas)) - 1]


def p50(amostras: Sequence[float]) -> float:
    ordenadas = sorted(amostras)
    return ordenadas[math.ceil(0.5 * len(ordenadas)) - 1]


def agora() -> float:
    return time.perf_counter()


def ms(segundos: float) -> str:
    return f"{segundos * 1000:,.0f} ms".replace(",", ".")
