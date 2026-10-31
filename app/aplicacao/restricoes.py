"""Gestor de Restrições (UC02): o desenho do usuário vira a área proibida que ele vai conferir.

Só áreas no MVP (plano, D1): o raio entra na S5-04 pelo mesmo caminho.
"""

from dataclasses import dataclass

from app.dominio import indexador
from app.dominio.modelo import ConjuntoDeCelulas, Coordenada, Extremo, Poligono


@dataclass(frozen=True, slots=True)
class AreaDefinida:
    """O que o Editor mostra para o usuário confirmar (UC02, passos 3 a 6; RN04).

    As células vão compactadas, só para o transporte (ADR-011); o contorno é o da união delas, o
    mesmo que vai ao motor e ao Validador.
    """

    celulas: ConjuntoDeCelulas
    compactadas: tuple[int, ...]
    contorno: tuple[Poligono, ...]
    area_desenhada_m2: float
    area_proibida_m2: float
    conflitos: tuple[Extremo, ...]


class GestorDeRestricoes:
    def __init__(self, resolucao: int) -> None:
        self._resolucao = resolucao

    def definir_area(
        self, desenho: Poligono, origem: Coordenada | None, destino: Coordenada | None
    ) -> AreaDefinida:
        """Células por sobreposição, o contorno e os conflitos com a origem e o destino (exceção B).

        Com conflito, a área volta mesmo assim: o Editor avisa e ela só entra nas restrições
        depois de ajustada (Realização, UC02).
        """
        celulas = indexador.celulas_de(desenho, self._resolucao)
        contorno = indexador.poligonos_de(celulas)
        conflitos = tuple(
            extremo
            for extremo, ponto in ((Extremo.ORIGEM, origem), (Extremo.DESTINO, destino))
            if ponto is not None and indexador.contem(celulas, ponto)
        )
        return AreaDefinida(
            celulas=celulas,
            compactadas=indexador.compactar(celulas),
            contorno=contorno,
            area_desenhada_m2=indexador.area_m2([desenho]),
            area_proibida_m2=indexador.area_m2(contorno),
            conflitos=conflitos,
        )
