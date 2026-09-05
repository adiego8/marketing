import logging
import os
import traceback
from contextlib import asynccontextmanager

# Relax OAuth scope validation — Google normalizes scopes, oauthlib complains
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.db.session import engine

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Marketing Agent",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:3008"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.api.routes import (
        agencies, assets, auth, campaigns, clients, feedback,
        memory, onboarding, runs, schedule, slack_webhook, strategy, tasks,
    )

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(agencies.router, prefix="/api/v1")
    app.include_router(clients.router, prefix="/api/v1")
    app.include_router(strategy.router, prefix="/api/v1")
    app.include_router(runs.router, prefix="/api/v1")
    app.include_router(feedback.router, prefix="/api/v1")
    app.include_router(assets.router, prefix="/api/v1")
    app.include_router(schedule.router, prefix="/api/v1")
    app.include_router(slack_webhook.router, prefix="/api/v1")
    app.include_router(memory.router, prefix="/api/v1")
    app.include_router(tasks.router, prefix="/api/v1")
    app.include_router(onboarding.router, prefix="/api/v1")
    app.include_router(campaigns.router, prefix="/api/v1")

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.error(
            "Unhandled exception on %s %s:\n%s",
            request.method,
            request.url.path,
            traceback.format_exc(),
        )
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
