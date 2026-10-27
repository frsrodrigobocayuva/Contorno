"""Composition root da API (DAS 4) e entrega do front como estático, na mesma origem (DAS 6.1)."""

import os
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# Configuração lida uma vez na subida (DAS 6.11).
GRAPHHOPPER_URL = os.environ["GRAPHHOPPER_URL"]
WEB_DIST = Path(os.environ.get("WEB_DIST", "web/dist"))

app = FastAPI(title="Contorno")


@app.get("/health")
async def health() -> JSONResponse:
    """Responde 200 só quando o motor de rotas também responde."""
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            motor_ok = (await client.get(f"{GRAPHHOPPER_URL}/health")).status_code == 200
    except httpx.HTTPError:
        motor_ok = False
    return JSONResponse(
        {"api": "ok", "motor": "ok" if motor_ok else "indisponivel"},
        status_code=200 if motor_ok else 503,
    )


# Montado por último: as rotas da API têm precedência sobre os arquivos do front.
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
