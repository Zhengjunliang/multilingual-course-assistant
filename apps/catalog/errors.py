"""The codes a staff page reads a refusal by, which frontend/src/api/catalog.ts mirrors.

Every refusal of the staff endpoints carries a code (config/exceptions.py).
`StaffError` is this project's own, a closed set; the rest come from DRF,
which adds codes of its own and is not a closed set, so a page has words for
the few in `DRF_CODES_SHOWN` and one general sentence for any other.
tests/test_catalog_contract.py keeps the mirror's list equal to the two here.
"""

from enum import StrEnum


class StaffError(StrEnum):
    # A username that names no account.
    NO_SUCH_USER = "no_such_user"
    # A role the user holds on that scope already.
    ALREADY_HELD = "already_held"
    # A switch refused on the edition it would replace (apps/catalog/editions.py).
    SWITCH_NEEDS_BOTH = "switch_needs_both"


# A missing or empty username, a lost session, a refused permission, a scope
# outside the caller's reach.
DRF_CODES_SHOWN = frozenset(
    {"required", "blank", "not_authenticated", "permission_denied", "not_found"}
)
