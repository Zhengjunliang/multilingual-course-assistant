"""Every guard, under the name its pre-commit hook runs it by."""

from __future__ import annotations

from typing import TYPE_CHECKING

from scripts.guards.repo import ENV_EXAMPLE_PARITY

if TYPE_CHECKING:
    from scripts.guards import Guard

GUARDS: dict[str, Guard] = {guard.name: guard for guard in (ENV_EXAMPLE_PARITY,)}
