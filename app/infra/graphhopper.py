"""Adaptador GraphHopper: implementa a porta MotorDeRotas (ADR-009; DAS 6.4)."""

import time
from collections.abc import Sequence

import httpx

from app.dominio.excecoes import MotorIndisponivel
from app.dominio.modelo import ConsultaDeRota, Coordenada, OpcoesDeCusto, Poligono, Rota
from app.infra import medicao

# Respostas 400 do GraphHopper que significam "rota vazia", e não erro (DAS 6.4).
_SEM_ROTA = ("ConnectionNotFoundException", "PointNotFoundException")


class AdaptadorGraphHopper:
    def __init__(self, cliente: httpx.AsyncClient, url: str, tempo_maximo_s: float) -> None:
        self._cliente = cliente
        self._url = url.rstrip("/")
        self._tempo_maximo_s = tempo_maximo_s

    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        if exclusoes or opcoes.regras:
            # Ignorar uma exclusão violaria a RN01: a rota restrita entra na S5-01.
            raise NotImplementedError("rota restrita entra na S5-01")
        corpo = {
            "profile": "car",
            "points": [
                [consulta.origem.longitude, consulta.origem.latitude],
                [consulta.destino.longitude, consulta.destino.latitude],
            ],
            "points_encoded": False,
        }
        inicio = time.perf_counter()
        try:
            resposta = await self._cliente.post(
                f"{self._url}/route", json=corpo, timeout=self._tempo_maximo_s
            )
        except httpx.HTTPError as erro:
            raise MotorIndisponivel(str(erro)) from erro
        finally:
            medicao.registrar(time.perf_counter() - inicio)

        if resposta.status_code == 400 and any(e in resposta.text for e in _SEM_ROTA):
            return None
        if resposta.status_code >= 500:
            raise MotorIndisponivel(f"GraphHopper respondeu {resposta.status_code}")
        resposta.raise_for_status()
        caminho = resposta.json()["paths"][0]
        return Rota(
            geometria=tuple(Coordenada(c[0], c[1]) for c in caminho["points"]["coordinates"]),
            duracao_segundos=caminho["time"] / 1000,
            distancia_metros=caminho["distance"],
        )
