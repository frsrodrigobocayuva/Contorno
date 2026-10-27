"""Falsos da OSM no compose do CI (plano, A5): o que o CI usa no lugar do Nominatim e dos tiles.

Roda dentro da rede do compose do CI (compose.ci.yaml), onde FALSOS_URL aponta para o serviço
falsos e os hosts públicos da OSM estão bloqueados.
"""

import os
import socket

import httpx
import pytest

FALSOS_URL = os.environ.get("FALSOS_URL", "")

pytestmark = [
    pytest.mark.skipif(not FALSOS_URL, reason="falsos do compose do CI não configurados"),
    pytest.mark.enable_socket,
]

PARAMETROS = {"format": "jsonv2", "bounded": "1", "countrycodes": "br", "limit": "5"}


def buscar(consulta: str) -> httpx.Response:
    return httpx.get(f"{FALSOS_URL}/search", params={"q": consulta, **PARAMETROS}, timeout=5)


def test_consulta_gravada_responde_no_formato_jsonv2() -> None:
    resposta = buscar("  unisinos ")

    assert resposta.status_code == 200, resposta.text
    lugares = resposta.json()
    assert lugares
    assert {"lat", "lon", "display_name", "category", "type"} <= lugares[0].keys()


def test_consulta_fora_do_recorte_responde_lista_vazia() -> None:
    resposta = buscar("Aeroporto Internacional Salgado Filho")

    assert resposta.status_code == 200
    assert resposta.json() == []


def test_consulta_nao_gravada_falha_com_motivo() -> None:
    resposta = buscar("Rua que nao foi gravada")

    assert resposta.status_code == 501
    assert "não gravada" in resposta.text


def test_tile_em_branco() -> None:
    resposta = httpx.get(f"{FALSOS_URL}/15/11733/18994.png", timeout=5)

    assert resposta.status_code == 200
    assert resposta.headers["content-type"] == "image/png"
    assert resposta.content.startswith(b"\x89PNG")


@pytest.mark.parametrize("host", ["nominatim.openstreetmap.org", "tile.openstreetmap.org"])
def test_servicos_publicos_da_osm_bloqueados(host: str) -> None:
    enderecos = {info[4][0] for info in socket.getaddrinfo(host, 443)}

    assert enderecos <= {"0.0.0.0", "::"}
