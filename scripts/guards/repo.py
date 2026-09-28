"""Rules about the repository's own configuration files."""

from __future__ import annotations

import ast
import re
from typing import TYPE_CHECKING

from scripts.guards import Finding, Guard, Rule

if TYPE_CHECKING:
    from collections.abc import Iterator

    from scripts.guards import Files

SETTINGS = "config/env.py"
EXAMPLE = ".env.example"
# Keys of SettingsConfigDict that change which variable every field reads,
# besides env_prefix, which is applied. With any of them set, prefix plus field
# name in upper case would be a guess, and the rule says so instead.
REMAPPING = frozenset({"alias_generator", "case_sensitive", "env_nested_delimiter"})
FIELD_ALIASES = frozenset({"alias", "validation_alias"})
EXAMPLE_KEY = re.compile(r"(?P<key>[A-Za-z_][A-Za-z0-9_]*)=")


def _name(node: ast.stmt) -> str | None:
    target = node.target if isinstance(node, ast.AnnAssign) else None
    if isinstance(node, ast.Assign) and len(node.targets) == 1:
        target = node.targets[0]
    return target.id if isinstance(target, ast.Name) else None


def _is_class_var(annotation: ast.expr) -> bool:
    base = annotation.value if isinstance(annotation, ast.Subscript) else annotation
    return (isinstance(base, ast.Name) and base.id == "ClassVar") or (
        isinstance(base, ast.Attribute) and base.attr == "ClassVar"
    )


def _has_alias(node: ast.AST) -> bool:
    """A Field(alias=...) anywhere in the field, its Annotated[...] included."""
    return any(
        isinstance(call, ast.Call) and any(k.arg in FIELD_ALIASES for k in call.keywords)
        for call in ast.walk(node)
    )


def _config(node: ast.stmt) -> tuple[str, list[tuple[int, str]]]:
    """The env_prefix of `model_config`, and what makes the mapping unreadable."""
    call = getattr(node, "value", None)
    if not isinstance(call, ast.Call):
        return "", [(node.lineno, "a `model_config` that is not a SettingsConfigDict(...) call")]
    prefix, unreadable = "", []
    for keyword in call.keywords:
        value = keyword.value
        if keyword.arg == "env_prefix" and isinstance(value, ast.Constant):
            prefix = str(value.value)
        elif keyword.arg is None or keyword.arg == "env_prefix" or keyword.arg in REMAPPING:
            unreadable.append((node.lineno, f"`{keyword.arg or '**'}` in model_config"))
    return prefix, unreadable


def _settings(text: str) -> tuple[dict[str, int], list[tuple[int, str]], list[tuple[int, str]]]:
    """The variables `Settings` reads, with their lines; what hides the whole mapping;
    and the fields left out of it because an alias renames them."""
    tree = ast.parse(text)
    cls = next((n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Settings"), None)
    if cls is None:
        return {}, [(1, "no `Settings` class")], []
    if [ast.unparse(base) for base in cls.bases] != ["BaseSettings"]:
        # Fields inherited from anything else would go unseen.
        return {}, [(cls.lineno, "a `Settings` that does not derive from BaseSettings alone")], []
    prefix = ""
    fields: dict[str, int] = {}
    unreadable: list[tuple[int, str]] = []
    aliased: list[tuple[int, str]] = []
    for node in cls.body:
        name = _name(node)
        if isinstance(node, ast.FunctionDef) and node.name == "settings_customise_sources":
            unreadable.append((node.lineno, "a `settings_customise_sources` override"))
        elif name == "model_config":
            prefix, found = _config(node)
            unreadable += found
        elif (
            isinstance(node, ast.AnnAssign)
            and name is not None
            and not name.startswith("_")
            and not _is_class_var(node.annotation)
        ):
            if _has_alias(node):
                aliased.append((node.lineno, f"an alias on `{name}`"))
            else:
                fields[name] = node.lineno
    variables = {(prefix + name).upper(): line for name, line in fields.items()}
    return variables, unreadable, aliased


def _env_parity(files: Files) -> Iterator[Finding]:
    variables, unreadable, aliased = _settings(files[SETTINGS])
    for line, what in unreadable + aliased:
        yield Finding(
            SETTINGS,
            line,
            "env-parity",
            f"{what} changes which variable is read, and this rule cannot tell which",
        )
    if unreadable:
        return
    example: dict[str, int] = {}
    for number, line in enumerate(files[EXAMPLE].splitlines(), 1):
        if key := EXAMPLE_KEY.match(line):
            example[key["key"]] = number
    for key, line in variables.items():
        if key not in example:
            yield Finding(SETTINGS, line, "env-parity", f"{key} has no line in {EXAMPLE}")
    for key, line in example.items():
        if key not in variables:
            yield Finding(EXAMPLE, line, "env-parity", f"{key} is not read by {SETTINGS}")


_SETTINGS = """\
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    django_debug: bool = False
    llm_model: str = "qwen3"
    _cache: dict = {}
    registry: ClassVar[dict] = {}

    @property
    def debug(self) -> bool:
        return self.django_debug
"""
_EXAMPLE = """\
# Copy to .env and fill in.
DJANGO_DEBUG=true
LLM_MODEL=qwen3
# LLM_MODEL=Qwen/Qwen3-8B
"""
_PREFIXED = """\
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MCA_")
    debug: bool = False
"""


def _pair(settings: str = _SETTINGS, example: str = _EXAMPLE) -> dict[str, str]:
    return {SETTINGS: settings, EXAMPLE: example}


ENV_PARITY = Rule(
    "env-parity",
    _env_parity,
    good=(
        _pair(),
        _pair(_PREFIXED, "MCA_DEBUG=true\n"),
        _pair(example=_EXAMPLE + "# guard-ignore env-parity: read by compose only\nPGDATA=/x\n"),
    ),
    bad=(
        _pair(example=_EXAMPLE + "EXTRA=1\n"),
        _pair(_SETTINGS + "    new_field: int = 1\n"),
        _pair(_PREFIXED, "DEBUG=true\n"),
        _pair(_SETTINGS.replace('extra="ignore"', "alias_generator=str.upper")),
        _pair(_SETTINGS.replace('extra="ignore"', "**shared")),
        _pair(_PREFIXED.replace('"MCA_"', "PREFIX")),
        _pair(_SETTINGS.replace('SettingsConfigDict(env_file=".env", extra="ignore")', "{}")),
        _pair(_SETTINGS.replace("(BaseSettings)", "(Common)")),
        _pair("DEBUG = True\n"),
        _pair(_SETTINGS + "\n    @classmethod\n    def settings_customise_sources(cls): ...\n"),
        _pair(_SETTINGS.replace("bool = False", 'Annotated[bool, Field(alias="DEBUG")] = False')),
    ),
)

ENV_EXAMPLE_PARITY = Guard("env-example-parity", (ENV_PARITY,), paths=(SETTINGS, EXAMPLE))
