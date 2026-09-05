from pydantic import BaseModel


class ResearchRequest(BaseModel):
    company_name: str
    website_url: str | None = None
    description: str | None = None
    competitors: list[str] | None = None
    research_focus: list[str] | None = None  # defaults to all 4 areas


class ProfileRequest(BaseModel):
    research: dict  # The research output from /onboarding/research
    overrides: dict | None = None  # Optional human tweaks before profile generation
