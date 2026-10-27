"""Portas do domínio (ADR-004): o que o domínio precisa de fora, implementado na infraestrutura.

São Protocol: um falso de teste ou um adaptador só precisa ter os métodos, sem herdar. São
assíncronas porque o UC01 e o UC05 chamam o motor em paralelo (DAS 7.3).
"""

from collections.abc import Sequence
from typing import Protocol

from app.dominio.modelo import ConsultaDeRota, Lugar, OpcoesDeCusto, Poligono, Rota


class MotorDeRotas(Protocol):
    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        """A melhor rota da origem ao destino que não toca as exclusões, com as opções de custo.

        Sem exclusões nem opções, é a rota irrestrita. None quando não há rota (rota vazia, que
        aciona o UC05). Levanta MotorIndisponivel em tempo esgotado, erro de rede ou 5xx (DAS 6.4).
        """


class Geocodificador(Protocol):
    async def localizar(self, texto: str) -> list[Lugar]:
        """Os lugares que correspondem ao texto, dentro do recorte (ADR-013).

        Levanta GeocodificadorIndisponivel quando o serviço não responde.
        """
