"""Orquestrador de Rota (UC01): a rota irrestrita como linha de base.

Nesta etapa só a irrestrita (UC01, passos 1 a 4 e fluxo A); a restrita, o Validador e o
diagnóstico com áreas entram na Sprint 5.
"""

from app.dominio.modelo import (
    CausaDeInviabilidade,
    ConsultaDeRota,
    Diagnostico,
    OpcoesDeCusto,
    ResultadoComparativo,
)
from app.dominio.portas import MotorDeRotas


class OrquestradorDeRota:
    def __init__(self, motor: MotorDeRotas) -> None:
        self._motor = motor

    async def calcular(self, consulta: ConsultaDeRota) -> ResultadoComparativo | Diagnostico:
        """A irrestrita, ou o diagnóstico quando nem ela existe (UC05, fluxo B).

        MotorIndisponivel passa adiante: a apresentação responde 503 (UC01, exceção D).
        """
        if consulta.restricoes:
            raise ValueError("restrições entram na Sprint 5 (S5-01)")
        irrestrita = await self._motor.calcular(consulta, (), OpcoesDeCusto())
        if irrestrita is None:
            return Diagnostico(CausaDeInviabilidade.DESTINO_INALCANCAVEL)
        return ResultadoComparativo(irrestrita)
