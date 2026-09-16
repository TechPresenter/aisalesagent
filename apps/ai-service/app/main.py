"""Appsgain AI / voice service — scaffolding only.

TRD §6 puts LLM orchestration, speech-to-text, text-to-speech and audio processing in a
Python service, separate from the NestJS core API. This module wires the app together and
exposes health; the routers under app/routers describe the surface the core API will call
but do not implement any calling logic yet.

Run locally:  uvicorn app.main:app --reload --port 8000
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import calls, health


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Startup and shutdown.

    The Redis pool and telephony/LLM clients belong here once there is anything to
    connect to — held open for the process rather than built per request, which for the
    call pipeline is the difference between a connection setup per call leg and none.
    """
    yield


settings = get_settings()

app = FastAPI(
    title="Appsgain AI Service",
    description="LLM orchestration, speech-to-text and text-to-speech for AI voice calls.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(calls.router)
