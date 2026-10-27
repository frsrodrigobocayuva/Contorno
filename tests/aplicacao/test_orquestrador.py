"""Orquestrador de Rota: a irrestrita como linha de base (UC01) ou o destino inalcançável."""

from collections.abc import Sequence

import pytest

from app.aplicacao.orquestrador import OrquestradorDeRota
from app.dominio.excecoes import MotorIndisponivel
from app.dominio.modelo import (
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


class MotorFalso:
    def __init__(self, rota: Rota | None = None, erro: Exception | None = None) -> None:
        self.rota = rota
        self.erro = erro
        self.chamadas: list[tuple[ConsultaDeRota, tuple[Poligono, ...], OpcoesDeCusto]] = []

    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        self.chamadas.append((consulta, tuple(exclusoes), opcoes))
        if self.erro:
            raise self.erro
        return self.rota


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


async def test_restricoes_ainda_nao_sao_aceitas() -> None:
    preferencia = PreferenciaVia(ClasseDeVia.RESIDENCIAL, NivelDeEvitacao.EVITAR)
    motor = MotorFalso(ROTA)

    with pytest.raises(ValueError):
        await OrquestradorDeRota(motor).calcular(
            ConsultaDeRota(UNISINOS, CENTRO_NH, (preferencia,))
        )
    assert motor.chamadas == []
