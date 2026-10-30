"""Django settings — one module, driven by the environment.

The dev/prod split this file used to anticipate was dropped: one developer and
one deployment do not need two settings modules to keep in sync, and
`DJANGO_DEBUG` in .env already carries the distinction. The production security
headers at the bottom are therefore conditional rather than a separate file.
"""

from pathlib import Path

from celery.schedules import crontab

# Secrets and per-environment values come from .env — see .env.example.
from config.env import env

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# What the frontend build writes. Two things read it — the static finders below and
# config/views.py, which serves the SPA's shell — so it is named once here.
#
# It is a build artefact and not in git, which is why the frontend build runs
# ahead of every Django step in scripts/check.py: `staticfiles.W004`
# reports a STATICFILES_DIRS entry that does not exist, and `check --deploy
# --fail-level WARNING` turns that report into a failure.
SPA_DIST = BASE_DIR / "frontend" / "dist"

# Unwrapped here and only here: Django needs the string, and a settings name
# containing SECRET is one Django's own debug page cleanses.
SECRET_KEY = env.django_secret_key.get_secret_value()

DEBUG = env.django_debug

ALLOWED_HOSTS = env.allowed_hosts


# Application definition

INSTALLED_APPS = [
    "config.apps.AdminConfig",  # django.contrib.admin, with the superuser-only site
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "apps.accounts",
    "apps.qa",
    "apps.catalog",
    "apps.roles",
    "apps.materials",
]

# One entry that must never be added here: `GZipMiddleware`. It compresses a
# response as a whole, which means holding a streaming one until it ends —
# `/api/ask` would then deliver its answer as a single block at the finish, the
# exact behaviour the event stream exists to remove (apps/qa/views.py).
MIDDLEWARE = [
    # First, so that what every middleware below logs carries the request's id.
    "config.request_id.RequestIdMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    # After the session (it may carry the user's language), before Common: without
    # this, USE_I18N and the LANGUAGES list below never affect a response.
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # After authentication, whose user it reads; it may sign that user out.
    "apps.accounts.middleware.SessionLifetimeMiddleware",
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

# Django's database store, saving into a table that names each session's
# account: see apps/accounts/sessions.py. `django.contrib.sessions` stays
# installed for `clearsessions`, which purges through this setting.
SESSION_ENGINE = "apps.accounts.sessions"

# How long a signed-in session lives, by tier: (idle, absolute) in seconds,
# enforced by apps/accounts/middleware.py. NIST SP 800-63B-4 sets the limits
# by assurance level (outside the repository): at AAL1 an overall limit of at
# most 30 days and no idle limit required (§2.1.3); at AAL2 24 hours overall
# and 1 hour idle (§2.2.3). Students ask questions and keep their
# conversations, an AAL1 risk, and stay signed in across a week of lectures.
# Staff, the superusers and whoever holds a role, change other people's
# courses and roles, and are held to AAL2's limits though they sign in with a
# password alone (no second factor: docs/security.md). ASVS 7.1.1 asks for this
# reasoning; 7.1.2: an account may hold any number of sessions at once, each
# listed and ended by its owner (apps/accounts/self_views.py).
SESSION_LIFETIMES = {
    "student": (7 * 24 * 3600, 14 * 24 * 3600),
    "staff": (3600, 24 * 3600),
}
# The cookie's own lifetime, the longest a session can live: the server ends
# one sooner by its tier's limits.
SESSION_COOKIE_AGE = 14 * 24 * 3600

# ModelBackend first. A login records the backend that authenticated the user,
# but the test client's force_login() takes the first backend that has a
# get_user(), and RoleBackend's loads nobody: it authenticates no one and
# answers scoped permissions from role rows alone (apps/roles/backends.py).
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "apps.roles.backends.RoleBackend",
]


# Cache
# https://docs.djangoproject.com/en/5.2/topics/cache/#redis

# The site's own data in Redis: the cache below, and the answers in flight
# (apps/qa/inflight.py). Database 1, never the broker's 0: config/env.py says why.
REDIS_URL = env.redis_url

