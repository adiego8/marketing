"""Authentication via Google OAuth.

Sign-in and Calendar connection happen in one step: the user clicks
"Sign in with Google", gets redirected to Google consent (email + calendar
scopes), and comes back with a refresh token stored on the agency.

Session check: GET /auth/me — if agency has refresh_token + email → signed in.
"""
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db
from app.config.settings import settings
from app.db.models import Agency, User
from app.services import google_calendar

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

DEFAULT_AGENCY_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class AuthResponse(BaseModel):
    user_email: str
    agency_id: str
    google_connected: bool


@router.get("/auth/me", response_model=AuthResponse)
async def get_current_user(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agency).where(Agency.id == DEFAULT_AGENCY_ID))
    agency = result.scalar_one_or_none()
    if not agency:
        raise HTTPException(404, "Agency not found")
    return AuthResponse(
        user_email=agency.google_connected_email or "",
        agency_id=str(agency.id),
        google_connected=bool(agency.google_refresh_token),
    )


@router.get("/auth/signin")
async def signin(db: AsyncSession = Depends(get_db)):
    """Redirect to Google consent (email + calendar). This IS the sign-in."""
    from google_auth_oauthlib.flow import Flow

    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        raise HTTPException(500, "Google OAuth credentials not configured")

    redirect_uri = f"{settings.api_base_url}/auth/callback"

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=google_calendar.SCOPES,
        redirect_uri=redirect_uri,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return RedirectResponse(url=auth_url)


@router.get("/auth/callback")
async def auth_callback(
    code: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """OAuth callback — exchanges code, stores refresh token, redirects home."""
    redirect_uri = f"{settings.api_base_url}/auth/callback"
    try:
        refresh_token, email = google_calendar.exchange_code(code, redirect_uri)
    except Exception as e:
        logger.exception("Token exchange failed: %s", e)
        return RedirectResponse(url=f"{settings.app_url}/login?error={str(e)[:200]}")

    result = await db.execute(select(Agency).where(Agency.id == DEFAULT_AGENCY_ID))
    agency = result.scalar_one_or_none()
    if not agency:
        return RedirectResponse(url=f"{settings.app_url}/login?error=Agency+not+found")

    agency.google_refresh_token = refresh_token
    agency.google_connected_email = email

    # Find or create user
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        user = User(
            id=uuid.uuid4(),
            agency_id=DEFAULT_AGENCY_ID,
            email=email,
            name=email.split("@")[0],
            role="admin",
        )
        db.add(user)

    await db.commit()
    return RedirectResponse(url=settings.app_url)


@router.post("/auth/signout")
async def signout(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agency).where(Agency.id == DEFAULT_AGENCY_ID))
    agency = result.scalar_one_or_none()
    if not agency:
        raise HTTPException(404, "Agency not found")
    agency.google_refresh_token = None
    agency.google_connected_email = None
    await db.commit()
    return {"signed_out": True}
