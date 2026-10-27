"""Adaptador Nominatim: política de uso (ADR-013), com as respostas gravadas do S4-03."""

import json
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from app.dominio.excecoes import GeocodificadorIndisponivel
from app.dominio.modelo import Coordenada
from app.infra.nominatim import AdaptadorNominatim

pytestmark = pytest.mark.anyio

GRAVADAS = Path(__file__).resolve().parents[1] / "falsos" / "nominatim"
RETANGULO = (-51.2100287, -29.8302389, -50.9341246, -29.6377057)
USER_AGENT = "Contorno/teste (contato: teste@example.com)"


def gravada(arquivo: str) -> list[dict[str, object]]:
    resposta: list[dict[str, object]] = json.loads((GRAVADAS / arquivo).read_text(encoding="utf-8"))
    return resposta


class Relogio:
    def __init__(self) -> None:
        self.agora = 100.0
        self.esperas: list[float] = []

    def __call__(self) -> float:
        return self.agora

    async def dormir(self, segundos: float) -> None:
        self.esperas.append(segundos)
        self.agora += segundos


def adaptador(
    tratar: Callable[[httpx.Request], httpx.Response],
    relogio: Relogio,
    cache_tamanho: int = 256,
    cache_validade_s: float = 3600,
) -> AdaptadorNominatim:
    cliente = httpx.AsyncClient(transport=httpx.MockTransport(tratar))
    return AdaptadorNominatim(
        cliente,
        "http://falsos:8080/",
        USER_AGENT,
        RETANGULO,
        5,
        cache_tamanho,
        cache_validade_s,
        relogio,
        relogio.dormir,
    )


def contador(
    arquivo: str = "unisinos.json",
) -> tuple[list[httpx.Request], Callable[[httpx.Request], httpx.Response]]:
    pedidos: list[httpx.Request] = []

    def tratar(pedido: httpx.Request) -> httpx.Response:
        pedidos.append(pedido)
        return httpx.Response(200, json=gravada(arquivo))

    return pedidos, tratar


async def test_busca_com_os_parametros_da_politica_de_uso() -> None:
    pedidos, tratar = contador()

    lugares = await adaptador(tratar, Relogio()).localizar("UNISINOS")

    pedido = pedidos[0]
    assert pedido.url.path == "/search"
    assert dict(pedido.url.params) == {
        "q": "UNISINOS",
        "format": "jsonv2",
        "viewbox": "-51.2100287,-29.8302389,-50.9341246,-29.6377057",
        "bounded": "1",
        "countrycodes": "br",
        "limit": "5",
    }
    assert pedido.headers["User-Agent"] == USER_AGENT
    assert lugares[0].nome.startswith("Universidade do Vale do Rio dos Sinos")
    assert lugares[0].coordenada == Coordenada(-51.1549545, -29.7954567)
    assert len(lugares) == 3


async def test_sem_resultado_e_lista_vazia() -> None:
    _, tratar = contador("aeroporto-internacional-salgado-filho.json")

    assert (
        await adaptador(tratar, Relogio()).localizar("Aeroporto Internacional Salgado Filho") == []
    )


async def test_consulta_repetida_vem_do_cache() -> None:
    pedidos, tratar = contador()
    nominatim = adaptador(tratar, Relogio())

    primeira = await nominatim.localizar("UNISINOS")
    segunda = await nominatim.localizar("  unisinos ")

    assert segunda == primeira
    assert len(pedidos) == 1


async def test_cache_expira() -> None:
    pedidos, tratar = contador()
    relogio = Relogio()
    nominatim = adaptador(tratar, relogio, cache_validade_s=60)

    await nominatim.localizar("UNISINOS")
    relogio.agora += 61
    await nominatim.localizar("UNISINOS")

    assert len(pedidos) == 2


async def test_cache_cheio_descarta_a_consulta_mais_antiga() -> None:
    pedidos, tratar = contador()
    nominatim = adaptador(tratar, Relogio(), cache_tamanho=1)

    for texto in ("UNISINOS", "Rua Independência", "UNISINOS"):
        await nominatim.localizar(texto)

    assert len(pedidos) == 3


async def test_no_maximo_uma_requisicao_por_segundo() -> None:
    _, tratar = contador()
    relogio = Relogio()
    nominatim = adaptador(tratar, relogio)

    await nominatim.localizar("UNISINOS")
    relogio.agora += 0.3
    await nominatim.localizar("Rua Independência")

    assert relogio.esperas == [pytest.approx(0.7)]


async def test_sem_espera_depois_de_um_segundo() -> None:
    _, tratar = contador()
    relogio = Relogio()
    nominatim = adaptador(tratar, relogio)

    await nominatim.localizar("UNISINOS")
    relogio.agora += 1.5
    await nominatim.localizar("Rua Independência")

    assert relogio.esperas == []


@pytest.mark.parametrize("status", [403, 429, 500, 503])
async def test_resposta_de_erro_e_servico_indisponivel(status: int) -> None:
    with pytest.raises(GeocodificadorIndisponivel):
        await adaptador(lambda _: httpx.Response(status), Relogio()).localizar("UNISINOS")


async def test_tempo_esgotado_e_servico_indisponivel() -> None:
    def tratar(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("tempo")

    with pytest.raises(GeocodificadorIndisponivel):
        await adaptador(tratar, Relogio()).localizar("UNISINOS")
