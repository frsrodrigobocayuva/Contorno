"""A API no próprio processo, com falsos das portas: contrato (DAS 6.1), erros (DAS 6.9) e log."""

import json
from collections.abc import Callable, Sequence

import httpx
import pytest

from app.api.config import Configuracao
from app.api.dependencias import Dependencias
from app.api.main import criar_app
from app.api.registro import FormatoJSON
from app.aplicacao.enderecos import LocalizadorDeEndereco
from app.aplicacao.orquestrador import OrquestradorDeRota
from app.dominio.excecoes import GeocodificadorIndisponivel, MotorIndisponivel
from app.dominio.modelo import (
    CausaDeInviabilidade,
    ConsultaDeRota,
    Coordenada,
    Diagnostico,
    Lugar,
    OpcoesDeCusto,
    Poligono,
    Rota,
)

pytestmark = pytest.mark.anyio

CONFIG = Configuracao(
    graphhopper_url="http://graphhopper:8989",
    tempo_maximo_motor_s=2,
    nominatim_url="http://falsos:8080",
    nominatim_user_agent="Contorno/teste (contato: teste@example.com)",
    tempo_maximo_geocodificador_s=5,
    cache_tamanho=10,
    cache_validade_s=60,
    retangulo=(-51.2100287, -29.8302389, -50.9341246, -29.6377057),
)
UNISINOS = [-51.1549545, -29.7954567]
CENTRO_NH = [-51.1429035, -29.6905705]
PORTO_ALEGRE = [-51.2300, -30.0300]
ROTA = Rota((Coordenada(*UNISINOS), Coordenada(*CENTRO_NH)), 1260, 12_800)


class MotorFalso:
    def __init__(self, rota: Rota | None = ROTA, erro: Exception | None = None) -> None:
        self.rota = rota
        self.erro = erro

    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        if self.erro:
            raise self.erro
        return self.rota


class GeocodificadorFalso:
    def __init__(self, lugares: list[Lugar] | None = None, erro: Exception | None = None) -> None:
        self.lugares = lugares or []
        self.erro = erro

    async def localizar(self, texto: str) -> list[Lugar]:
        if self.erro:
            raise self.erro
        return self.lugares


def api(
    motor: MotorFalso | None = None,
    geocodificador: GeocodificadorFalso | None = None,
    graphhopper: Callable[[httpx.Request], httpx.Response] = lambda _: httpx.Response(200),
) -> httpx.AsyncClient:
    dependencias = Dependencias(
        CONFIG,
        httpx.AsyncClient(transport=httpx.MockTransport(graphhopper)),
        OrquestradorDeRota(motor or MotorFalso()),
        LocalizadorDeEndereco(geocodificador or GeocodificadorFalso()),
    )
    transporte = httpx.ASGITransport(app=criar_app(dependencias), raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transporte, base_url="http://contorno")


async def calcular(cliente: httpx.AsyncClient, corpo: dict[str, object]) -> httpx.Response:
    return await cliente.post("/rotas/calculo", json=corpo)


# POST /rotas/calculo


async def test_rota_irrestrita() -> None:
    async with api() as cliente:
        resposta = await calcular(cliente, {"origem": UNISINOS, "destino": CENTRO_NH})

    assert resposta.status_code == 200
    assert resposta.json() == {
        "tipo": "ROTAS",
        "irrestrita": {
            "geometria": {"type": "LineString", "coordinates": [UNISINOS, CENTRO_NH]},
            "duracaoSegundos": 1260,
            "distanciaMetros": 12_800,
        },
        "restrita": None,
    }


async def test_destino_inalcancavel_e_200_so_com_diagnostico() -> None:
    async with api(MotorFalso(rota=None)) as cliente:
        resposta = await calcular(cliente, {"origem": UNISINOS, "destino": CENTRO_NH})

    assert resposta.status_code == 200
    assert resposta.json() == {
        "tipo": "DIAGNOSTICO",
        "causa": "DESTINO_INALCANCAVEL",
        "candidatas": [],
        "mensagem": Diagnostico(CausaDeInviabilidade.DESTINO_INALCANCAVEL).mensagem(),
    }


async def test_ponto_fora_da_regiao_e_422() -> None:
    async with api() as cliente:
        resposta = await calcular(cliente, {"origem": UNISINOS, "destino": PORTO_ALEGRE})

    assert resposta.status_code == 422
    assert resposta.json() == {
        "codigo": "VALIDACAO",
        "mensagem": "Entrada inválida.",
        "detalhes": [{"campo": "destino", "motivo": "FORA_DA_REGIAO"}],
    }


