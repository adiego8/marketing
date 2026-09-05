import json
import logging
import uuid
from datetime import datetime

import litellm
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.services.llm_service import llm_completion
from app.services.web_scraper import scrape_company_website

logger = logging.getLogger(__name__)


async def _perplexity_research(query: str) -> str:
    """Run a research query via Perplexity's API (sonar model)."""
    response = await litellm.acompletion(
        model="perplexity/sonar",
        messages=[
            {"role": "user", "content": query},
        ],
        api_key=settings.perplexity_api_key,
        temperature=0.3,
    )
    return response.choices[0].message.content


async def research_company(
    company_name: str,
    website_url: str | None = None,
    description: str | None = None,
    competitors: list[str] | None = None,
    research_focus: list[str] | None = None,
) -> dict:
    """Run full research on a company.

    Steps:
    1. Scrape company website (if URL provided)
    2. Perplexity research: company analysis, competitors, gaps, PMF
    3. LLM synthesis into structured output

    Returns structured research findings.
    """
    focus = research_focus or [
        "company_analysis",
        "competitor_analysis",
        "competition_gaps",
        "product_market_fit",
    ]

    research_data = {
        "company_name": company_name,
        "description": description or "",
        "website_scraped": [],
        "perplexity_research": {},
    }

    # Step 1: Scrape company website
    if website_url:
        logger.info("Scraping website: %s", website_url)
        scraped_pages = await scrape_company_website(website_url)
        research_data["website_scraped"] = [
            {"url": p["url"], "title": p["title"], "text": p["text"][:3000]}
            for p in scraped_pages
        ]
        logger.info("Scraped %d pages from %s", len(scraped_pages), website_url)

    # Step 2: Perplexity research queries
    competitor_names = ", ".join(competitors) if competitors else "unknown"
    base_context = f"Company: {company_name}"
    if description:
        base_context += f"\nDescription: {description}"
    if website_url:
        base_context += f"\nWebsite: {website_url}"

    if "company_analysis" in focus:
        logger.info("Researching: company analysis")
        research_data["perplexity_research"]["company_analysis"] = await _perplexity_research(
            f"{base_context}\n\n"
            "Provide a comprehensive analysis of this company:\n"
            "- What do they do? What products/services do they offer?\n"
            "- Who is their target market?\n"
            "- What is their value proposition?\n"
            "- How do they position themselves in the market?\n"
            "- What is their current online presence and marketing approach?\n"
            "- What stage is the company at (startup, growth, mature)?\n"
            "Be specific and cite sources where possible."
        )

    if "competitor_analysis" in focus:
        logger.info("Researching: competitor analysis")
        competitor_query = f"{base_context}\n\n"
        if competitors:
            competitor_query += f"Known competitors: {competitor_names}\n\n"
        competitor_query += (
            "Identify and analyze the main competitors for this company:\n"
            "- Who are the top 5-7 competitors (direct and indirect)?\n"
            "- What is each competitor's positioning and messaging?\n"
            "- What are their strengths and weaknesses?\n"
            "- What pricing models do they use?\n"
            "- What marketing channels do they focus on?\n"
            "Be specific with company names, URLs, and concrete details."
        )
        research_data["perplexity_research"]["competitor_analysis"] = await _perplexity_research(
            competitor_query
        )

    if "competition_gaps" in focus:
        logger.info("Researching: competition gaps")
        research_data["perplexity_research"]["competition_gaps"] = await _perplexity_research(
            f"{base_context}\n\n"
            f"Known competitors: {competitor_names}\n\n"
            "Analyze the competitive landscape and identify gaps:\n"
            "- What are competitors NOT doing well or NOT addressing?\n"
            "- What customer pain points are underserved?\n"
            "- What messaging angles are no one using?\n"
            "- What market segments are being ignored?\n"
            "- What distribution channels are underutilized?\n"
            "Focus on actionable opportunities for differentiation."
        )

    if "product_market_fit" in focus:
        logger.info("Researching: product-market fit")
        research_data["perplexity_research"]["product_market_fit"] = await _perplexity_research(
            f"{base_context}\n\n"
            "Analyze the product-market fit for this company:\n"
            "- Is there clear demand for what they offer? What signals indicate this?\n"
            "- Who is the ideal customer and why?\n"
            "- What problems do they solve that people are actively searching for?\n"
            "- Are there reviews, testimonials, or social proof indicating fit?\n"
            "- What search volume exists for related keywords?\n"
            "- What market trends support or challenge their offering?\n"
            "Be specific with data, trends, and evidence."
        )

    # Step 3: LLM synthesis
    logger.info("Synthesizing research findings")
    synthesis_prompt = """You are a marketing research analyst. You have been given raw research data about a company — website content, competitor analysis, market gaps, and product-market fit signals.

Synthesize everything into a structured research report.

## Output Format

Return a JSON object:

```json
{
  "company_analysis": {
    "name": "Company name",
    "description": "What they do in 2-3 sentences",
    "products_services": ["List of products/services"],
    "value_proposition": "Their core value prop",
    "current_positioning": "How they currently position themselves",
    "stage": "startup / growth / mature",
    "online_presence": "Assessment of their current marketing"
  },
  "target_audience": {
    "primary": "Primary audience description",
    "secondary": "Secondary audience if applicable",
    "pain_points": ["Specific pain points"],
    "goals": ["What they want to achieve"],
    "where_they_hang_out": ["Channels, platforms, communities"]
  },
  "competitors": [
    {
      "name": "Competitor name",
      "url": "website",
      "positioning": "How they position",
      "strengths": ["..."],
      "weaknesses": ["..."]
    }
  ],
  "competition_gaps": [
    {
      "gap": "What's missing or underserved",
      "opportunity": "How to exploit this gap",
      "priority": "high / medium / low"
    }
  ],
  "product_market_fit": {
    "assessment": "strong / moderate / early / unclear",
    "evidence": ["Signals supporting PMF"],
    "risks": ["Signals against PMF"],
    "ideal_customer_profile": "Specific description of who benefits most"
  },
  "recommended_positioning_angles": [
    {
      "angle_type": "contrarian / unique_mechanism / transformation / enemy / speed / specificity / social_proof / risk_reversal",
      "angle": "The specific angle",
      "why": "Why this would work for this company"
    }
  ]
}
```

Be specific and actionable. No generic marketing advice — everything should be tailored to this specific company and market."""

    synthesis = await llm_completion(
        system_prompt=synthesis_prompt,
        user_prompt=json.dumps(research_data, indent=2),
        json_mode=True,
        temperature=0.4,
    )

    # Add metadata
    synthesis["_meta"] = {
        "research_id": str(uuid.uuid4()),
        "company_name": company_name,
        "website_url": website_url,
        "researched_at": datetime.utcnow().isoformat(),
        "pages_scraped": len(research_data.get("website_scraped", [])),
        "research_focus": focus,
    }

    logger.info("Research complete for %s", company_name)
    return synthesis


