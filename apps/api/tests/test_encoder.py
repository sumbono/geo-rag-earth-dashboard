"""Encoder tests.

FakeEncoder tests run in the default suite (no ML deps — torch must never be
imported by them). RemoteCLIPEncoder tests are `ml`-marked and skip unless
`ML_TESTS=1` AND requirements-ml.txt is installed, so the default suite stays
green with zero warnings in torch-free environments.
"""
import importlib.util
import os

import numpy as np
import pytest


def test_fake_encoder_deterministic_unit_vector():
    from app.encoder import FakeEncoder
    e = FakeEncoder()
    a, b = e.encode_text("coral reef"), e.encode_text("coral reef")
    assert a.shape == (512,) and a.dtype == np.float32
    assert np.allclose(a, b)
    assert abs(np.linalg.norm(a) - 1.0) < 1e-5


def test_fake_encoder_image_deterministic_unit_vector():
    from app.encoder import FakeEncoder
    e = FakeEncoder()
    arr = np.zeros((8, 8, 3), dtype=np.float32)
    arr[..., 0] = 0.25
    a, b = e.encode_image(arr), e.encode_image(arr)
    assert a.shape == (512,) and a.dtype == np.float32
    assert np.allclose(a, b)
    assert abs(np.linalg.norm(a) - 1.0) < 1e-5
    other = arr.copy()
    other[..., 1] = 0.75
    assert not np.allclose(a, e.encode_image(other))  # seeded from content, not a constant


def test_get_encoder_returns_fake_for_fake_setting():
    from app.config import Settings
    from app.encoder import FakeEncoder, get_encoder
    assert isinstance(get_encoder(Settings(encoder="fake")), FakeEncoder)


def test_get_encoder_rejects_unknown_encoder():
    from app.config import Settings
    from app.encoder import get_encoder
    with pytest.raises(ValueError, match="unknown encoder"):
        get_encoder(Settings(encoder="dalle"))


def _ml_ready() -> bool:
    """ML tests need the explicit opt-in AND the ML deps installed — either
    alone is not enough (default suite must run torch-free even when the ML
    deps happen to be present)."""
    if os.environ.get("ML_TESTS") != "1":
        return False
    return all(
        importlib.util.find_spec(m) is not None
        for m in ("torch", "open_clip", "huggingface_hub")
    )


requires_ml = pytest.mark.skipif(
    not _ml_ready(), reason="ML tests: set ML_TESTS=1 with requirements-ml.txt installed"
)


@pytest.fixture(scope="module")
def remoteclip():
    from app.encoder import RemoteCLIPEncoder
    return RemoteCLIPEncoder()


@requires_ml
@pytest.mark.ml
def test_remoteclip_output_shape():
    from app.encoder import RemoteCLIPEncoder
    e = RemoteCLIPEncoder()
    v = e.encode_text("coastal water")
    assert v.shape == (512,)


@requires_ml
@pytest.mark.ml
def test_remoteclip_image_rgb_only_contract(remoteclip):
    """Band contract (Option B): only the 3-channel RGB view may enter the
    model — NIR/4-band arrays are rejected, never silently squeezed."""
    rgb = np.zeros((32, 32, 3), dtype=np.float32)
    rgb[..., 0] = 0.8
    v = remoteclip.encode_image(rgb)
    assert v.shape == (512,) and v.dtype == np.float32
    nir_4band = np.zeros((32, 32, 4), dtype=np.float32)
    with pytest.raises(ValueError, match="RGB"):
        remoteclip.encode_image(nir_4band)


@requires_ml
@pytest.mark.ml
def test_get_encoder_returns_remoteclip():
    from app.config import Settings
    from app.encoder import RemoteCLIPEncoder, get_encoder
    assert isinstance(get_encoder(Settings(encoder="remoteclip")), RemoteCLIPEncoder)
