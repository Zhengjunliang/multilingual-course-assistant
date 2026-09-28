"""Comments, docstrings, pytest names and markdown prose are written in English.

Two rules, promoted from the checker that moved the documents to English
(issue #43): lang-han flags Chinese characters and full-width punctuation, and
lang-italian flags the Italian function words no English sentence contains.
Only prose is read (scripts/guards/prose.py says where it is): string
literals are data, and the test queries and fixtures of a multilingual project
are Italian and Chinese on purpose. A citation inside prose is not checked.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from scripts.guards import Finding, Guard, Rule
from scripts.guards.prose import CITED, prose

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from scripts.guards import Files

HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff01-\uff60]")
# Words with no English homograph in use, measured on the repository's prose
# before each was added; `il` only in lower case or as `Il`, never as `IL`.
_ITALIAN_WORDS = (
    "della delle degli dei gli nella nel nei sul dal alla alle"  # spellchecker:disable-line
    " che sono questo questa questi quando anche essere quindi ogni viene deve cosa"
    " tutti senza invece mentre perche perché però"
)
ITALIAN = re.compile(rf"\b(?i:{'|'.join(_ITALIAN_WORDS.split())})\b|\b[Ii]l\b")


def _flag(rule: str, pattern: re.Pattern[str], what: str) -> Callable[[Files], Iterator[Finding]]:
    def check(files: Files) -> Iterator[Finding]:
        for path, line, text in prose(files):
            if found := pattern.search(CITED.sub(" ", text)):
                yield Finding(path, line, rule, f"{what} `{found.group()}` in prose")

    return check


# Examples shared by both rules: prose that must pass whatever its subject.
_DATA = {
    "rag/cli.py": 'QUERY = "quando sono gli appelli della sessione, 学费"  # an Italian query\n',
    "rag/doc.py": (
        'def ask():\n    """Answers "Quando scadono le tasse?" and `学费` in their language."""\n'
    ),
    "web/a.ts": r"const q = `che cosa sono ${x}`; const re = /\/\*[^/]*\*\//g; // English",
    "web/b.tsx": "<p>Che cos'è un ORM?</p>; // the question, as a student types it\n",
    "docs/a.md": "The page says `questo è della scuola`.\n\n```text\n学费 della\n```\n",
}

HAN_RULE = Rule(
    "lang-han",
    _flag("lang-han", HAN, "Chinese"),
    good=(
        _DATA,
        {"docs/b.md": "Tuition is quoted as “学费”.\n"},
        {"rag/a.py": "x = 1  # tuition, 学费  # guard-ignore lang-han: a glossary entry\n"},
    ),
    bad=(
        {"rag/a.py": "x = 1  # 学费的截止日期\n"},
        {"rag/a.py": 'def f():\n    """返回答案。"""\n'},
        {"tests/test_a.py": "def test_学费():\n    pass\n"},
        {"web/a.ts": "/* 学费 */\nconst x = 1;\n"},
        {"docs/a.md": "The deadline\uff0cin full-width punctuation.\n"},
    ),
)

ITALIAN_RULE = Rule(
    "lang-italian",
    _flag("lang-italian", ITALIAN, "Italian"),
    good=(
        _DATA,
        {"docs/b.md": "The *relatore* signs the *domanda di laurea* for *Il Sole*.\n"},
        {"rag/a.py": "x = 1  # tasse della scuola  # guard-ignore lang-italian: a UniFi label\n"},
        {
            "rag/b.py": "# see https://www.unifi.it/calendario-delle-lezioni\n"
            "IL = 2  # an IL opcode\n",
        },
        {"docs/c.md": "Kept aside:\n<!-- una nota\n    anche questa -->\nThe end.\n"},
        {"rag/c.py": 'def che(): """Return it."""\n'},
    ),
    bad=(
        {"rag/a.py": "x = 1  # questo valore è della sessione\n"},
        {"rag/a.py": "# calcola il punteggio finale\n"},
        {"rag/a.py": 'def f():\n    "Restituisce la risposta quando serve."\n'},
        {"docs/a.md": "Open a comment with `<!--`.\n\nIl servizio è della scuola.\n"},
        {"docs/a.md": "* Il servizio della *scuola*\n"},
        {"rag/a.py": "# TODO: gestire gli errori del parser\n"},
        {"web/a.ts": "const s = css`a { b: 1 }`;\n// ogni commento conta\n"},
        {"rag/a.py": 'def f():\n    """Restituisce la risposta quando serve."""\n'},
        {"tests/test_a.py": "def test_risposta_quando_manca_il_contesto():\n    pass\n"},
        {"web/a.ts": "// anche questo è un commento\nconst x = 1;\n"},
        {"web/b.mjs": "/*\n * Il controllo delle chiavi\n */\n"},
        {"docs/a.md": "Il servizio è della scuola.\n"},
    ),
)

LANGUAGE = Guard("language", (HAN_RULE, ITALIAN_RULE))
