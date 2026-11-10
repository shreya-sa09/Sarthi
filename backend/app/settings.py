from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./sarthi.db"
    gnani_api_key: str = ""
    gnani_base_url: str = "https://api.vachana.ai"
    prisma_model: str = "prisma-v3.0"
    timbre_model: str = "timbre-v3.0"
    timbre_voice: str = "Avinash"
    evon_base_url: str = ""
    evon_api_key: str = ""
    evon_model: str = "gnani/gnani-evon-v3.3-30B-A3B"
    decision_provider: str = "groq"
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "openai/gpt-oss-120b"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    frontend_origin: str = "http://localhost:5173"
    graphhopper_api_key: str = ""

    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parent.parent / ".env", extra="ignore")


settings = Settings()
