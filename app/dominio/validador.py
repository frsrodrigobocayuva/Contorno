"""Validador de Rota (DAS 6.6; ADR-006 e ADR-012): a rota restrita contra o contorno proibido.

Interseção exata da linha da rota com o contorno das células, o mesmo enviado ao motor. Rota que
toca o contorno é descartada pelo Orquestrador e nunca chega ao cliente (RN01).
"""

from collections.abc import Sequence

from shapely import LineString, prepare, unary_union

from app.dominio.indexador import forma_de
from app.dominio.modelo import Poligono, Rota


class ContornoProibido:
    """O contorno pronto para testes repetidos de interseção (ADR-012)."""

    def __init__(self, poligonos: Sequence[Poligono]) -> None:
        if not poligonos:
            raise ValueError("contorno vazio")
        self._geometria = unary_union([forma_de(p) for p in poligonos])
        prepare(self._geometria)

    def tocado_por(self, linha: LineString) -> bool:
        return bool(self._geometria.intersects(linha))


def violacoes(rota: Rota, contorno: ContornoProibido) -> tuple[int, ...]:
    """Os índices dos trechos da rota que tocam o contorno; vazio quando a rota respeita tudo."""
    pontos = [(c.longitude, c.latitude) for c in rota.geometria]
    if not contorno.tocado_por(LineString(pontos)):
        return ()
    return tuple(
        i
        for i in range(len(pontos) - 1)
        if contorno.tocado_por(LineString([pontos[i], pontos[i + 1]]))
    )
