"""The admin app, with `SuperuserAdminSite` (config/admin.py) as its default site.

Django's documented way to replace the default admin site: this config takes
the place of `django.contrib.admin` in `INSTALLED_APPS`, so `admin.site`,
`@admin.register` and `admin.site.urls` all reach the replacement. Its `name`
is inherited, which keeps the app installed under `django.contrib.admin`.
"""

from django.contrib.admin.apps import AdminConfig as DjangoAdminConfig


class AdminConfig(DjangoAdminConfig):
    default_site = "config.admin.SuperuserAdminSite"
