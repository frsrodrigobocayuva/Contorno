"""Regra das camadas (ADR-004; decisão de 2026-10-27): cada camada só importa as de baixo, e o
domínio não importa bibliotecas de borda. Lê os imports sem executar os módulos (DAS 6.13).

api -> aplicacao -> dominio <- infra: a infraestrutura implementa as portas do domínio, e a api
monta tudo na subida (composition root).
"""

import ast
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[2] / "app"

PROIBIDOS = {
    "dominio": (
        "app.aplicacao",
        "app.api",
        "app.infra",
        "httpx",
        "fastapi",
        "starlette",
        "uvicorn",
        "pydantic",
    ),
    "aplicacao": ("app.api", "app.infra"),
    "infra": ("app.api", "app.aplicacao"),
}


def importados(arquivo: Path, pacote: str) -> set[str]:
    """Módulos importados pelo arquivo, com os imports relativos resolvidos a partir do pacote."""
    nomes: set[str] = set()
    for no in ast.walk(ast.parse(arquivo.read_text(encoding="utf-8"))):
        if isinstance(no, ast.Import):
            nomes.update(alias.name for alias in no.names)
        elif isinstance(no, ast.ImportFrom):
            if no.level:
                base = pacote.split(".")[: len(pacote.split(".")) - (no.level - 1)]
                nomes.add(".".join([*base, no.module] if no.module else base))
            elif no.module:
                nomes.add(no.module)
    return nomes


def violacoes(arquivo: Path, pacote: str, proibidos: tuple[str, ...]) -> list[str]:
    return sorted(
        nome
        for nome in importados(arquivo, pacote)
        if any(nome == p or nome.startswith(p + ".") for p in proibidos)
    )


def arquivos_da_camada(camada: str) -> list[Path]:
    return sorted((APP / camada).rglob("*.py"))


@pytest.mark.parametrize(
    "camada, arquivo",
    [(camada, arquivo) for camada in PROIBIDOS for arquivo in arquivos_da_camada(camada)],
    ids=lambda valor: valor.relative_to(APP).as_posix() if isinstance(valor, Path) else valor,
)
def test_camada_so_importa_as_de_baixo(camada: str, arquivo: Path) -> None:
    pacote = ".".join(arquivo.relative_to(APP.parent).parts[:-1])

    assert violacoes(arquivo, pacote, PROIBIDOS[camada]) == []


def test_regra_pega_import_absoluto_e_relativo(tmp_path: Path) -> None:
    modulo = tmp_path / "modelo.py"
    modulo.write_text(
        "import httpx\n"
        "from app.infra.graphhopper import Adaptador\n"
        "from ..aplicacao import orquestrador\n"
        "from .portas import MotorDeRotas\n"
        "from . import excecoes\n",
        encoding="utf-8",
    )

    assert violacoes(modulo, "app.dominio", PROIBIDOS["dominio"]) == [
        "app.aplicacao",
        "app.infra.graphhopper",
        "httpx",
    ]
