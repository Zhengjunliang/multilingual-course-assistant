"""Course material: a PDF put on a course edition, and how far its ingest has got.

A material is its bytes on its edition. The pair (`edition`, `sha256`) is the
key: the same bytes uploaded twice to one edition are one material, refused the
second time, and uploaded to two editions are two rows and two sets of points,
since every slides point carries its edition (docs/data-model.md, chunk payload
mapping), over one file on disk. That pair is also how the points of one
material are found in Qdrant, through the `source_sha256`, `course` and
`academic_year` they already carry, so the payload needs no field of its own.

`source_file` is the name the uploaded file had. It is what a citation card
shows and what the gold set scores by (rag/gold.py), and it is not a key: a
file of the same name and other bytes is the next version of that material. It
gets a row of its own, the older row keeps answering until the newer one is
ready, and then goes, points and all (apps/materials/ingest.py); so two rows of
one edition may share a name for as long as that takes.

`status` and `failure` are facts about the ingest, written by the worker
alone. A failure is one of a closed set of codes; what raised it goes to the
log, never to the caller, who would otherwise read paths of the server
(docs/api.md, section "Errors"). There is no `locale`: a file's language is
recorded per chunk (docs/data-model.md).
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models
from django.utils.functional import cached_property
from django.utils.translation import gettext_lazy as _

from apps.catalog.models import CourseEdition


class MaterialStorage(FileSystemStorage):
    """The directory `MATERIALS_ROOT` names, where a file is overwritten by one of its name.

    A file is named by its digest (`material_name`), so a second write under a
    name is the same bytes again, and overwriting it is how two editions share
    one file. The directory is read from the settings when first needed, not
    passed in: a path given here would be written into the migration, and a
    test points the setting elsewhere.
    """

    def __init__(self) -> None:
        super().__init__(allow_overwrite=True)

    @cached_property
    def base_location(self) -> Any:
        return settings.MATERIALS_ROOT

    def _clear_cached_properties(self, setting: str, **kwargs: Any) -> None:
        if setting == "MATERIALS_ROOT":
            self.__dict__.pop("base_location", None)
            self.__dict__.pop("location", None)
        else:
            # `setting_changed` sends every setting's name; the stubs list the four Django reads.
            super()._clear_cached_properties(setting, **kwargs)  # pyright: ignore[reportArgumentType]


def material_name(instance: CourseMaterial, filename: str) -> str:
    """`<sha256>.pdf`, whatever the uploaded file was called; its name is `source_file`."""
    return f"{instance.sha256}.pdf"


class MaterialStatus(models.TextChoices):
    """How far the ingest of a material has got, its steps in the order they run."""

    QUEUED = "queued", _("queued")
    PARSING = "parsing", _("parsing")
    CHUNKING = "chunking", _("chunking")
    INDEXING = "indexing", _("indexing")
    READY = "ready", _("ready")
    FAILED = "failed", _("failed")


class MaterialFailure(models.TextChoices):
    """Why an ingest failed, as the caller is told it."""

    UNREADABLE = "unreadable", _("the file could not be read")
    INCOMPLETE = "incomplete", _("the file was read only in part")
    INTERRUPTED = "interrupted", _("the ingest stopped before it finished")
    INTERNAL = "internal", _("an error on the server")


class CourseMaterial(models.Model):
    """A PDF on an edition, its file, and the state of its ingest."""

    # PROTECT, as `CourseEdition.course`: the material's points live in Qdrant,
    # where a cascading delete in PostgreSQL cannot reach them.
    edition = models.ForeignKey(
        CourseEdition,
        on_delete=models.PROTECT,
        related_name="materials",
        verbose_name=_("course edition"),
    )
    # An account may delete itself; a material imported from the command line has nobody.
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name=_("uploaded by"),
    )
    file = models.FileField(storage=MaterialStorage(), upload_to=material_name)
    sha256 = models.CharField(max_length=64, verbose_name=_("SHA-256"))
    source_file = models.CharField(
        max_length=255,
        verbose_name=_("file name"),
        help_text=_("The name the uploaded file had, which a citation shows."),
    )
    status = models.CharField(
        max_length=16,
        choices=MaterialStatus.choices,
        default=MaterialStatus.QUEUED,
        verbose_name=_("status"),
    )
    # Empty, never NULL, unless the ingest failed, as `CourseEdition.period` is when unknown.
    failure = models.CharField(
        max_length=16,
        choices=MaterialFailure.choices,
        blank=True,
        default="",
        verbose_name=_("failure"),
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("uploaded at"))
    started_at = models.DateTimeField(null=True, blank=True, verbose_name=_("started at"))
    finished_at = models.DateTimeField(null=True, blank=True, verbose_name=_("finished at"))

    class Meta:
        ordering = ("-created_at", "-pk")
        verbose_name = _("course material")
        verbose_name_plural = _("course materials")
        constraints = (
            models.UniqueConstraint(
                fields=("edition", "sha256"),
                name="materials_material_unique_bytes",
            ),
            models.CheckConstraint(
                condition=models.Q(sha256__regex=r"^[0-9a-f]{64}$"),
                name="materials_material_sha256_format",
            ),
            models.CheckConstraint(
                condition=~models.Q(source_file=""),
                name="materials_material_source_file_not_empty",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=MaterialStatus.values),
                name="materials_material_status_known",
            ),
            # A failed ingest says why, and nothing else carries a reason.
            models.CheckConstraint(
                condition=(
                    models.Q(status=MaterialStatus.FAILED, failure__in=MaterialFailure.values)
                    | (~models.Q(status=MaterialStatus.FAILED) & models.Q(failure=""))
                ),
                name="materials_material_failure_iff_failed",
            ),
        )

    def __str__(self) -> str:
        edition = getattr(self, "edition", None)
        return f"{edition or '?'} {self.source_file}"
