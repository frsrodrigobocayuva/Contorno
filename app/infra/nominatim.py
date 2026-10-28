"""Adaptador Nominatim: implementa a porta Geocodificador, com a política de uso (ADR-013).

No máximo uma requisição por segundo, com uma trava compartilhada entre requisições simultâneas;
User-Agent com contato; cache em memória das consultas repetidas; busca restrita ao recorte.
"""

import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable

import httpx

from app.dominio.excecoes import GeocodificadorIndisponivel
from app.dominio.modelo import Coordenada, Lugar

INTERVALO_MINIMO_S = 1.0


class AdaptadorNominatim:
    def __init__(
        self,
        cliente: httpx.AsyncClient,
        url: str,
        user_agent: str,
        retangulo: tuple[float, float, float, float],
        tempo_maximo_s: float,
        cache_tamanho: int,
        cache_validade_s: float,
        relogio: Callable[[], float] = time.monotonic,
        dormir: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._cliente = cliente
        self._url = url.rstrip("/")
        self._user_agent = user_agent
        self._viewbox = ",".join(str(v) for v in retangulo)
        self._tempo_maximo_s = tempo_maximo_s
        self._cache: OrderedDict[str, tuple[float, list[Lugar]]] = OrderedDict()
        self._cache_tamanho = cache_tamanho
        self._cache_validade_s = cache_validade_s
        self._relogio = relogio
        self._dormir = dormir
        self._trava = asyncio.Lock()
        self._ultima_chamada: float | None = None

    async def localizar(self, texto: str) -> list[Lugar]:
        chave = " ".join(texto.split()).casefold()
        if (lugares := self._do_cache(chave)) is not None:
            return lugares
        async with self._trava:
            # Outra requisição pode ter buscado o mesmo texto enquanto esta esperava a trava.
            if (lugares := self._do_cache(chave)) is not None:
                return lugares
            if self._ultima_chamada is not None:
                espera = self._ultima_chamada + INTERVALO_MINIMO_S - self._relogio()
                if espera > 0:
                    await self._dormir(espera)
            try:
                resposta = await self._cliente.get(
                    f"{self._url}/search",
                    params={
                        "q": texto,
                        "format": "jsonv2",
                        "viewbox": self._viewbox,
                        "bounded": "1",
                        "countrycodes": "br",
                        "limit": "5",
                    },
                    headers={"User-Agent": self._user_agent},
                    timeout=self._tempo_maximo_s,
                )
            except httpx.HTTPError as erro:
                raise GeocodificadorIndisponivel(str(erro)) from erro
            finally:
                self._ultima_chamada = self._relogio()
        if resposta.status_code != 200:
            raise GeocodificadorIndisponivel(f"Nominatim respondeu {resposta.status_code}")
        lugares = [
            Lugar(item["display_name"], Coordenada(float(item["lon"]), float(item["lat"])))
            for item in resposta.json()
        ]
        self._guardar(chave, lugares)
        return lugares

    def _do_cache(self, chave: str) -> list[Lugar] | None:
        guardado = self._cache.get(chave)
        if guardado is None:
            return None
        expira_em, lugares = guardado
        if self._relogio() >= expira_em:
            del self._cache[chave]
            return None
        self._cache.move_to_end(chave)
        return list(lugares)

    def _guardar(self, chave: str, lugares: list[Lugar]) -> None:
        self._cache[chave] = (self._relogio() + self._cache_validade_s, list(lugares))
        self._cache.move_to_end(chave)
        while len(self._cache) > self._cache_tamanho:
            self._cache.popitem(last=False)
