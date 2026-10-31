"""Orquestrador de Rota (UC01): a irrestrita como linha de base e, com restrições, a restrita.

Áreas proíbem e são conferidas pelo Validador (RN01); preferências de via só encarecem, pelo
Tradutor (UC03, RN06). Sem rota restrita, a resposta é o aviso provisório de que as áreas
bloqueiam; o diagnóstico que aponta a área entra na S5-03 (plano, 2026-10-30).
"""

import asyncio
import logging

from app.dominio import indexador, tradutor
from app.dominio.excecoes import ExtremoDentroDaArea
from app.dominio.modelo import (
    CausaDeInviabilidade,
    ConsultaDeRota,
    Diagnostico,
    Extremo,
    OpcoesDeCusto,
    PreferenciaVia,
    ResultadoComparativo,
)
from app.dominio.portas import MotorDeRotas
from app.dominio.validador import ContornoProibido, violacoes

log = logging.getLogger("contorno.orquestrador")


class OrquestradorDeRota:
    def __init__(self, motor: MotorDeRotas) -> None:
        self._motor = motor

    async def calcular(self, consulta: ConsultaDeRota) -> ResultadoComparativo | Diagnostico:
        """A irrestrita e, com áreas, a restrita validada; ou o diagnóstico quando não há rota.

        MotorIndisponivel passa adiante: a apresentação responde 503 (UC01, exceção D).
        ExtremoDentroDaArea sai antes de chamar o motor (UC01, exceção E).
        """
        areas = consulta.areas()
        opcoes = tradutor.opcoes_de_custo(
            r for r in consulta.restricoes if isinstance(r, PreferenciaVia)
        )
        if not areas and not opcoes.regras:
            irrestrita = await self._motor.calcular(consulta, (), OpcoesDeCusto())
            if irrestrita is None:
                return Diagnostico(CausaDeInviabilidade.DESTINO_INALCANCAVEL)
            return ResultadoComparativo(irrestrita)

        conflitos = [
            (area.id, extremo)
            for area in areas
            for extremo, ponto in (
                (Extremo.ORIGEM, consulta.origem),
                (Extremo.DESTINO, consulta.destino),
            )
            if indexador.contem(area.celulas, ponto)
        ]
        if conflitos:
            raise ExtremoDentroDaArea(conflitos)

        # As áreas viram uma região só (RN05); o contorno dela vai ao motor e ao Validador.
        contorno = (
            indexador.poligonos_de(indexador.consolidar([a.celulas for a in areas]))
            if areas
            else ()
        )
        irrestrita, restrita = await asyncio.gather(
            self._motor.calcular(consulta, (), OpcoesDeCusto()),
            self._motor.calcular(consulta, contorno, opcoes),
        )
        if irrestrita is None:
            return Diagnostico(CausaDeInviabilidade.DESTINO_INALCANCAVEL)
        if restrita is None:
            # Só área bloqueia; sem área, uma restrita vazia é o próprio destino inalcançável.
            causa = (
                CausaDeInviabilidade.AREAS_BLOQUEIAM
                if areas
                else CausaDeInviabilidade.DESTINO_INALCANCAVEL
            )
            return Diagnostico(causa)
        trechos = violacoes(restrita, ContornoProibido(contorno)) if contorno else ()
        if trechos:
            # UC01, exceção C: a rota violadora é descartada e nunca é serializada (RN01).
            log.warning("rota restrita descartada: %d trecho(s) tocam o contorno", len(trechos))
            return Diagnostico(CausaDeInviabilidade.AREAS_BLOQUEIAM)
        return ResultadoComparativo(irrestrita, restrita, consulta.restricoes)
