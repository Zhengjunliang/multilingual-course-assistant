"""Environment-backed configuration.

Deliberately free of Django imports: `rag/` must stay runnable without Django,
so both sides can read their configuration from this one source.
"""

from pydantic import SecretStr, field_validator
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

    # Qdrant, served by docker-compose.yml and shared by every process that
    # reads the index: the site and the rag CLIs. A server URL only: an
    # embedded index is opened by passing its directory to a CLI's --qdrant,
    # never from here, since the one process holding it locks out every other.
    # 127.0.0.1, not localhost: compose publishes the port on IPv4 loopback
    # only, localhost resolves to ::1 first, and qdrant-client opens a new
    # connection per request to a local host, so every request would first be
    # refused.
    qdrant_url: str = "http://127.0.0.1:6333"
    # The key of a Qdrant server started with QDRANT__SERVICE__API_KEY. The
    # compose service has none, listening on this host's loopback only; the one
    # on MICC has one, since every user of a shared server reaches its loopback
    # port. Unset or empty sends no key.
    qdrant_api_key: SecretStr | None = None

    # Redis, served by docker-compose.yml: Celery's broker and the site's own
    # data, in two databases of the one server. Two, because Django's
    # `cache.clear()` empties the whole database it is pointed at (FLUSHDB),
    # and in the broker's that would drop every queued task. The broker takes
    # database 0, Celery's own default; Celery also reads CELERY_BROKER_URL
    # from the environment by itself, so one name means one value. Plain
    # strings: the compose server has no password and listens on loopback only.
    # 127.0.0.1 for the reason QDRANT_URL gives.
    celery_broker_url: str = "redis://127.0.0.1:6379/0"
    redis_url: str = "redis://127.0.0.1:6379/1"

    # HTTPS redirect, HSTS and secure cookies are meaningless — or actively
    # break the site — when nothing terminates TLS, and a demo on the MICC
    # intranet or on the defence machine may well have nothing. One flag gates
    # all of them rather than DEBUG, because "not debugging" and "behind TLS"
    # are different questions. The `deploy` step of scripts/check.py sets it,
    # so `check --deploy` verifies the configuration that would be deployed.
    django_behind_tls: bool = False

    # Generation endpoint: any OpenAI-compatible server. Dev default is local
    # Ollama (fully offline loop); M3 experiments point this at the MICC vLLM
    # tunnel by overriding `.env` — nothing else changes. Ollama ignores the API
    # key, which the OpenAI client insists on; vLLM on MICC is started with one,
    # since every user of the server reaches its loopback port, so it is a
    # SecretStr like the keys above.
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: SecretStr = SecretStr("unused")
    llm_model: str = "qwen3:4b-instruct-2507-q4_K_M"

    # The password every demo- account gets from `manage.py populate_demo`
    # (apps/roles/management/commands/populate_demo.py), the way Django's
    # `createsuperuser --noinput` reads DJANGO_SUPERUSER_PASSWORD. None, the
    # default, leaves new demo accounts with no usable password: a password
    # written in the repository would open them wherever the repository lands.
    demo_password: SecretStr | None = None

    @field_validator("qdrant_url")
    @classmethod
    def _qdrant_is_a_server(cls, value: str) -> str:
        # The same test as rag.index.open_client, which this module cannot import.
        if not value.startswith(("http://", "https://")):
            raise ValueError(
                "QDRANT_URL takes the Qdrant server's http(s) URL; "
                "pass a directory to a CLI's --qdrant to open an embedded index"
            )
        return value

    @property
    def allowed_hosts(self) -> list[str]:
        """Comma-separated in .env; a bare `list[str]` field would demand JSON there."""
        return [host.strip() for host in self.django_allowed_hosts.split(",") if host.strip()]


# Pyright synthesises __init__ from the fields and so wants them passed in, but
# BaseSettings fills them from the environment; the call is correct as written.
env = Settings()  # pyright: ignore[reportCallIssue]
