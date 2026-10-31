"""Indexador Espacial: cobertura por sobreposição, compactação, contorno e medidas (DAS 6.3)."""

import h3.api.basic_int as h3int
import pytest

from app.dominio.indexador import (
    area_m2,
    celulas_de,
    compactar,
    consolidar,
    contem,
    descompactar,
    desenho_valido,
    forma_de,
    poligonos_de,
)
from app.dominio.modelo import ConjuntoDeCelulas, Coordenada, Poligono

RESOLUCAO = 11


def retangulo(lon: float, lat: float, largura: float, altura: float) -> Poligono:
    return Poligono(
        (
            Coordenada(lon, lat),
            Coordenada(lon + largura, lat),
            Coordenada(lon + largura, lat + altura),
            Coordenada(lon, lat + altura),
        )
    )


# Um quarteirão grande no centro de São Leopoldo, cerca de 480 m × 550 m.
DESENHO = retangulo(-51.150, -29.765, 0.005, 0.005)


def test_toda_celula_que_toca_o_desenho_entra() -> None:
    celulas = celulas_de(DESENHO, RESOLUCAO)
    contorno = poligonos_de(celulas)

    assert celulas.resolucao == RESOLUCAO
    assert forma_de(contorno[0]).covers(forma_de(DESENHO))
    assert area_m2(contorno) > area_m2([DESENHO])


def test_compactar_e_descompactar_devolvem_o_mesmo_conjunto() -> None:
    celulas = celulas_de(DESENHO, RESOLUCAO)
    compactadas = compactar(celulas)

    assert len(compactadas) < celulas.quantidade()
    assert descompactar(compactadas, RESOLUCAO, 10_000) == celulas


@pytest.mark.parametrize(
    "indices, motivo",
    [
        ([], "sem células"),
        ([0x8B0000000000000], "não é uma célula H3"),
        ([h3int.latlng_to_cell(-29.76, -51.15, 12)], "acima de 11"),
        ([h3int.latlng_to_cell(-29.76, -51.15, 4)], "passa de"),
    ],
)
def test_descompactar_recusa_indice_invalido(indices: list[int], motivo: str) -> None:
    with pytest.raises(ValueError, match=motivo):
        descompactar(indices, RESOLUCAO, 300_000)


def test_contorno_guarda_os_buracos() -> None:
    centro = h3int.latlng_to_cell(-29.76, -51.15, RESOLUCAO)
    anel = set(h3int.grid_disk(centro, 2)) - set(h3int.grid_disk(centro, 1))

    contorno = poligonos_de(ConjuntoDeCelulas(RESOLUCAO, frozenset(anel)))

    assert len(contorno) == 1
    assert len(contorno[0].buracos) == 1


def test_contorno_de_areas_separadas_tem_uma_parte_cada() -> None:
    longe = retangulo(-51.120, -29.700, 0.002, 0.002)
    conjunto = consolidar([celulas_de(DESENHO, RESOLUCAO), celulas_de(longe, RESOLUCAO)])

    assert len(poligonos_de(conjunto)) == 2


def test_contem_pela_celula_do_ponto() -> None:
    celulas = celulas_de(DESENHO, RESOLUCAO)

    assert contem(celulas, Coordenada(-51.1475, -29.7625))
    assert not contem(celulas, Coordenada(-51.120, -29.700))


def test_consolidar_une_sem_duplicar() -> None:
    a = celulas_de(retangulo(-51.150, -29.765, 0.004, 0.004), RESOLUCAO)
    b = celulas_de(retangulo(-51.148, -29.763, 0.004, 0.004), RESOLUCAO)

    unido = consolidar([a, b])

    assert unido.indices == a.indices | b.indices
    assert unido.quantidade() < a.quantidade() + b.quantidade()
    with pytest.raises(ValueError):
        consolidar([])


def test_area_em_metros_quadrados() -> None:
    # 0,01° × 0,01° na latitude de São Leopoldo: cerca de 966 m × 1.108 m.
    assert area_m2([retangulo(-51.16, -29.80, 0.01, 0.01)]) == pytest.approx(1_071_000, rel=0.01)


def test_desenho_que_se_cruza_e_invalido() -> None:
    gravata = Poligono(
        (
            Coordenada(-51.150, -29.765),
            Coordenada(-51.145, -29.760),
            Coordenada(-51.145, -29.765),
            Coordenada(-51.150, -29.760),
        )
    )

    assert desenho_valido(DESENHO)
    assert not desenho_valido(gravata)
