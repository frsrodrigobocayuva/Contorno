"""Adaptador GraphHopper: tradução da resposta e dos erros (DAS 6.4), sem o motor real."""

import json
from collections.abc import Callable

import httpx
import pytest

from app.dominio.excecoes import MotorIndisponivel
from app.dominio.modelo import ConsultaDeRota, Coordenada, OpcoesDeCusto, Poligono, Rota
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


async def test_rota_restrita_ainda_nao_e_aceita() -> None:
    area = Poligono((Coordenada(0, 0), Coordenada(1, 0), Coordenada(1, 1)))

    with pytest.raises(NotImplementedError):
        await adaptador(lambda _: httpx.Response(200, json=RESPOSTA)).calcular(
            CONSULTA, (area,), OpcoesDeCusto()
        )


async def test_registra_o_tempo_de_cada_chamada() -> None:
    chamadas = medicao.abrir()

    await adaptador(lambda _: httpx.Response(200, json=RESPOSTA)).calcular(
        CONSULTA, (), OpcoesDeCusto()
    )

    assert len(chamadas) == 1
    assert chamadas[0] >= 0
