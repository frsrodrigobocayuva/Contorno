"""Portas assíncronas e exceções de negócio do domínio."""

import inspect

from app.dominio.excecoes import (
    ErroDoDominio,
    ExtremoDentroDaArea,
    GeocodificadorIndisponivel,
    MotorIndisponivel,
)
from app.dominio.portas import Geocodificador, MotorDeRotas


def test_portas_sao_assincronas() -> None:
    """O UC01 e o UC05 chamam o motor em paralelo (DAS 7.3)."""
    assert inspect.iscoroutinefunction(MotorDeRotas.calcular)
    assert inspect.iscoroutinefunction(Geocodificador.localizar)


def test_extremo_dentro_da_area_leva_as_areas() -> None:
    erro = ExtremoDentroDaArea(["a1", "a2"])

    assert erro.areas == ("a1", "a2")
    assert "a1, a2" in str(erro)


def test_excecoes_sao_de_negocio() -> None:
    for excecao in (ExtremoDentroDaArea, MotorIndisponivel, GeocodificadorIndisponivel):
        assert issubclass(excecao, ErroDoDominio)
