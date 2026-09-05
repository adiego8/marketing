from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM
    openai_api_key: str = ""
    llm_model: str = "gpt-4o"
    llm_provider: str = "openai"

    # Perplexity (research)
    perplexity_api_key: str = ""

    # Google AI / Gemini (image generation)
    google_ai_api_key: str = ""

    # Database
    neon_database_url: str = ""

    # Slack
    slack_bot_token: str = ""
    slack_signing_secret: str = ""
    slack_channel_id: str = ""

    # GCS
    gcs_bucket: str = ""

    # Google OAuth (app-level, for token exchange + Calendar API)
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    # App
    app_env: str = "development"
    app_url: str = "http://localhost:3008"
    api_base_url: str = "http://localhost:8080/api/v1"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
