"""Every guard, under the name its pre-commit hook runs it by."""

from __future__ import annotations

from typing import TYPE_CHECKING

from scripts.guards.language import LANGUAGE
from scripts.guards.repo import ENV_EXAMPLE_PARITY

if TYPE_CHECKING:
    from scripts.guards import Guard

GUARDS: dict[str, Guard] = {guard.name: guard for guard in (ENV_EXAMPLE_PARITY, LANGUAGE)}
# Every rule id, so that a marker naming one that does not exist is caught.
RULE_IDS = frozenset(rule.id for guard in GUARDS.values() for rule in guard.rules)
