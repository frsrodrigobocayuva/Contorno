"""O que uma requisição mede, para o log (DAS 6.12; plano, A9): o tempo de cada chamada ao motor e,
nas buscas de endereço, de onde veio a resposta e quanto ela esperou (medição [4] do DAS 8).

A apresentação abre a medição no começo da requisição e escreve no log; os adaptadores só
registram. Fora de uma medição aberta (scripts, testes), registrar não faz nada.
"""

from contextvars import ContextVar
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Busca:
    """Uma busca de endereço: do cache, do Nominatim ou com erro do Nominatim.

    `espera_s` é o tempo esperando a vez, porque o adaptador faz no máximo uma chamada por
    segundo (ADR-013); `nominatim_s`, o tempo da chamada, quando houve.
    """

    origem: str
    espera_s: float
    nominatim_s: float | None


@dataclass(slots=True)
class Medicao:
    motor: list[float] = field(default_factory=list)
    buscas: list[Busca] = field(default_factory=list)


_medicao: ContextVar[Medicao | None] = ContextVar("medicao", default=None)


def abrir() -> Medicao:
    medicao = Medicao()
    _medicao.set(medicao)
    return medicao


def registrar(segundos: float) -> None:
    """Uma chamada ao motor."""
    medicao = _medicao.get()
    if medicao is not None:
        medicao.motor.append(segundos)


def registrar_busca(busca: Busca) -> None:
    medicao = _medicao.get()
    if medicao is not None:
        medicao.buscas.append(busca)
