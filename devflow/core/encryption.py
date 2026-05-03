import base64
import os
from typing import Tuple
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

from devflow.config import get_config


def encrypt(plaintext: str, secret_key: str) -> Tuple[str, str]:
    """Encrypts plaintext string with AES-256-GCM, returns (ciphertext, initialization vector)"""
    # Convert secret key to 32 bytes for AES-256
    key = secret_key.encode()[:32]
    if len(key) < 32:
        key = key.ljust(32, b"\x00")

    # Generate 12-byte IV for GCM
    iv = os.urandom(12)
    cipher = Cipher(algorithms.AES(key), modes.GCM(iv), backend=default_backend())
    encryptor = cipher.encryptor()

    ciphertext = encryptor.update(plaintext.encode()) + encryptor.finalize()

    # Encode ciphertext and IV as base64 strings for easy storage
    return (
        base64.b64encode(ciphertext + encryptor.tag).decode(),
        base64.b64encode(iv).decode()
    )


def decrypt(ciphertext: str, iv: str, secret_key: str) -> str:
    """Decrypts AES-256-GCM encrypted ciphertext using provided IV and secret key"""
    key = secret_key.encode()[:32]
    if len(key) < 32:
        key = key.ljust(32, b"\x00")

    iv_bytes = base64.b64decode(iv)
    ciphertext_data = base64.b64decode(ciphertext)
    tag = ciphertext_data[-16:]
    ciphertext_bytes = ciphertext_data[:-16]

    cipher = Cipher(algorithms.AES(key), modes.GCM(iv_bytes, tag), backend=default_backend())
    decryptor = cipher.decryptor()
    plaintext = decryptor.update(ciphertext_bytes) + decryptor.finalize()
    return plaintext.decode()
