"""Exceções com significado de negócio (DAS 6.9). Só a apresentação conhece código HTTP."""

from collections.abc import Sequence


class ErroDoDominio(Exception):
    """Base das exceções de negócio."""


class ExtremoDentroDaArea(ErroDoDominio):
    """Origem ou destino dentro de uma área excluída; a API responde 422 AREA_CONTEM_EXTREMO.

    Cada conflito é o id da área e o extremo que ela contém (ORIGEM ou DESTINO).
    """

    def __init__(self, conflitos: Sequence[tuple[str, str]]) -> None:
        self.conflitos = tuple(conflitos)
        self.areas = tuple(dict.fromkeys(area for area, _ in self.conflitos))
        super().__init__(f"origem ou destino dentro da(s) área(s): {', '.join(self.areas)}")


class MotorIndisponivel(ErroDoDominio):
    """O motor não respondeu (tempo esgotado, erro de rede ou 5xx); a API responde 503."""


class GeocodificadorIndisponivel(ErroDoDominio):
    """O serviço de geocodificação não respondeu.

    Nunca chega à API: o Localizador a transforma em lista vazia com SERVICO_INDISPONIVEL (ADR-013).
    """
