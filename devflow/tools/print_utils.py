from typing import Any


def print1(value: Any) -> None:
    """Prints a single input value to standard output with a trailing newline.

    Args:
        value: Any Python type to be printed

    Raises:
        TypeError: If called with 0 or more than 1 positional arguments
    """
    # Leverage native Python print for optimized stdout handling and standard string conversion
    # No optional parameters added per scope requirements for custom separators/end characters
    print(value)
