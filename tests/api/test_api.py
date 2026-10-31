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
from app.aplicacao.restricoes import GestorDeRestricoes
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
    """Devolve `restrita` quando há exclusões e `rota` quando não há."""

    def __init__(
        self,
        rota: Rota | None = ROTA,
        erro: Exception | None = None,
        restrita: Rota | None = ROTA,
    ) -> None:
        self.rota = rota
        self.erro = erro
        self.restrita = restrita

    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        if self.erro:
            raise self.erro
        return self.restrita if exclusoes else self.rota


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
        GestorDeRestricoes(11),
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
            "restricoes.0.celulas",
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


# Áreas (S5-01): POST /restricoes/area e o cálculo com áreas


def quadrado(lon: float, lat: float, lado: float = 0.004) -> list[list[float]]:
    return [[lon, lat], [lon + lado, lat], [lon + lado, lat + lado], [lon, lat + lado]]


# A leste do caminho reto da UNISINOS ao centro de NH: a ROTA falsa não passa por ela.
A_LESTE = quadrado(-51.120, -29.745)
EM_VOLTA_DA_UNISINOS = quadrado(UNISINOS[0] - 0.002, UNISINOS[1] - 0.002)


async def definir_area(cliente: httpx.AsyncClient, corpo: dict[str, object]) -> httpx.Response:
    return await cliente.post("/restricoes/area", json=corpo)


async def celulas(cliente: httpx.AsyncClient, poligono: list[list[float]]) -> list[str]:
    resposta = await definir_area(cliente, {"poligono": poligono})
    assert resposta.status_code == 200, resposta.text
    lista: list[str] = resposta.json()["celulas"]
    return lista


def com_areas(*areas: tuple[str, list[str]]) -> dict[str, object]:
    return {
        "origem": UNISINOS,
        "destino": CENTRO_NH,
        "restricoes": [
            {"tipo": "AREA", "id": id_, "rotulo": f"Área {i}", "celulas": celulas_}
            for i, (id_, celulas_) in enumerate(areas, start=1)
        ],
    }


async def test_area_desenhada_vira_celulas_e_contorno() -> None:
    async with api() as cliente:
        resposta = await definir_area(
            cliente, {"poligono": A_LESTE, "origem": UNISINOS, "destino": CENTRO_NH}
        )

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["celulas"] and all(len(c) in (15, 16) for c in corpo["celulas"])
    anel = corpo["contorno"]["coordinates"][0][0]
    assert corpo["contorno"]["type"] == "MultiPolygon"
    assert anel[0] == anel[-1]
    assert 0 < corpo["areaDesenhadaM2"] < corpo["areaProibidaM2"]
    assert corpo["conflitos"] == []


async def test_area_aponta_a_origem_dentro_dela() -> None:
    async with api() as cliente:
        resposta = await definir_area(
            cliente, {"poligono": EM_VOLTA_DA_UNISINOS, "origem": UNISINOS, "destino": CENTRO_NH}
        )

    assert resposta.json()["conflitos"] == ["ORIGEM"]


@pytest.mark.parametrize(
    "corpo, campo, motivo",
    [
        (
            {
                "poligono": [
                    [-51.150, -29.765],
                    [-51.145, -29.760],
                    [-51.145, -29.765],
                    [-51.150, -29.760],
                ]
            },
            "poligono",
            "POLIGONO_INVALIDO",
        ),
        (
            {"poligono": [[-51.150, -29.765], [-51.145, -29.765], [-51.150, -29.765]]},
            "poligono",
            "POLIGONO_INVALIDO",
        ),
        ({"poligono": quadrado(*PORTO_ALEGRE)}, "poligono", "FORA_DA_REGIAO"),
        ({"poligono": A_LESTE, "origem": PORTO_ALEGRE}, "origem", "FORA_DA_REGIAO"),
    ],
)
async def test_area_invalida_e_recusada(corpo: dict[str, object], campo: str, motivo: str) -> None:
    async with api() as cliente:
        resposta = await definir_area(cliente, corpo)

    assert resposta.status_code == 422
    assert resposta.json()["codigo"] == "VALIDACAO"
    assert {"campo": campo, "motivo": motivo} in resposta.json()["detalhes"]


async def test_area_com_menos_de_tres_vertices_fica_fora_do_esquema() -> None:
    async with api() as cliente:
        resposta = await definir_area(cliente, {"poligono": A_LESTE[:2]})

    assert resposta.status_code == 422
    assert resposta.json()["detalhes"][0]["campo"] == "poligono"


async def test_rota_com_area_traz_a_restrita() -> None:
    async with api() as cliente:
        resposta = await calcular(cliente, com_areas(("a1", await celulas(cliente, A_LESTE))))

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["tipo"] == "ROTAS"
    assert corpo["restrita"] == corpo["irrestrita"]


async def test_extremo_dentro_de_area_e_422() -> None:
    async with api() as cliente:
        resposta = await calcular(
            cliente, com_areas(("a1", await celulas(cliente, EM_VOLTA_DA_UNISINOS)))
        )

    assert resposta.status_code == 422
    assert resposta.json()["codigo"] == "AREA_CONTEM_EXTREMO"
    assert resposta.json()["detalhes"] == [{"area": "a1", "extremo": "ORIGEM"}]


async def test_areas_que_bloqueiam_viram_o_aviso_provisorio() -> None:
    async with api(MotorFalso(restrita=None)) as cliente:
        resposta = await calcular(cliente, com_areas(("a1", await celulas(cliente, A_LESTE))))

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert (corpo["tipo"], corpo["causa"], corpo["candidatas"]) == (
        "DIAGNOSTICO",
        "AREAS_BLOQUEIAM",
        [],
    )
    assert "Remova ou redesenhe" in corpo["mensagem"]


@pytest.mark.parametrize(
    "areas, motivo",
    [
        ((("a1", ["8b0000000000000"]),), "não é uma célula H3"),
        ((("a1", ["8b0a8b6a5b2dfff"]), ("a1", ["8b0a8b6a5b2dfff"])), "ID_REPETIDO"),
    ],
)
async def test_celulas_invalidas_sao_recusadas(
    areas: tuple[tuple[str, list[str]], ...], motivo: str
) -> None:
    async with api() as cliente:
        resposta = await calcular(cliente, com_areas(*areas))

    assert resposta.status_code == 422
    assert resposta.json()["codigo"] == "VALIDACAO"
    assert motivo in resposta.json()["detalhes"][0]["motivo"]
