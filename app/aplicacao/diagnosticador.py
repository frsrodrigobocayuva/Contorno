"""Diagnosticador de Inviabilidade (UC05; Realização, UC05): qual área impede o trajeto.

Só as áreas entram na busca (RN03; Realização [1]): uma preferência de via nunca bloqueia, porque o
fator dela é sempre maior que zero. Para cada área, a rota sem ela, em paralelo e com concorrência
limitada (Realização [2]); cada rota encontrada passa pelo Validador (RN01). As opções de custo
chegam prontas do Orquestrador (Realização [4]).

O passo 1 do UC05, a irrestrita, já foi feito pelo Orquestrador: o diagnóstico só é pedido quando
ela existe (S5-03).
"""

import asyncio
import logging
import time

from app.dominio import indexador
from app.dominio.modelo import (
    AreaExcluida,
    CausaDeInviabilidade,
    ConsultaDeRota,
    Diagnostico,
    OpcoesDeCusto,
)
from app.dominio.portas import MotorDeRotas
from app.dominio.validador import ContornoProibido, violacoes

log = logging.getLogger("contorno.diagnosticador")


class DiagnosticadorDeInviabilidade:
    def __init__(self, motor: MotorDeRotas, concorrencia: int) -> None:
        if concorrencia < 1:
            raise ValueError("a concorrência do diagnóstico precisa ser pelo menos 1")
        self._motor = motor
        self._concorrencia = concorrencia

    async def diagnosticar(self, consulta: ConsultaDeRota, opcoes: OpcoesDeCusto) -> Diagnostico:
        """As áreas cuja remoção isolada abre caminho, ou a combinação de todas (UC05, alt. A).

        Pré-condição: a irrestrita existe e a restrita com todas as áreas não (ou violou o
        contorno). MotorIndisponivel passa adiante e cancela as chamadas que ainda faltam.
        """
        areas = consulta.areas()
        if not areas:
            raise ValueError("o diagnóstico percorre as áreas, e a consulta não tem nenhuma")
        inicio = time.perf_counter()
        limite = asyncio.Semaphore(self._concorrencia)
        tarefas = [
            asyncio.create_task(self._abre_caminho(consulta, areas, i, opcoes, limite))
            for i in range(len(areas))
        ]
        try:
            abre = await asyncio.gather(*tarefas)
        except BaseException:
            for tarefa in tarefas:
                tarefa.cancel()
            raise
        candidatas = tuple(area.id for area, sim in zip(areas, abre, strict=True) if sim)
        diagnostico = (
            Diagnostico(CausaDeInviabilidade.RESTRICAO_UNICA, candidatas)
            if candidatas
            else Diagnostico(
                CausaDeInviabilidade.COMBINACAO_DE_RESTRICOES, tuple(a.id for a in areas)
            )
        )
        log.info(
            "diagnostico",
            extra={
                "dados": {
                    "areas": len(areas),
                    "chamadas_ao_motor": len(areas) if len(areas) > 1 else 0,
                    "causa": diagnostico.causa.value,
                    "candidatas": len(diagnostico.candidatas),
                    "ms": round((time.perf_counter() - inicio) * 1000, 1),
                }
            },
        )
        return diagnostico

    async def _abre_caminho(
        self,
        consulta: ConsultaDeRota,
        areas: tuple[AreaExcluida, ...],
        removida: int,
        opcoes: OpcoesDeCusto,
        limite: asyncio.Semaphore,
    ) -> bool:
        outras = areas[:removida] + areas[removida + 1 :]
        if not outras:
            # Sem nenhuma área sobra a irrestrita (com, no máximo, preferências, que nunca
            # bloqueiam), e ela existe: tirar a única área abre caminho sem chamar o motor.
            return True
        async with limite:
            contorno = indexador.poligonos_de(indexador.consolidar([a.celulas for a in outras]))
            rota = await self._motor.calcular(consulta, contorno, opcoes)
        if rota is None:
            return False
        if violacoes(rota, ContornoProibido(contorno)):
            log.warning(
                "rota sem a área %s descartada: toca o contorno das outras",
                areas[removida].id,
            )
            return False
        return True
