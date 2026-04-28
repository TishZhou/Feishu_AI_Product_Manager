import pytest
from devflow.api.dictionary import search_dictionary


def test_search_dictionary_found():
    # Given
    word = "hello"
    language = "en"
    
    # When
    result = search_dictionary(word, language)

    # Then
    assert result["meaning"] == "A greeting or expression of goodwill"
    assert result["translation"] == {"es": "hola", "fr": "bonjour"}
    assert result["phonetic"] == "həˈloʊ"


def test_search_dictionary_not_found():
    # Given
    word = "unknownword"
    language = "en"
    
    # When
    result = search_dictionary(word, language)

    # Then
    assert "error" in result
    assert result["error"] == "Word not found in dictionary"
