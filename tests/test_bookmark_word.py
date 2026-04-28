import pytest
from devflow.api.dictionary import bookmark_word, get_user_bookmarks

def test_bookmark_word():
    # Given
    user_id = "user-456"
    word_id = "hello-id"

    # When
    bookmark_word(user_id, word_id)

    # Then
    bookmarks = get_user_bookmarks(user_id)
    assert word_id in bookmarks