# What lives here is the throttle counters below, and they must be shared: in
# each process's own memory, Django's default, every process of a deployed site
# would grant its own four questions a minute.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        # As the database's connect_timeout: without them every throttled
        # request hangs on a stopped Docker engine instead of failing.
        "OPTIONS": {"socket_connect_timeout": 5, "socket_timeout": 5},
    }
}


# REST framework
# https://www.django-rest-framework.org/api-guide/settings/

# An endpoint answers only to a logged-in caller unless its view says otherwise,
# and every view that does is listed with its reason in
# tests/test_route_permissions.py. Not for secrecy, mostly: what most endpoints
# serve is per-student state, and a conversation belongs to somebody. The one
# that answers an anonymous caller, `POST /api/ask`, stores nothing for them
# rather than inventing a temporary identity to file it under, which would be a
# second, weaker account system standing next to this one.
#
# Throttling is not deferrable either: one POST occupies a worker for tens of
# seconds (apps/qa/tasks.py), so without a limit one caller's burst fills the
# global cap below and everyone else is refused. The counters live in the
# cache above.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # DRF's session authentication, with a failed CSRF check refused by its own code.
        "apps.accounts.authentication.CodedSessionAuthentication",
        # Basic only while developing, which is the point of the condition:
        # authentication runs before throttling (`APIView.initial`), so a wrong
        # password is refused without ever reaching a rate limit. Deployed, that
        # is an unmetered password-guessing budget on every endpoint. It stays
        # in development because docs/api.md's curl recipe for the stream needs a
        # credential that is not a cookie.
        *(["rest_framework.authentication.BasicAuthentication"] if DEBUG else []),
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    # One scoped class instead of the anon/user pair: a single `user` rate
    # cannot say both "four questions a minute" and "five login attempts a
    # minute" at once. The scoped class bills an anonymous caller by address,
    # at the rate of its scope; docs/security.md says why anonymous questions
    # get no lower one.
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    # ask: an answer takes tens of seconds, so one reader asks a few a minute
    # at most. Four is the global cap's default (QA_MAX_IN_FLIGHT): one caller
    # can fill the cap of a single development worker, and no more than that.
    #
    # auth: logging in, registering and the link endpoints are one abuse
    # surface, so they share a bucket, billed by address whoever is signed in
    # (`AddressRateThrottle`, apps/accounts/views.py), which is the setting
    # below finally carrying weight. A view that asks a signed-in caller's
    # password again is billed by account at the same rate.
    "DEFAULT_THROTTLE_RATES": {"ask": "4/min", "auth": "5/min"},
    # Without this, DRF's default is to trust a client-supplied
    # X-Forwarded-For as the throttle identity, so
    # `curl -H "X-Forwarded-For: <anything>"` earns a fresh bucket on every
    # request and the limit above stops existing. Nothing proxies this service,
    # so the identity is REMOTE_ADDR and only REMOTE_ADDR.
    "NUM_PROXIES": 0,
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    # One coded body for every error (#186), whose status is the code's.
    "EXCEPTION_HANDLER": "config.errors.api_exception_handler",
}

# Every rate above is per caller, and per-caller limits say nothing about the
# machine: five accounts at four questions a minute is twenty arriving at
# workers that answer a few. The capacity control is the global cap,
# `QA_MAX_IN_FLIGHT` below, counted in Redis across every web process
# (apps/qa/inflight.py); the rates only stop one caller from being all of it.


# Question answering

# The callable that builds the engine's index, encoders and reranker
# (apps/qa/engine.py), named by dotted path as EMAIL_BACKEND names Django's
# mail backend. The browser journeys point it at stubs (tests/journeys/), so
# the code they run has no test branch in it.
QA_RETRIEVAL = "apps.qa.engine.build_retrieval"

# Every key of an answer in flight starts with this (apps/qa/inflight.py). The
# browser journeys count under a prefix of their own, as their cache does.
QA_KEY_PREFIX = "qa"

