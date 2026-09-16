"""The surface the NestJS API will call into. Scaffolding only — no calling logic yet.

These endpoints are declared now because their shapes are what apps/api codes against.
Each returns 501 rather than a plausible-looking stub: a stub that answers successfully
is worse than one that refuses, because it lets the caller be written against behaviour
that does not exist and look like it works.
"""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.config import Settings, get_settings

router = APIRouter(prefix="/calls", tags=["calls"])


async def require_service_key(
    x_api_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """Shared-secret check between the core API and this service.

    This service can start outbound calls, which spends credits and rings real phones, so
    it is not open even inside the cluster.
    """
    if x_api_key != settings.ai_service_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service key")


class StartCallRequest(BaseModel):
    tenant_id: str = Field(description="Workspace the call is billed and scoped to")
    lead_id: str
    campaign_id: str
    persona_id: str
    phone: str = Field(description="E.164 without the leading +, as stored on Lead.phone")
    language: str = Field(default="hi-IN")


class StartCallResponse(BaseModel):
    call_id: str
    status: str


@router.post("/start", response_model=StartCallResponse, dependencies=[Depends(require_service_key)])
async def start_call(_request: StartCallRequest) -> StartCallResponse:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Outbound calling is not implemented in this phase",
    )


class TranscribeRequest(BaseModel):
    tenant_id: str
    call_id: str
    recording_url: str


@router.post("/transcribe", dependencies=[Depends(require_service_key)])
async def transcribe(_request: TranscribeRequest) -> dict[str, str]:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Transcription is not implemented in this phase",
    )


class SummariseRequest(BaseModel):
    tenant_id: str
    call_id: str
    transcript: str


@router.post("/summarise", dependencies=[Depends(require_service_key)])
async def summarise(_request: SummariseRequest) -> dict[str, str]:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Summarisation and lead scoring are not implemented in this phase",
    )
