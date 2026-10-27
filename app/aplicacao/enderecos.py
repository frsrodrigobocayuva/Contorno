"""Localizador de Endereço (UC06): busca que degrada sem bloquear (ADR-013).

Sem resultado ou com o serviço fora do ar, devolve lista vazia com o motivo; nunca erro.
"""

from app.dominio.excecoes import GeocodificadorIndisponivel
from app.dominio.modelo import MotivoDeBuscaVazia, ResultadoDeBusca
from app.dominio.portas import Geocodificador


class LocalizadorDeEndereco:
    def __init__(self, geocodificador: Geocodificador) -> None:
        self._geocodificador = geocodificador

    async def localizar(self, texto: str) -> ResultadoDeBusca:
        try:
            lugares = await self._geocodificador.localizar(texto)
        except GeocodificadorIndisponivel:
            return ResultadoDeBusca(motivo=MotivoDeBuscaVazia.SERVICO_INDISPONIVEL)
        if not lugares:
            return ResultadoDeBusca(motivo=MotivoDeBuscaVazia.SEM_RESULTADO)
        return ResultadoDeBusca(tuple(lugares))
