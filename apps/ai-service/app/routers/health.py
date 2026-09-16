"""Liveness and readiness, matching the shape the NestJS API exposes at /api/health."""

import time

import redis.asyncio as redis
from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(tags=["health"])

_STARTED_AT = time.monotonic()


@router.get("/health")
async def live() -> dict[str, object]:
    """Process is up. Touches no dependency, so it stays fast under load."""
    return {"status": "ok", "uptime": round(time.monotonic() - _STARTED_AT)}


@router.get("/health/ready")
async def ready() -> dict[str, str]:
    """Process can serve — which for this service means Redis answers.

    Reports degraded rather than raising: an orchestrator wants a body it can read, and a
    500 here is indistinguishable from the service being down entirely.
    """
    settings = get_settings()
    client = redis.from_url(settings.redis_url)
    try:
        await client.ping()
        return {"status": "ok", "redis": "up"}
    except Exception:  # noqa: BLE001 - any failure to reach Redis means not ready
        return {"status": "degraded", "redis": "down"}
    finally:
        await client.aclose()
