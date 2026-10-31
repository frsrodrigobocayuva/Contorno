"""Adaptador GraphHopper: tradução da resposta e dos erros (DAS 6.4), sem o motor real."""

import json
from collections.abc import Callable

import httpx
import pytest

from app.dominio.excecoes import MotorIndisponivel
from app.dominio.modelo import (
    ConsultaDeRota,
    Coordenada,
    OpcoesDeCusto,
    Poligono,
    RegraDeCusto,
    Rota,
)
from app.infra import medicao
from app.infra.graphhopper import AdaptadorGraphHopper

pytestmark = pytest.mark.anyio

UNISINOS = Coordenada(-51.1549545, -29.7954567)
CENTRO_NH = Coordenada(-51.1429035, -29.6905705)
CONSULTA = ConsultaDeRota(UNISINOS, CENTRO_NH)
RESPOSTA = {
    "paths": [
        {
            "distance": 12799.2,
            "time": 1_260_000,
            "points": {"type": "LineString", "coordinates": [[-51.15, -29.79], [-51.14, -29.69]]},
        }
    ]
}


def sem_rota(excecao: str) -> httpx.Response:
    return httpx.Response(
        400, json={"message": "não encontrado", "hints": [{"message": "x", "details": excecao}]}
    )


def adaptador(tratar: Callable[[httpx.Request], httpx.Response]) -> AdaptadorGraphHopper:
    cliente = httpx.AsyncClient(transport=httpx.MockTransport(tratar))
    return AdaptadorGraphHopper(cliente, "http://graphhopper:8989/", 2)


async def test_traduz_a_resposta_em_rota() -> None:
    pedidos: list[httpx.Request] = []

    def tratar(pedido: httpx.Request) -> httpx.Response:
        pedidos.append(pedido)
        return httpx.Response(200, json=RESPOSTA)

    rota = await adaptador(tratar).calcular(CONSULTA, (), OpcoesDeCusto())

    assert rota == Rota((Coordenada(-51.15, -29.79), Coordenada(-51.14, -29.69)), 1260, 12799.2)
    assert str(pedidos[0].url) == "http://graphhopper:8989/route"
    assert json.loads(pedidos[0].content) == {
        "profile": "car",
        "points": [[-51.1549545, -29.7954567], [-51.1429035, -29.6905705]],
        "points_encoded": False,
    }


@pytest.mark.parametrize("excecao", ["ConnectionNotFoundException", "PointNotFoundException"])
async def test_sem_caminho_e_rota_vazia(excecao: str) -> None:
    assert (
        await adaptador(lambda _: sem_rota(excecao)).calcular(CONSULTA, (), OpcoesDeCusto()) is None
    )


@pytest.mark.parametrize("status", [500, 502, 503])
async def test_5xx_e_motor_indisponivel(status: int) -> None:
    with pytest.raises(MotorIndisponivel):
        await adaptador(lambda _: httpx.Response(status)).calcular(CONSULTA, (), OpcoesDeCusto())


@pytest.mark.parametrize("erro", [httpx.ReadTimeout("tempo"), httpx.ConnectError("recusada")])
async def test_tempo_esgotado_ou_rede_e_motor_indisponivel(erro: httpx.HTTPError) -> None:
    def tratar(_: httpx.Request) -> httpx.Response:
        raise erro

    with pytest.raises(MotorIndisponivel):
        await adaptador(tratar).calcular(CONSULTA, (), OpcoesDeCusto())


async def test_400_inesperado_e_erro_de_programacao() -> None:
    with pytest.raises(httpx.HTTPStatusError):
        await adaptador(
            lambda _: httpx.Response(400, json={"message": "perfil desconhecido"})
        ).calcular(CONSULTA, (), OpcoesDeCusto())


