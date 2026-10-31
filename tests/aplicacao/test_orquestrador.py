"""Orquestrador de Rota (UC01): a irrestrita como linha de base e, com áreas, a restrita."""

import asyncio
import logging
from collections.abc import Sequence

import pytest

from app.aplicacao.orquestrador import OrquestradorDeRota
from app.dominio.excecoes import ExtremoDentroDaArea, MotorIndisponivel
from app.dominio.indexador import celulas_de
from app.dominio.modelo import (
    AreaExcluida,
    CausaDeInviabilidade,
    ClasseDeVia,
    ConsultaDeRota,
    Coordenada,
    Diagnostico,
    NivelDeEvitacao,
    OpcoesDeCusto,
    Poligono,
    PreferenciaVia,
    ResultadoComparativo,
    Rota,
)

pytestmark = pytest.mark.anyio

UNISINOS = Coordenada(-51.1549545, -29.7954567)
CENTRO_NH = Coordenada(-51.1429035, -29.6905705)
CONSULTA = ConsultaDeRota(UNISINOS, CENTRO_NH)
ROTA = Rota((UNISINOS, CENTRO_NH), 1260, 12_800)
# Um quadrado no meio do caminho reto entre a UNISINOS e o centro de NH.
NO_CAMINHO = Poligono(
    (
        Coordenada(-51.152, -29.743),
        Coordenada(-51.145, -29.743),
        Coordenada(-51.145, -29.737),
        Coordenada(-51.152, -29.737),
    )
)
AREA = AreaExcluida("a1", "Área 1", celulas_de(NO_CAMINHO, 11))
# Desvia 2 km para oeste, por fora da área.
DESVIO = Rota((UNISINOS, Coordenada(-51.175, -29.740), CENTRO_NH), 1500, 14_100)


class MotorFalso:
    """Devolve a rota da vez: `restrita` quando há exclusões, `rota` quando não há."""

    def __init__(
        self,
        rota: Rota | None = None,
        erro: Exception | None = None,
        restrita: Rota | None = None,
    ) -> None:
        self.rota = rota
        self.erro = erro
        self.restrita = restrita
        self.chamadas: list[tuple[ConsultaDeRota, tuple[Poligono, ...], OpcoesDeCusto]] = []
        self.em_voo = 0
        self.maximo_em_voo = 0

    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        self.chamadas.append((consulta, tuple(exclusoes), opcoes))
        self.em_voo += 1
        self.maximo_em_voo = max(self.maximo_em_voo, self.em_voo)
        await asyncio.sleep(0)
        self.em_voo -= 1
        if self.erro:
            raise self.erro
        return self.restrita if exclusoes else self.rota


async def test_calcula_a_irrestrita_sem_exclusoes_nem_opcoes() -> None:
    motor = MotorFalso(ROTA)

    resultado = await OrquestradorDeRota(motor).calcular(CONSULTA)

    assert resultado == ResultadoComparativo(ROTA)
    assert motor.chamadas == [(CONSULTA, (), OpcoesDeCusto())]


async def test_sem_irrestrita_o_destino_e_inalcancavel() -> None:
    resultado = await OrquestradorDeRota(MotorFalso(None)).calcular(CONSULTA)

    assert resultado == Diagnostico(CausaDeInviabilidade.DESTINO_INALCANCAVEL)


async def test_motor_indisponivel_passa_adiante() -> None:
    with pytest.raises(MotorIndisponivel):
        await OrquestradorDeRota(MotorFalso(erro=MotorIndisponivel())).calcular(CONSULTA)


async def test_preferencias_de_via_ainda_nao_sao_aceitas() -> None:
    preferencia = PreferenciaVia(ClasseDeVia.RESIDENCIAL, NivelDeEvitacao.EVITAR)
    motor = MotorFalso(ROTA)

    with pytest.raises(ValueError):
        await OrquestradorDeRota(motor).calcular(
            ConsultaDeRota(UNISINOS, CENTRO_NH, (preferencia,))
        )
    assert motor.chamadas == []


# Com áreas (S5-01)


async def test_com_area_calcula_as_duas_rotas_em_paralelo_e_valida_a_restrita() -> None:
    motor = MotorFalso(ROTA, restrita=DESVIO)
    consulta = ConsultaDeRota(UNISINOS, CENTRO_NH, (AREA,))

    resultado = await OrquestradorDeRota(motor).calcular(consulta)

    assert resultado == ResultadoComparativo(ROTA, DESVIO, (AREA,))
    assert motor.maximo_em_voo == 2
    irrestrita, restrita = motor.chamadas
    assert irrestrita[1] == ()
    assert len(restrita[1]) == 1


async def test_extremo_dentro_da_area_nao_chama_o_motor() -> None:
    motor = MotorFalso(ROTA, restrita=DESVIO)
    em_volta_da_origem = Poligono(
        (
            Coordenada(UNISINOS.longitude - 0.002, UNISINOS.latitude - 0.002),
            Coordenada(UNISINOS.longitude + 0.002, UNISINOS.latitude - 0.002),
            Coordenada(UNISINOS.longitude + 0.002, UNISINOS.latitude + 0.002),
        )
    )
    area = AreaExcluida("a2", "Campus", celulas_de(em_volta_da_origem, 11))

    with pytest.raises(ExtremoDentroDaArea) as erro:
        await OrquestradorDeRota(motor).calcular(ConsultaDeRota(UNISINOS, CENTRO_NH, (AREA, area)))

    assert erro.value.conflitos == (("a2", "ORIGEM"),)
    assert motor.chamadas == []


async def test_sem_restrita_as_areas_bloqueiam() -> None:
    motor = MotorFalso(ROTA, restrita=None)

    resultado = await OrquestradorDeRota(motor).calcular(
        ConsultaDeRota(UNISINOS, CENTRO_NH, (AREA,))
    )

    assert resultado == Diagnostico(CausaDeInviabilidade.AREAS_BLOQUEIAM)


async def test_com_areas_e_sem_irrestrita_o_destino_e_inalcancavel() -> None:
    motor = MotorFalso(None, restrita=None)

    resultado = await OrquestradorDeRota(motor).calcular(
        ConsultaDeRota(UNISINOS, CENTRO_NH, (AREA,))
    )

    assert resultado == Diagnostico(CausaDeInviabilidade.DESTINO_INALCANCAVEL)


async def test_restrita_que_cruza_a_area_e_descartada(caplog: pytest.LogCaptureFixture) -> None:
    motor = MotorFalso(ROTA, restrita=ROTA)

    with caplog.at_level(logging.WARNING, logger="contorno.orquestrador"):
        resultado = await OrquestradorDeRota(motor).calcular(
            ConsultaDeRota(UNISINOS, CENTRO_NH, (AREA,))
        )

    assert resultado == Diagnostico(CausaDeInviabilidade.AREAS_BLOQUEIAM)
    assert "descartada" in caplog.text
