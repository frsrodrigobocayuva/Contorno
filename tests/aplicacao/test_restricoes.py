"""Gestor de Restrições (UC02): o desenho vira a área proibida, com medidas e conflitos."""

from app.aplicacao.restricoes import GestorDeRestricoes
from app.dominio.indexador import descompactar
from app.dominio.modelo import Coordenada, Extremo, Poligono

DESENHO = Poligono(
    (
        Coordenada(-51.150, -29.765),
        Coordenada(-51.145, -29.765),
        Coordenada(-51.145, -29.760),
        Coordenada(-51.150, -29.760),
    )
)
DENTRO = Coordenada(-51.1475, -29.7625)
FORA = Coordenada(-51.120, -29.700)


def test_define_a_area_com_celulas_contorno_e_medidas() -> None:
    area = GestorDeRestricoes(11).definir_area(DESENHO, FORA, FORA)

    assert area.celulas.resolucao == 11
    assert descompactar(area.compactadas, 11, 10_000) == area.celulas
    assert len(area.contorno) == 1
    assert 200_000 < area.area_desenhada_m2 < area.area_proibida_m2
    assert area.conflitos == ()


def test_aponta_a_origem_e_o_destino_dentro_da_area() -> None:
    gestor = GestorDeRestricoes(11)

    assert gestor.definir_area(DESENHO, DENTRO, FORA).conflitos == (Extremo.ORIGEM,)
    assert gestor.definir_area(DESENHO, FORA, DENTRO).conflitos == (Extremo.DESTINO,)
    assert gestor.definir_area(DESENHO, None, None).conflitos == ()
