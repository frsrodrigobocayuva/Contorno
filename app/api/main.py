"""Composition root da API (DAS 4) e entrega do front como estático, na mesma origem (DAS 6.1)."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import enderecos, rotas
from app.api.config import Configuracao
from app.api.dependencias import Dependencias, Deps
from app.api.erros import registrar_tratadores
from app.api.registro import configurar_log, registrar_requisicoes
from app.aplicacao.enderecos import LocalizadorDeEndereco
from app.aplicacao.orquestrador import OrquestradorDeRota
from app.infra.graphhopper import AdaptadorGraphHopper
from app.infra.nominatim import AdaptadorNominatim


def montar(config: Configuracao, cliente: httpx.AsyncClient) -> Dependencias:
    """Liga as portas do domínio aos adaptadores da infraestrutura (ADR-004)."""
    motor = AdaptadorGraphHopper(cliente, config.graphhopper_url, config.tempo_maximo_motor_s)
    geocodificador = AdaptadorNominatim(
        cliente,
        config.nominatim_url,
        config.nominatim_user_agent,
        config.retangulo,
        config.tempo_maximo_geocodificador_s,
        config.cache_tamanho,
        config.cache_validade_s,
    )
    return Dependencias(
        config, cliente, OrquestradorDeRota(motor), LocalizadorDeEndereco(geocodificador)
    )


def criar_app(dependencias: Dependencias | None = None) -> FastAPI:
    """A aplicação; os testes passam as dependências prontas, com falsos das portas."""

    @asynccontextmanager
    async def ciclo(app: FastAPI) -> AsyncIterator[None]:
        if dependencias is not None:
            yield
            return
        # Configuração lida uma vez na subida (DAS 6.11).
        config = Configuracao.do_ambiente()
        async with httpx.AsyncClient() as cliente:
            app.state.dependencias = montar(config, cliente)
            yield

    app = FastAPI(title="Contorno", lifespan=ciclo)
    if dependencias is not None:
        app.state.dependencias = dependencias
    configurar_log()
    registrar_requisicoes(app)
    registrar_tratadores(app)
    app.include_router(rotas.router)
    app.include_router(enderecos.router)

    @app.get("/health")
    async def health(dependencias: Deps) -> JSONResponse:
        """Responde 200 só quando o motor de rotas também responde."""
        try:
            resposta = await dependencias.cliente.get(
                f"{dependencias.config.graphhopper_url}/health", timeout=2
            )
            motor_ok = resposta.status_code == 200
        except httpx.HTTPError:
            motor_ok = False
        return JSONResponse(
            {"api": "ok", "motor": "ok" if motor_ok else "indisponivel"},
            status_code=200 if motor_ok else 503,
        )

    # Montado por último: as rotas da API têm precedência sobre os arquivos do front.
    web_dist = Path(os.environ.get("WEB_DIST", "web/dist"))
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
    return app


app = criar_app()