# The questions waiting or being answered at once, every process of the site
# together (apps/qa/inflight.py); past it a question is refused at once.
# config/env.py says why the default is 4.
QA_MAX_IN_FLIGHT = env.qa_max_in_flight


# Course material

# Where an uploaded PDF is kept, named by its digest (apps/materials/models.py).
# Not MEDIA_ROOT, and no MEDIA_URL: a file leaves only through
# /api/sources/<sha256> (apps/qa/sources.py), never as a URL of its own. Under
# data/, which git ignores, as everything derived from course material is.
MATERIALS_ROOT = BASE_DIR / "data" / "materials"

# The callable that builds what an ingest runs on (apps/materials/ingest.py),
# named by dotted path as QA_RETRIEVAL is, for the same reason: the browser
# journeys point it at stubs.
MATERIALS_PIPELINE = "apps.materials.ingest.build_pipeline"


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

# Length and a blocklist, and no rule on what a password is made of: NIST SP
# 800-63B-4 §3.1.1.2 and ASVS 6.2.5 forbid composition rules, which is why
# Django's NumericPasswordValidator is not here. 15 characters because a
# password is the only factor here (NIST: "SHALL ... a minimum of 15" for a
# single-factor password; ASVS 6.2.1 recommends 15). 128 at most: ASVS 6.2.9
# asks that 64 be allowed, and a bound keeps the cost of hashing what a caller
# sends under control; LibreChat stops at 128 too (outside the repository). The
# breached-password check (ASVS 6.2.12) sends Pwned Passwords the first five
# characters of the password's SHA-1, never the password, and falls back to
# Django's common-password list when that service cannot be reached; the
# common list stays as well, since it costs no request.
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 15},
    },
    {
        "NAME": "apps.accounts.validators.MaximumLengthValidator",
        "OPTIONS": {"max_length": 128},
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "pwned_passwords_django.validators.PwnedPasswordsValidator",
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


# Background tasks
# https://docs.celeryq.dev/en/stable/userguide/configuration.html

# Celery reads every setting below that starts with CELERY_ (config/celery.py).
# Not restated: JSON as the only serialisation, Celery's default since 4.0.
# Pickle would let whoever can write to the broker run code in the worker.
CELERY_BROKER_URL = env.celery_broker_url

# Queues are named by the work they hold: a worker starts with `-Q default`,
# and a long kind of work gets a queue and a worker of its own, so it never
# waits behind another. Celery's default name, `celery`, names no work.
CELERY_TASK_DEFAULT_QUEUE = "default"

# Celery's own advice for long tasks (the Optimizing guide): acknowledged
# once done, so a task whose worker goes down with it (the machine, or the
# worker's main process) is delivered again once the visibility timeout below
# passes, and fetched one at a time, so a worker never holds a second task
# while a free one waits. Each task must therefore survive running twice; the
# one task that must not run twice is acknowledged early (apps/qa/tasks.py). A
# pool process killed under a task is acknowledged all the same: requeuing
# it is task_reject_on_worker_lost, left off, since a task that kills its
# process would then run again and again.
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1

# The soft limit raises inside the task, which can still clean up; the hard
# one kills it. The longest task here takes seconds, and one that needs more
# says so in its decorator. Both stay far under the broker's visibility
# timeout, an hour on Redis: an unacknowledged task past it goes to a second
# worker while the first still runs it. Only the prefork pool enforces them
# (Celery's Workers guide); the solo pool of a Windows worker and the threads
# pool ignore them.
CELERY_TASK_SOFT_TIME_LIMIT = 5 * 60
CELERY_TASK_TIME_LIMIT = 6 * 60

# A schedule's hours are Rome's, not UTC, Celery's default.
CELERY_TIMEZONE = TIME_ZONE

# A worker logs through LOGGING below, so that a task's lines carry the id of
# the request that queued it (apps/qa/tasks.py). Left on, Celery would replace
# the root logger's handlers with its own, whose format has no such field.
CELERY_WORKER_HIJACK_ROOT_LOGGER = False

# Beat's schedule, in code rather than a database (no django-celery-beat):
# what runs and when changes with a commit, never from the admin. One beat
# runs at a time; two would send every task twice.
CELERY_BEAT_SCHEDULE = {
    # Django keeps expired sessions until something deletes them.
    "clear-expired-sessions": {
        "task": "apps.accounts.tasks.clear_expired_sessions",
        "schedule": crontab(hour=4, minute=0),
    },
    # A material whose worker died under it is marked failed (apps/materials/tasks.py).
    "fail-stalled-materials": {
        "task": "apps.materials.tasks.fail_stalled",
        "schedule": crontab(minute="*/10"),
    },
}
# No result backend is configured, so a task's return value is never stored.
# Left at its one-day default, this would make beat add Celery's own nightly
# `celery.backend_cleanup` to the schedule above, a task with nothing to clean.
CELERY_RESULT_EXPIRES = None


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

# Matches `base: "/static/"` in frontend/vite.config.ts: the built index.html
# asks for its bundle at /static/assets/<name>-<hash>.js, so this prefix and
# that one are the same decision written in two places.
STATIC_URL = "static/"

# The SPA's bundle, served next to Django's own admin assets.
STATICFILES_DIRS = [SPA_DIST]

# Deliberately absent: STATIC_ROOT, STORAGES and a `collectstatic` recipe.
# `runserver` serves the directories above while DEBUG is on, which is every
# way this project is run today. With DEBUG off Django refuses to serve static
# files at all — by design; it expects something in front of it — so the
# deployed form needs whitenoise or nginx. That is its own work item — "static
# files with DEBUG=False", #40, a prerequisite
# of the M6 containerisation — not here: a dependency installed before anything
# runs it is one nobody can check.

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Logging
# https://docs.djangoproject.com/en/5.2/topics/logging/

# Console-only on purpose: locally the console is where the developer looks, and in
# deployment (M6) stdout is what the process manager collects. Timestamps matter —
# ingest and evaluation runs last minutes to hours. The bracketed field is the
# request's id (config/request_id.py), `-` outside a request: the id a page shows
# beside an unexpected error finds that request's lines.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_id": {"()": "config.request_id.RequestIdFilter"},
    },
    "formatters": {
        "timestamped": {
            "format": "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "timestamped",
            "filters": ["request_id"],
        },
    },
    "root": {"handlers": ["console"], "level": env.django_log_level},
    # Django's own default config gives `django` a console handler of its own,
    # printing the bare message while DEBUG is on, and `dictConfig` leaves a
    # handler on any logger it is not told about: each `django.*` line would
    # print twice, once without the request's id. Named here, it has none and
    # writes through the root's.
    "loggers": {"django": {"handlers": []}},
}


# Security headers
# https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/

# The `deploy` step of scripts/check.py runs `manage.py check --deploy
# --fail-level WARNING` against DEBUG=false and DJANGO_BEHIND_TLS=true, so
# this block is what that gate verifies. Django's
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
    # `__Host-`: a browser takes the cookie only when it is Secure, on Path=/
    # and names no Domain, so no other host of the same site can plant or
    # overwrite it (RFC 10017 §6.1.3.2, outside the repository). `check
    # --deploy` sees none of that; tests/test_accounts_api.py does. Not the
    # stricter `__Host-Http-` the RFC gives as its example: Django deletes a
    # cookie without HttpOnly, a browser that knows that prefix ignores such a
    # deletion, and signing out would leave the cookie behind. SameSite stays
    # Django's Lax rather than the RFC's preferred Strict: Lax already keeps the
    # cookies off cross-site writes, which the CSRF token refuses besides, and
    # Strict would only drop them from a link followed here from another site,
    # where `/admin/` would show its login form to a superuser signed in.
    SESSION_COOKIE_NAME = "__Host-sessionid"
    CSRF_COOKIE_NAME = "__Host-csrftoken"
