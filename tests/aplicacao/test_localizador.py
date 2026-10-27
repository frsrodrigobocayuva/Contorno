"""Localizador de Endereço: busca que degrada sem bloquear (UC06, ADR-013)."""

import pytest

from app.aplicacao.enderecos import LocalizadorDeEndereco
from app.dominio.excecoes import GeocodificadorIndisponivel
from app.dominio.modelo import Coordenada, Lugar, MotivoDeBuscaVazia, ResultadoDeBusca

pytestmark = pytest.mark.anyio

UNISINOS = Lugar("Universidade do Vale do Rio dos Sinos", Coordenada(-51.1549545, -29.7954567))


class GeocodificadorFalso:
    def __init__(self, lugares: list[Lugar] | None = None, erro: Exception | None = None) -> None:
        self.lugares = lugares or []
        self.erro = erro
        self.textos: list[str] = []

    async def localizar(self, texto: str) -> list[Lugar]:
        self.textos.append(texto)
        if self.erro:
            raise self.erro
        return self.lugares


async def test_devolve_os_lugares_encontrados() -> None:
    geocodificador = GeocodificadorFalso([UNISINOS])

    resultado = await LocalizadorDeEndereco(geocodificador).localizar("UNISINOS")

    assert resultado == ResultadoDeBusca((UNISINOS,))
    assert geocodificador.textos == ["UNISINOS"]


async def test_sem_resultado_e_lista_vazia_com_motivo() -> None:
    resultado = await LocalizadorDeEndereco(GeocodificadorFalso([])).localizar("rua dos ipês")

    assert resultado == ResultadoDeBusca(motivo=MotivoDeBuscaVazia.SEM_RESULTADO)


async def test_servico_fora_do_ar_e_lista_vazia_com_motivo() -> None:
    geocodificador = GeocodificadorFalso(erro=GeocodificadorIndisponivel())

    resultado = await LocalizadorDeEndereco(geocodificador).localizar("UNISINOS")

    assert resultado == ResultadoDeBusca(motivo=MotivoDeBuscaVazia.SERVICO_INDISPONIVEL)
