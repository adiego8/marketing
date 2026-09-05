"""Google Calendar service.

Handles OAuth flow + calendar/event operations per agency.
Each agency brings its own OAuth credentials (client_id + secret) stored
on the Agency record. Refresh token is obtained during connect flow.

Each client gets its own Google Calendar under the connected account,
keyed by `client.google_calendar_id`.
"""
import logging
import os
from datetime import datetime, timedelta

# Google normalizes/reorders scopes in token responses (e.g., drops implicit
# "openid" or returns scopes in a different order). oauthlib rejects that by
# default with "Scope has changed". Relaxing this is the recommended fix.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")  # allow http redirect in dev

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

TOKEN_URI = "https://oauth2.googleapis.com/token"


def _client_config() -> dict:
    """OAuth client config from app-level settings (env vars)."""
    from app.config.settings import settings
    return {
        "web": {
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": TOKEN_URI,
        }
    }


def exchange_code(code: str, redirect_uri: str) -> tuple[str, str]:
    """Exchange authorization code for refresh token + user email."""
    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )
    flow.fetch_token(code=code)
    creds = flow.credentials
    refresh_token = creds.refresh_token
    if not refresh_token:
        raise ValueError(
            "No refresh_token received. Revoke app access in Google account "
            "and reconnect."
        )

    # Fetch user email via userinfo endpoint
    service = build("oauth2", "v2", credentials=creds)
    userinfo = service.userinfo().get().execute()
    email = userinfo.get("email", "")
    return refresh_token, email


def _credentials(agency) -> Credentials:
    """Build credentials using app-level client ID/secret + agency's refresh token."""
    from app.config.settings import settings
    if not agency.google_refresh_token:
        raise ValueError("Agency not connected to Google")
    creds = Credentials(
        token=None,
        refresh_token=agency.google_refresh_token,
        token_uri=TOKEN_URI,
        client_id=settings.google_oauth_client_id,
        client_secret=settings.google_oauth_client_secret,
        scopes=SCOPES,
    )
    creds.refresh(Request())
    return creds


def get_calendar_service(agency):
    creds = _credentials(agency)
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def create_client_calendar(agency, client) -> str:
    """Create a new calendar for a client. Returns calendar_id."""
    service = get_calendar_service(agency)
    body = {
        "summary": f"{client.name} — Marketing",
        "description": f"Scheduled posts for {client.name}",
        "timeZone": "UTC",
    }
    result = service.calendars().insert(body=body).execute()
    calendar_id = result["id"]
    logger.info("Created Google Calendar %s for client %s", calendar_id, client.id)
    return calendar_id


def create_event(
    agency,
    calendar_id: str,
    title: str,
    description: str,
    start: datetime,
    end: datetime | None = None,
) -> str:
    service = get_calendar_service(agency)
    if end is None:
        end = start + timedelta(minutes=30)
    body = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
    }
    result = service.events().insert(calendarId=calendar_id, body=body).execute()
    return result["id"]


def update_event(
    agency,
    calendar_id: str,
    event_id: str,
    title: str | None = None,
    description: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
):
    service = get_calendar_service(agency)
    body: dict = {}
    if title is not None:
        body["summary"] = title
    if description is not None:
        body["description"] = description
    if start is not None:
        body["start"] = {"dateTime": start.isoformat(), "timeZone": "UTC"}
    if end is not None:
        body["end"] = {"dateTime": end.isoformat(), "timeZone": "UTC"}
    if not body:
        return
    service.events().patch(
        calendarId=calendar_id,
        eventId=event_id,
        body=body,
    ).execute()


def delete_event(agency, calendar_id: str, event_id: str):
    service = get_calendar_service(agency)
    try:
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
    except HttpError as e:
        if e.resp.status == 404 or e.resp.status == 410:
            return  # already gone
        raise


def calendar_embed_url(calendar_id: str) -> str:
    """Return an iframe-embeddable URL for a calendar."""
    from urllib.parse import quote
    return (
        f"https://calendar.google.com/calendar/embed?src={quote(calendar_id)}"
        f"&ctz=UTC&mode=WEEK"
    )


def calendar_open_url(calendar_id: str) -> str:
    """Return a direct-view URL for a calendar (opens Google Calendar)."""
    from urllib.parse import quote
    return f"https://calendar.google.com/calendar/u/0/r?cid={quote(calendar_id)}"
