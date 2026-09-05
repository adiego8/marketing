import logging

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MarketingAgent/1.0)",
}


async def scrape_url(url: str) -> dict:
    """Scrape a URL and extract text content.

    Returns:
        {
            "url": str,
            "title": str,
            "text": str (truncated to ~8000 chars),
            "meta_description": str,
            "error": str | None,
        }
    """
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            response = await client.get(url, headers=HEADERS)
            response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        # Remove script/style elements
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()

        title = soup.title.string.strip() if soup.title and soup.title.string else ""
        meta_desc = ""
        meta_tag = soup.find("meta", attrs={"name": "description"})
        if meta_tag and meta_tag.get("content"):
            meta_desc = meta_tag["content"]

        text = soup.get_text(separator="\n", strip=True)
        # Truncate to avoid blowing up context
        text = text[:8000]

        return {
            "url": url,
            "title": title,
            "text": text,
            "meta_description": meta_desc,
            "error": None,
        }
    except Exception as e:
        logger.warning("Failed to scrape %s: %s", url, e)
        return {
            "url": url,
            "title": "",
            "text": "",
            "meta_description": "",
            "error": str(e),
        }


async def scrape_company_website(base_url: str) -> list[dict]:
    """Scrape key pages from a company website.

    Attempts: homepage, /about, /services or /products, /pricing
    """
    pages_to_try = [
        base_url.rstrip("/"),
        base_url.rstrip("/") + "/about",
        base_url.rstrip("/") + "/about-us",
        base_url.rstrip("/") + "/services",
        base_url.rstrip("/") + "/products",
        base_url.rstrip("/") + "/pricing",
        base_url.rstrip("/") + "/features",
    ]

    results = []
    for url in pages_to_try:
        result = await scrape_url(url)
        if result["text"] and not result["error"]:
            results.append(result)
            logger.info("Scraped: %s (%d chars)", url, len(result["text"]))

    return results
