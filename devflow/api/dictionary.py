from __future__ import annotations

from collections import defaultdict


_DICTIONARY = {
    "en": {
        "hello": {
            "id": "hello-id",
            "meaning": "A greeting or expression of goodwill",
            "translation": {"es": "hola", "fr": "bonjour"},
            "phonetic": "həˈloʊ",
        }
    }
}

_BOOKMARKS: defaultdict[str, set[str]] = defaultdict(set)


def search_dictionary(word: str, language: str = "en") -> dict:
    entry = _DICTIONARY.get(language, {}).get(word.lower())
    if not entry:
        return {"error": "Word not found in dictionary"}
    return dict(entry)


def bookmark_word(user_id: str, word_id: str) -> None:
    _BOOKMARKS[user_id].add(word_id)


def get_user_bookmarks(user_id: str) -> list[str]:
    return sorted(_BOOKMARKS[user_id])
