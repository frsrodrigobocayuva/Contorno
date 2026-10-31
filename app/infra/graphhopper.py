"""Adaptador GraphHopper: implementa a porta MotorDeRotas (ADR-009; DAS 6.4)."""

import time
from collections.abc import Sequence
from typing import Any

import httpx

from app.dominio.excecoes import MotorIndisponivel
from app.dominio.modelo import ConsultaDeRota, Coordenada, OpcoesDeCusto, Poligono, Rota
from app.infra import medicao

# Respostas 400 do GraphHopper que significam "rota vazia", e não erro (DAS 6.4).
_SEM_ROTA = ("ConnectionNotFoundException", "PointNotFoundException")


def _anel(pontos: Sequence[Coordenada]) -> list[list[float]]:
    """Anel GeoJSON: [longitude, latitude], fechado no primeiro ponto."""
    coordenadas = [[c.longitude, c.latitude] for c in pontos]
    return coordenadas if coordenadas[0] == coordenadas[-1] else [*coordenadas, coordenadas[0]]


def modelo_com_exclusoes(exclusoes: Sequence[Poligono]) -> dict[str, Any]:
    """custom_model da restrita: uma feature por polígono, prioridade 0 em cada (RN03, DAS 6.4)."""
    features = [
        {
            "type": "Feature",
            "id": f"area{i}",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [_anel(p.exterior), *(_anel(b) for b in p.buracos)],
            },
        }
        for i, p in enumerate(exclusoes)
    ]
    return {
        "areas": {"type": "FeatureCollection", "features": features},
        "priority": [{"if": f"in_area{i}", "multiply_by": "0"} for i in range(len(exclusoes))],
    }


class AdaptadorGraphHopper:
    def __init__(self, cliente: httpx.AsyncClient, url: str, tempo_maximo_s: float) -> None:
        self._cliente = cliente
        self._url = url.rstrip("/")
        self._tempo_maximo_s = tempo_maximo_s

    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        if opcoes.regras:
            # Ignorar uma preferência mudaria a rota sem avisar: as regras de via entram na S5-02.
            raise NotImplementedError("preferências de via entram na S5-02")
        corpo: dict[str, Any] = {
            "profile": "car",
            "points": [
                [consulta.origem.longitude, consulta.origem.latitude],
                [consulta.destino.longitude, consulta.destino.latitude],
            ],
            "points_encoded": False,
        }
        if exclusoes:
            # Restrita: CH desligado, acelerada por LM (ADR-014), com as áreas no custom_model.
            corpo["ch.disable"] = True
            corpo["custom_model"] = modelo_com_exclusoes(exclusoes)
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
