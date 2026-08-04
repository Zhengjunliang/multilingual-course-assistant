"""Environment-backed configuration.

Deliberately free of Django imports: `rag/` must stay runnable without Django,
so both sides can read their configuration from this one source.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    django_secret_key: str
    django_debug: bool = False
    django_allowed_hosts: str = "localhost,127.0.0.1"
    django_log_level: str = "INFO"

    # Generation endpoint: vLLM on the MICC server, reached through an SSH
    # tunnel, so the default points at the local tunnel mouth. vLLM ignores the
    # API key but the OpenAI client insists on one.
    vllm_base_url: str = "http://localhost:8000/v1"
    vllm_api_key: str = "unused"
    vllm_model: str = "Qwen/Qwen3-4B-Instruct-2507"

    @property
    def allowed_hosts(self) -> list[str]:
        """Comma-separated in .env; a bare `list[str]` field would demand JSON there."""
        return [host.strip() for host in self.django_allowed_hosts.split(",") if host.strip()]


# Pyright synthesises __init__ from the fields and so wants them passed in, but
# BaseSettings fills them from the environment; the call is correct as written.
env = Settings()  # pyright: ignore[reportCallIssue]
