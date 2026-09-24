"""Environment-backed configuration.

Deliberately free of Django imports: `rag/` must stay runnable without Django,
so both sides can read their configuration from this one source.
"""

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # SecretStr, not str: Django's debug page cleanses *settings* whose name
    # looks secret, but it prints every local variable of every traceback frame
    # verbatim. A `Settings` instance bound as a local — which is what
    # `from config.env import env` does inside a function — would therefore
    # render its whole repr, secret key and database password included, to
    # whoever triggered the error. SecretStr makes that repr `**********`.
    django_secret_key: SecretStr
    django_debug: bool = False
    django_allowed_hosts: str = "localhost,127.0.0.1"
    django_log_level: str = "INFO"

    # PostgreSQL, served by docker-compose.yml. The defaults match the compose
    # service so a fresh checkout only has to `docker compose up -d` before
    # migrating; the password has none on purpose — a working credential
    # committed to the repo is a working credential wherever the repo lands.
    django_db_name: str = "mca"
    django_db_user: str = "mca"
    django_db_password: SecretStr
    django_db_host: str = "localhost"
    django_db_port: int = 5432

    # HTTPS redirect, HSTS and secure cookies are meaningless — or actively
    # break the site — when nothing terminates TLS, and a demo on the MICC
    # intranet or on the defence machine may well have nothing. One flag gates
    # all of them rather than DEBUG, because "not debugging" and "behind TLS"
    # are different questions. The `deploy` step of scripts/check.py sets it,
    # so `check --deploy` verifies the configuration that would be deployed.
    django_behind_tls: bool = False

    # Generation endpoint: any OpenAI-compatible server. Dev default is local
    # Ollama (fully offline loop); M3 experiments point this at the MICC vLLM
    # tunnel by overriding `.env` — nothing else changes. Both servers ignore
    # the API key but the OpenAI client insists on one.
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: str = "unused"
    llm_model: str = "qwen3:4b-instruct-2507-q4_K_M"

    @property
    def allowed_hosts(self) -> list[str]:
        """Comma-separated in .env; a bare `list[str]` field would demand JSON there."""
        return [host.strip() for host in self.django_allowed_hosts.split(",") if host.strip()]


# Pyright synthesises __init__ from the fields and so wants them passed in, but
# BaseSettings fills them from the environment; the call is correct as written.
env = Settings()  # pyright: ignore[reportCallIssue]