async def generate_marketing_profile(
    research: dict,
    overrides: dict | None = None,
    db: AsyncSession | None = None,
) -> dict:
    """Generate a full marketing profile (strategy) from research findings.

    This creates the ICP, voice, positioning, messaging, and goals
    that power all daily content generation.
    """
    profile_prompt = """You are a marketing strategist. Based on comprehensive research about a company, create a complete marketing profile that will guide an autonomous marketing agent.

## Output Format

Return a JSON object:

```json
{
  "business_name": "Company name",
  "icp": {
    "description": "2-3 sentence description of ideal customer",
    "demographics": {
      "industry": "...",
      "company_size": "...",
      "role": "Decision maker role",
      "revenue_range": "..."
    },
    "pain_points": ["Specific, researched pain points"],
    "goals": ["What they want to achieve"],
    "objections": ["Common objections to buying"],
    "trigger_events": ["What makes them start looking for a solution"]
  },
  "voice": {
    "personality": "2-3 sentence description of brand personality",
    "traits": ["3-5 personality traits"],
    "tone": "overall tone description",
    "words_to_use": ["Words and phrases that fit the brand"],
    "words_to_avoid": ["revolutionary", "game-changing", "crushing it", "leverage", "synergy", "unlock your potential"],
    "communication_style": "How the brand communicates (formal/casual, technical/simple, etc.)"
  },
  "positioning": {
    "primary_angle": {
      "type": "The main positioning angle type",
      "statement": "The positioning statement",
      "why": "Why this angle works"
    },
    "secondary_angles": [
      {
        "type": "angle type",
        "statement": "The positioning statement",
        "why": "Why this angle works"
      }
    ],
    "anti_positioning": "What the brand is NOT and doesn't want to be associated with",
    "differentiation": "What makes this company genuinely different"
  },
  "messaging": {
    "tagline": "A suggested tagline",
    "value_props": ["3-5 core value propositions"],
    "key_messages": ["3-5 key messages to repeat across all content"],
    "proof_points": ["Evidence, stats, or stories that support the messaging"]
  },
  "goals": {
    "primary": "awareness / leads / conversions / retention",
    "secondary": "...",
    "metrics": ["Specific metrics to track"],
    "90_day_focus": "What to focus on in the next 90 days"
  },
  "content_strategy": {
    "platforms": ["Primary platforms to focus on"],
    "content_pillars": ["3-5 content themes to rotate through"],
    "content_types": ["Types of content that would work best"],
    "posting_frequency": "Recommended frequency"
  },
  "content_quota": {
    "weekly": {
      "post": 4,
      "hook": 3,
      "cta": 2
    },
    "rationale": "Brief explanation of why this content cadence is recommended based on the company's stage, audience, and goals"
  }
}
```

## Guidelines

- Everything should be derived from the research, not generic templates.
- The voice should feel authentic to the company, not imposed.
- Positioning angles should exploit the competition gaps identified in research.
- ICP should be specific enough to write content for, not vague personas.
- Goals should be realistic for the company's current stage.
- Content quota should reflect a sustainable weekly cadence for the company's stage and resources. Early-stage companies need less volume but higher quality. Consider what the target audience consumes and where they spend time.
"""

    research_input = json.dumps(research, indent=2)
    if overrides:
        research_input += f"\n\n## Human Overrides\n{json.dumps(overrides, indent=2)}"

    profile = await llm_completion(
        system_prompt=profile_prompt,
        user_prompt=research_input,
        json_mode=True,
        temperature=0.5,
    )

    logger.info("Marketing profile generated for %s", research.get("company_analysis", {}).get("name", "unknown"))
    return profile
