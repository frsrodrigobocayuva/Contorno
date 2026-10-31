"""Conjunto de validação D16, níveis 2 e 3, contra o GraphHopper real do compose (plano, D16).

Critério: nenhuma rota restrita devolvida pelo motor cruza o contorno das áreas. Confere a saída
do adaptador, antes do Orquestrador, que descartaria a rota (RN01): uma violação aqui quer dizer
que o usuário receberia "as áreas bloqueiam" sem motivo.

Áreas: círculos de 300 m ao longo da rota irrestrita, deslocados 150 m para os lados, para cortar a
rota sem fechar o caminho (como nas medições da S4-04).
"""

import asyncio
import os
import random

import httpx
import pytest
from pyproj import Transformer
from shapely import LineString, Point
from shapely.ops import transform

from app.dominio import indexador
from app.dominio.modelo import (
    ConjuntoDeCelulas,
    ConsultaDeRota,
    Coordenada,
    OpcoesDeCusto,
    Poligono,
    Rota,
)
from app.dominio.validador import ContornoProibido, violacoes
from app.infra.graphhopper import AdaptadorGraphHopper

GRAPHHOPPER_URL = os.environ.get("GRAPHHOPPER_URL", "")

pytestmark = [
    pytest.mark.skipif(not GRAPHHOPPER_URL, reason="GraphHopper do compose não configurado"),
    pytest.mark.enable_socket,
    pytest.mark.anyio,
]

PARA_UTM = Transformer.from_crs("EPSG:4326", "EPSG:31982", always_xy=True)
PARA_GRAUS = Transformer.from_crs("EPSG:31982", "EPSG:4326", always_xy=True)
RESOLUCAO = 11
RETANGULO = (-51.2100287, -29.8302389, -50.9341246, -29.6377057)

# Lugares conhecidos de São Leopoldo e Novo Hamburgo, [longitude, latitude].
UNISINOS = (-51.1549545, -29.7954567)
CENTRO_NH = (-51.1429035, -29.6905705)
CENTRO_SL = (-51.1478, -29.7602)
RODOVIARIA_SL = (-51.1500, -29.7680)
HOSPITAL_CENTENARIO = (-51.1408, -29.7577)
FENAC = (-51.1176, -29.6928)
PARCAO_NH = (-51.1253, -29.6795)
CANUDOS_NH = (-51.1030, -29.7010)
SCHARLAU = (-51.1540, -29.7280)
FEITORIA = (-51.1780, -29.7840)

PARES_FIXOS = [
    (UNISINOS, CENTRO_NH),
    (CENTRO_SL, FENAC),
    (RODOVIARIA_SL, PARCAO_NH),
    (HOSPITAL_CENTENARIO, CANUDOS_NH),
    (SCHARLAU, CENTRO_NH),
    (FEITORIA, CENTRO_SL),
    (UNISINOS, CANUDOS_NH),
    (FENAC, FEITORIA),
    (PARCAO_NH, RODOVIARIA_SL),
    (CANUDOS_NH, SCHARLAU),
]


def motor(cliente: httpx.AsyncClient) -> AdaptadorGraphHopper:
    return AdaptadorGraphHopper(cliente, GRAPHHOPPER_URL, 30)


def circulos_ao_longo(rota: Rota, quantas: int) -> list[Poligono]:
    """`quantas` círculos de 300 m sobre a rota, alternando os lados (150 m de deslocamento)."""
    linha = transform(
        PARA_UTM.transform, LineString([(c.longitude, c.latitude) for c in rota.geometria])
    )
    circulos = []
    for i in range(quantas):
        fracao = (i + 1) / (quantas + 1)
        aqui = linha.interpolate(fracao, normalized=True)
        adiante = linha.interpolate(min(fracao + 0.01, 1), normalized=True)
        dx, dy = adiante.x - aqui.x, adiante.y - aqui.y
        norma = (dx * dx + dy * dy) ** 0.5 or 1.0
        lado = 150 if i % 2 == 0 else -150
        centro = Point(aqui.x - dy / norma * lado, aqui.y + dx / norma * lado)
        circulo = transform(PARA_GRAUS.transform, centro.buffer(300, 8))
        circulos.append(
            Poligono(tuple(Coordenada(lon, lat) for lon, lat in list(circulo.exterior.coords)[:-1]))
        )
    return circulos


async def conferir(
    cliente: httpx.AsyncClient,
    origem: tuple[float, float],
    destino: tuple[float, float],
    quantas: int,
) -> str:
    """Uma consulta do conjunto: 'restrita', 'sem rota', 'pulada' ou 'violou'."""
    consulta = ConsultaDeRota(Coordenada(*origem), Coordenada(*destino))
    irrestrita = await motor(cliente).calcular(consulta, (), OpcoesDeCusto())
    if irrestrita is None or irrestrita.distancia_metros < 2_000:
        return "pulada"
    conjuntos: list[ConjuntoDeCelulas] = [
        indexador.celulas_de(c, RESOLUCAO) for c in circulos_ao_longo(irrestrita, quantas)
    ]
    regiao = indexador.consolidar(conjuntos)
    if indexador.contem(regiao, consulta.origem) or indexador.contem(regiao, consulta.destino):
        return "pulada"
    contorno = indexador.poligonos_de(regiao)
    restrita = await motor(cliente).calcular(consulta, contorno, OpcoesDeCusto())
    if restrita is None:
        return "sem rota"
    return "violou" if violacoes(restrita, ContornoProibido(contorno)) else "restrita"


async def rodar(
    casos: list[tuple[tuple[float, float], tuple[float, float], int]],
) -> dict[str, int]:
    limite = asyncio.Semaphore(4)
    async with httpx.AsyncClient() as cliente:

        async def um(caso: tuple[tuple[float, float], tuple[float, float], int]) -> str:
            async with limite:
                return await conferir(cliente, *caso)

        resultados = await asyncio.gather(*(um(c) for c in casos))
    return {r: resultados.count(r) for r in ("restrita", "sem rota", "pulada", "violou")}


async def test_nivel_2_pares_fixos_com_uma_a_tres_areas() -> None:
    contagem = await rodar([(o, d, k) for o, d in PARES_FIXOS for k in (1, 2, 3)])

    assert contagem["violou"] == 0, contagem
    assert contagem["restrita"] >= 20, contagem


async def test_nivel_3_duzentos_pares_sorteados() -> None:
    sorteio = random.Random(2026)
    min_lon, min_lat, max_lon, max_lat = RETANGULO

    def ponto() -> tuple[float, float]:
        return (sorteio.uniform(min_lon, max_lon), sorteio.uniform(min_lat, max_lat))

    casos = [(ponto(), ponto(), sorteio.randint(1, 3)) for _ in range(200)]

    contagem = await rodar(casos)

    assert contagem["violou"] == 0, contagem
    assert contagem["restrita"] >= 100, contagem
