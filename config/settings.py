"""Django settings — one module, driven by the environment.

The dev/prod split this file used to anticipate was dropped: one developer and
one deployment do not need two settings modules to keep in sync, and
`DJANGO_DEBUG` in .env already carries the distinction. The production security
headers at the bottom are therefore conditional rather than a separate file.
"""

from pathlib import Path

# Secrets and per-environment values come from .env — see .env.example.
from config.env import env

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Unwrapped here and only here: Django needs the string, and a settings name
# containing SECRET is one Django's own debug page cleanses.
SECRET_KEY = env.django_secret_key.get_secret_value()

DEBUG = env.django_debug

ALLOWED_HOSTS = env.allowed_hosts


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "apps.accounts",
    "apps.qa",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    # After the session (it may carry the user's language), before Common: without
    # this, USE_I18N and the LANGUAGES list below never affect a response.
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

# PostgreSQL rather than SQLite because the web milestone puts three writers on
# this database at once — the Django process, the Celery worker and whatever is
# running in a terminal — and SQLite's single-writer lock would serialise them.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env.django_db_name,
        "USER": env.django_db_user,
        # As with SECRET_KEY: unwrapped at the one place Django reads it, under
        # a key its debug page cleanses.
        "PASSWORD": env.django_db_password.get_secret_value(),
        "HOST": env.django_db_host,
        "PORT": env.django_db_port,
        # Without this every management command hangs indefinitely when the
        # database is down, instead of saying so: Docker Desktop's port proxy on
        # Windows keeps accepting connections on the published port while the
        # engine itself is stopped, and the connect never resolves.
        "OPTIONS": {"connect_timeout": 5},
    }
}

# Swapped from the first migration: see apps/accounts/models.py.
AUTH_USER_MODEL = "accounts.User"


# REST framework
# https://www.django-rest-framework.org/api-guide/settings/

# Throttling is not deferrable: one POST occupies the GPU for tens of seconds
# and answers are served one at a time (apps/qa/engine.py), so without a limit a
# burst becomes a queue that times out instead of an honest 429. The counters
# live in Django's default local-memory cache, which is exactly right for one
# process; Redis arrives with Celery.
#
# Both scopes, because `AnonRateThrottle` exempts anyone authenticated and there
# is already an account that qualifies — the admin superuser. A rate for a role
# nobody can reach would be dead configuration; a role that bypasses the limit
# entirely is a hole.
REST_FRAMEWORK = {
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {"anon": "10/min", "user": "30/min"},
    # Without this, DRF's default is to trust a client-supplied
    # X-Forwarded-For as the throttle identity, so
    # `curl -H "X-Forwarded-For: <anything>"` earns a fresh bucket on every
    # request and the limit above stops existing. Nothing proxies this service,
    # so the identity is REMOTE_ADDR and only REMOTE_ADDR.
    "NUM_PROXIES": 0,
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

# The domain is multilingual: course material is Italian, questions may arrive in
# another language. Every locale the system may serve is declared here rather than
# hardcoded at the call sites.
LANGUAGE_CODE = "it"

LANGUAGES = [
    ("it", "Italiano"),
    ("en", "English"),
    ("zh-hans", "简体中文"),
]

TIME_ZONE = "Europe/Rome"

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = "static/"

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Logging
# https://docs.djangoproject.com/en/5.2/topics/logging/

# Console-only on purpose: locally the console is where the developer looks, and in
# deployment (M6) stdout is what the process manager collects. Timestamps matter —
# ingest and evaluation runs last minutes to hours.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "timestamped": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "timestamped"},
    },
    "root": {"handlers": ["console"], "level": env.django_log_level},
}


# Security headers
# https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/

# `manage.py check --deploy --fail-level WARNING` runs in CI against DEBUG=false
# and DJANGO_BEHIND_TLS=true, so this block is what that gate verifies. Django's
# own defaults already cover X_FRAME_OPTIONS, SECURE_CONTENT_TYPE_NOSNIFF and
# SECURE_REFERRER_POLICY; restating them here would be a second copy to drift.
if not DEBUG and env.django_behind_tls:
    SECURE_SSL_REDIRECT = True
    # One year, the value the preload lists require. Subdomains and preload
    # travel with it: HSTS without them protects only the exact host that was
    # already reached over HTTPS once.
    SECURE_HSTS_SECONDS = 31_536_000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