async def test_restrita_vai_com_as_areas_no_custom_model_e_sem_ch() -> None:
    pedidos: list[httpx.Request] = []

    def tratar(pedido: httpx.Request) -> httpx.Response:
        pedidos.append(pedido)
        return httpx.Response(200, json=RESPOSTA)

    quadrado = (Coordenada(0, 0), Coordenada(1, 0), Coordenada(1, 1), Coordenada(0, 1))
    buraco = (Coordenada(0.4, 0.4), Coordenada(0.6, 0.4), Coordenada(0.6, 0.6))
    triangulo = (Coordenada(2, 2), Coordenada(3, 2), Coordenada(3, 3), Coordenada(2, 2))

    await adaptador(tratar).calcular(
        CONSULTA, (Poligono(quadrado, (buraco,)), Poligono(triangulo)), OpcoesDeCusto()
    )

    corpo = json.loads(pedidos[0].content)
    assert corpo["ch.disable"] is True
    assert corpo["points_encoded"] is False
    features = corpo["custom_model"]["areas"]["features"]
    assert [f["id"] for f in features] == ["area0", "area1"]
    # Cada área vai com os dois triângulos fora do recorte, que alargam o retângulo dela.
    assert features[0]["geometry"]["type"] == "MultiPolygon"
    area, *fora = features[0]["geometry"]["coordinates"]
    assert area == [
        [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
        [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.4]],
    ]
    assert len(fora) == 2
    assert all(abs(lon + 51) > 1.4 or abs(lat + 29.7) > 1 for lon, lat in fora[0][0] + fora[1][0])
    assert features[1]["geometry"]["coordinates"][0] == [[[2, 2], [3, 2], [3, 3], [2, 2]]]
    assert corpo["custom_model"]["priority"] == [
        {"if": "in_area0", "multiply_by": "0"},
        {"if": "in_area1", "multiply_by": "0"},
    ]


async def test_regras_de_via_viram_condicoes_do_custom_model() -> None:
    pedidos: list[httpx.Request] = []

    def tratar(pedido: httpx.Request) -> httpx.Response:
        pedidos.append(pedido)
        return httpx.Response(200, json=RESPOSTA)

    regras = (
        RegraDeCusto("surface", frozenset({"unpaved", "dirt"}), 0.05),
        RegraDeCusto("highway", frozenset({"residential", "living_street"}), 0.5),
    )

    await adaptador(tratar).calcular(CONSULTA, (), OpcoesDeCusto(regras))

    corpo = json.loads(pedidos[0].content)
    assert corpo["ch.disable"] is True
    assert corpo["custom_model"] == {
        "priority": [
            {"if": "surface == DIRT || surface == UNPAVED", "multiply_by": "0.05"},
            {
                "if": "road_class == LIVING_STREET || road_class == RESIDENTIAL",
                "multiply_by": "0.5",
            },
        ]
    }


async def test_area_e_regra_vao_no_mesmo_custom_model() -> None:
    pedidos: list[httpx.Request] = []

    def tratar(pedido: httpx.Request) -> httpx.Response:
        pedidos.append(pedido)
        return httpx.Response(200, json=RESPOSTA)

    area = Poligono((Coordenada(0, 0), Coordenada(1, 0), Coordenada(1, 1)))
    regra = RegraDeCusto("highway", frozenset({"motorway"}), 0.1)

    await adaptador(tratar).calcular(CONSULTA, (area,), OpcoesDeCusto((regra,)))

    modelo = json.loads(pedidos[0].content)["custom_model"]
    assert [f["id"] for f in modelo["areas"]["features"]] == ["area0"]
    assert modelo["priority"] == [
        {"if": "in_area0", "multiply_by": "0"},
        {"if": "road_class == MOTORWAY", "multiply_by": "0.1"},
    ]


async def test_registra_o_tempo_de_cada_chamada() -> None:
    chamadas = medicao.abrir()

    await adaptador(lambda _: httpx.Response(200, json=RESPOSTA)).calcular(
        CONSULTA, (), OpcoesDeCusto()
    )

    assert len(chamadas) == 1
    assert chamadas[0] >= 0
