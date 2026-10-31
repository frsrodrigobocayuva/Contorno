"""Contrato com o GraphHopper real do compose (DAS 6.13).

Roda dentro da rede do compose: docker compose run --rm dev pytest tests/contrato
"""

import math
import os

import httpx
import pytest

from app.dominio.modelo import (
    ClasseDeVia,
    ConsultaDeRota,
    Coordenada,
    NivelDeEvitacao,
    OpcoesDeCusto,
    PreferenciaVia,
)
from app.dominio.tradutor import opcoes_de_custo
from app.infra.graphhopper import AdaptadorGraphHopper, corpo_da_rota

GRAPHHOPPER_URL = os.environ.get("GRAPHHOPPER_URL", "")

pytestmark = [
    pytest.mark.skipif(not GRAPHHOPPER_URL, reason="GraphHopper do compose não configurado"),
    pytest.mark.enable_socket,
]

# [longitude, latitude], consultados no Nominatim em 2026-10-26
UNISINOS = [-51.1549545, -29.7954567]
CENTRO_NOVO_HAMBURGO = [-51.1429035, -29.6905705]


def rota(corpo: dict[str, object]) -> httpx.Response:
    return httpx.post(f"{GRAPHHOPPER_URL}/route", json=corpo, timeout=30)


def test_rota_irrestrita_conhecida_no_recorte() -> None:
    resposta = rota(
        {"profile": "car", "points": [UNISINOS, CENTRO_NOVO_HAMBURGO], "points_encoded": False}
    )

    assert resposta.status_code == 200, resposta.text
    caminho = resposta.json()["paths"][0]
    assert 5_000 < caminho["distance"] < 30_000
    assert len(caminho["points"]["coordinates"]) > 2


def test_rota_restrita_com_custom_model_aceita_area_proibida() -> None:
    # Área pequena longe do trajeto: só prova que o motor aceita o custom_model com área.
    area = {
        "type": "Feature",
        "properties": {},
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [-51.20, -29.82],
                    [-51.19, -29.82],
                    [-51.19, -29.81],
                    [-51.20, -29.81],
                    [-51.20, -29.82],
                ]
            ],
        },
    }
    resposta = rota(
        {
            "profile": "car",
            "points": [UNISINOS, CENTRO_NOVO_HAMBURGO],
            "points_encoded": False,
            "ch.disable": True,
            "custom_model": {
                "areas": {"type": "FeatureCollection", "features": [{**area, "id": "area1"}]},
                "priority": [{"if": "in_area1", "multiply_by": "0"}],
            },
        }
    )

    assert resposta.status_code == 200, resposta.text


def test_rota_restrita_usa_lm() -> None:
    """ADR-014: a rota restrita usa LM e visita menos nós que o modo flexível puro."""
    corpo: dict[str, object] = {
        "profile": "car",
        "points": [UNISINOS, CENTRO_NOVO_HAMBURGO],
        "ch.disable": True,
        "custom_model": {"priority": [{"if": "road_class == RESIDENTIAL", "multiply_by": "0.5"}]},
    }

    com_lm = rota(corpo).json()
    sem_lm = rota({**corpo, "lm.disable": True}).json()

    assert com_lm["paths"][0]["distance"] == sem_lm["paths"][0]["distance"]
    assert com_lm["hints"]["visited_nodes.sum"] < sem_lm["hints"]["visited_nodes.sum"]


@pytest.mark.anyio
async def test_adaptador_calcula_a_rota_irrestrita_conhecida() -> None:
    consulta = ConsultaDeRota(Coordenada(*UNISINOS), Coordenada(*CENTRO_NOVO_HAMBURGO))

    async with httpx.AsyncClient() as cliente:
        rota = await AdaptadorGraphHopper(cliente, GRAPHHOPPER_URL, 10).calcular(
            consulta, (), OpcoesDeCusto()
        )

    assert rota is not None
    assert 5_000 < rota.distancia_metros < 30_000
    assert rota.duracao_segundos > 0
    assert rota.geometria[0] != rota.geometria[-1]


def metros_por_classe(opcoes: OpcoesDeCusto, classes: set[str]) -> float:
    """Metros da rota nas classes de via pedidas, pelo detalhe road_class do GraphHopper."""
    consulta = ConsultaDeRota(Coordenada(*UNISINOS), Coordenada(*CENTRO_NOVO_HAMBURGO))
    resposta = rota({**corpo_da_rota(consulta, (), opcoes), "details": ["road_class"]})
    assert resposta.status_code == 200, resposta.text
    caminho = resposta.json()["paths"][0]
    pontos = caminho["points"]["coordinates"]

    def metros(a: list[float], b: list[float]) -> float:
        lat = math.radians((a[1] + b[1]) / 2)
        dx = math.radians(b[0] - a[0]) * math.cos(lat)
        dy = math.radians(b[1] - a[1])
        return 6_371_000 * math.hypot(dx, dy)

    return sum(
        metros(pontos[i], pontos[i + 1])
        for inicio, fim, classe in caminho["details"]["road_class"]
        if classe in classes
        for i in range(inicio, fim)
    )


def test_rodovia_evitada_fortemente_tira_metros_de_rodovia() -> None:
    """Via penalizada (DAS 6.13): a preferência chega ao motor e muda a rota, sem proibir."""
    # Nos detalhes da resposta, o GraphHopper escreve a classe em minúsculas.
    rodovias = {"motorway", "trunk"}
    evitar = opcoes_de_custo(
        [PreferenciaVia(ClasseDeVia.RODOVIA, NivelDeEvitacao.EVITAR_FORTEMENTE)]
    )

    sem_preferencia = metros_por_classe(OpcoesDeCusto(), rodovias)
    com_preferencia = metros_por_classe(evitar, rodovias)

    assert sem_preferencia > 1_000
    assert com_preferencia < sem_preferencia * 0.5