@pytest.mark.parametrize(
    "corpo, campo",
    [
        (
            {"origem": UNISINOS, "destino": CENTRO_NH, "restricoes": [{"tipo": "AREA"}]},
            "restricoes",
        ),
        ({"origem": [200, 0], "destino": CENTRO_NH}, "origem.0"),
        ({"origem": UNISINOS}, "destino"),
        ({"origem": UNISINOS, "destino": CENTRO_NH, "perfil": "x"}, "perfil"),
    ],
)
async def test_entrada_fora_do_esquema_e_422(corpo: dict[str, object], campo: str) -> None:
    async with api() as cliente:
        resposta = await calcular(cliente, corpo)

    assert resposta.status_code == 422
    assert resposta.json()["codigo"] == "VALIDACAO"
    assert campo in [d["campo"] for d in resposta.json()["detalhes"]]


async def test_motor_indisponivel_e_503() -> None:
    async with api(MotorFalso(erro=MotorIndisponivel("tempo esgotado"))) as cliente:
        resposta = await calcular(cliente, {"origem": UNISINOS, "destino": CENTRO_NH})

    assert resposta.status_code == 503
    assert resposta.json()["codigo"] == "MOTOR_INDISPONIVEL"


async def test_erro_inesperado_e_500_sem_detalhe_tecnico() -> None:
    async with api(MotorFalso(erro=RuntimeError("segredo interno"))) as cliente:
        resposta = await calcular(cliente, {"origem": UNISINOS, "destino": CENTRO_NH})

    assert resposta.status_code == 500
    assert resposta.json() == {
        "codigo": "ERRO_INTERNO",
        "mensagem": "Erro interno.",
        "detalhes": None,
    }


# GET /enderecos


async def test_busca_devolve_os_lugares() -> None:
    lugar = Lugar("Universidade do Vale do Rio dos Sinos", Coordenada(*UNISINOS))

    async with api(geocodificador=GeocodificadorFalso([lugar])) as cliente:
        resposta = await cliente.get("/enderecos", params={"q": " UNISINOS "})

    assert resposta.status_code == 200
    assert resposta.json() == {
        "lugares": [{"nome": "Universidade do Vale do Rio dos Sinos", "coordenada": UNISINOS}],
        "motivo": None,
    }


@pytest.mark.parametrize(
    "geocodificador, motivo",
    [
        (GeocodificadorFalso([]), "SEM_RESULTADO"),
        (GeocodificadorFalso(erro=GeocodificadorIndisponivel()), "SERVICO_INDISPONIVEL"),
    ],
)
async def test_busca_vazia_e_200_com_motivo(
    geocodificador: GeocodificadorFalso, motivo: str
) -> None:
    async with api(geocodificador=geocodificador) as cliente:
        resposta = await cliente.get("/enderecos", params={"q": "rua dos ipês 1200"})

    assert resposta.status_code == 200
    assert resposta.json() == {"lugares": [], "motivo": motivo}


@pytest.mark.parametrize("params", [{"q": "   "}, {}, {"q": "x" * 201}])
async def test_busca_sem_texto_valido_e_422(params: dict[str, str]) -> None:
    async with api() as cliente:
        resposta = await cliente.get("/enderecos", params=params)

    assert resposta.status_code == 422
    assert resposta.json()["codigo"] == "VALIDACAO"


# GET /health


async def test_health_com_o_motor_no_ar() -> None:
    async with api() as cliente:
        resposta = await cliente.get("/health")

    assert resposta.status_code == 200
    assert resposta.json() == {"api": "ok", "motor": "ok"}


@pytest.mark.parametrize("status", [500, None])
async def test_health_com_o_motor_fora_do_ar(status: int | None) -> None:
    def graphhopper(_: httpx.Request) -> httpx.Response:
        if status is None:
            raise httpx.ConnectError("recusada")
        return httpx.Response(status)

    async with api(graphhopper=graphhopper) as cliente:
        resposta = await cliente.get("/health")

    assert resposta.status_code == 503
    assert resposta.json() == {"api": "ok", "motor": "indisponivel"}


# Log em JSON por linha (A9)


async def test_cada_requisicao_vira_uma_linha_json_sem_o_texto_buscado(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="contorno.requisicoes")

    async with api() as cliente:
        await calcular(cliente, {"origem": UNISINOS, "destino": CENTRO_NH})
        await cliente.get("/enderecos", params={"q": "Rua da minha casa 123"})

    linhas = [
        json.loads(FormatoJSON().format(r))
        for r in caplog.records
        if r.name == "contorno.requisicoes"
    ]
    assert [(linha["caminho"], linha["status"]) for linha in linhas] == [
        ("/rotas/calculo", 200),
        ("/enderecos", 200),
    ]
    assert all({"momento", "ms_total", "ms_motor"} <= linha.keys() for linha in linhas)
    assert "minha casa" not in json.dumps(linhas)
