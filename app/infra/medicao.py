"""Tempo de cada chamada ao motor dentro de uma requisição (DAS 6.12).

A apresentação abre a medição no começo da requisição e escreve os tempos no log; os adaptadores
só registram. Fora de uma medição aberta (scripts, testes), registrar não faz nada.
"""

from contextvars import ContextVar

_chamadas: ContextVar[list[float] | None] = ContextVar("chamadas_ao_motor", default=None)


def abrir() -> list[float]:
    chamadas: list[float] = []
    _chamadas.set(chamadas)
    return chamadas


def registrar(segundos: float) -> None:
    chamadas = _chamadas.get()
    if chamadas is not None:
        chamadas.append(segundos)
