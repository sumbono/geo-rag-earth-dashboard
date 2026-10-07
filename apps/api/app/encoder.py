"""Embedding encoders — the single source of truth for vector embeddings.

`FakeEncoder` (deterministic, dependency-free) stands in for tests/CI/DEV;
`RemoteCLIPEncoder` produces the real 512-dim RemoteCLIP embeddings. Consumed
by Task 7 (`get_encoder` FastAPI dependency) and Task 13 (ETL embed job,
which imports `RemoteCLIPEncoder` directly).

Global constraint: torch/open_clip/huggingface_hub/PIL are imported ONLY
inside `RemoteCLIPEncoder.__init__` — never at module top level — so importing
this module (and the whole default test suite) works without ML deps installed.
"""
import hashlib
import threading
from typing import TYPE_CHECKING, Protocol

import numpy as np

if TYPE_CHECKING:
    from app.config import Settings

_EMBED_DIM = 512  # RemoteCLIP ViT-B/32 output dim; pgvector rows assume this
_DEFAULT_DEVICE = "cpu"  # RemoteCLIPEncoder's default; get_encoder never overrides it


class Encoder(Protocol):
    """Maps text or an RGB image to a float32 unit vector of shape (512,)."""

    def encode_text(self, text: str) -> np.ndarray: ...
    def encode_image(self, arr: np.ndarray) -> np.ndarray: ...


def _unit(v: np.ndarray) -> np.ndarray:
    """L2-normalize to float32 — the (512,) unit-vector output contract."""
    v = np.asarray(v, dtype=np.float32)
    norm = np.linalg.norm(v)
    if norm == 0.0:
        raise ValueError("cannot L2-normalize a zero vector")
    return (v / norm).astype(np.float32)


class FakeEncoder:
    """Deterministic stand-in: the vector is a pure function of the input.

    Seed = SHA-256 of the input (text bytes, or image dtype+shape+pixels)
    modulo 2**32 → `np.random.default_rng` → 512 draws → L2-normalized.
    Same input always yields the same unit vector, across runs and processes.
    """

    def encode_text(self, text: str) -> np.ndarray:
        seed = int(hashlib.sha256(text.encode()).hexdigest(), 16) % 2**32
        rng = np.random.default_rng(seed)
        return _unit(rng.random(_EMBED_DIM))

    def encode_image(self, arr: np.ndarray) -> np.ndarray:
        a = np.ascontiguousarray(arr)
        key = f"{a.dtype}|{a.shape}".encode() + a.tobytes()
        seed = int(hashlib.sha256(key).hexdigest(), 16) % 2**32
        rng = np.random.default_rng(seed)
        return _unit(rng.random(_EMBED_DIM))


def _to_uint8_rgb(arr: np.ndarray) -> np.ndarray:
    """RGB array → uint8 for PIL: uint8 passes through; floats are [0, 1]
    (scaled ×255) or [0, 255]; everything is clipped to [0, 255]."""
    if arr.dtype == np.uint8:
        return np.ascontiguousarray(arr)
    v = arr.astype(np.float32)
    if v.size and float(v.max()) <= 1.0:
        v = v * 255.0
    return np.clip(v, 0, 255).astype(np.uint8)


class RemoteCLIPEncoder:
    """RemoteCLIP ViT-B/32 (chendelong/RemoteCLIP) text/image embeddings.

    Weights: hf_hub_download("chendelong/RemoteCLIP", "RemoteCLIP-ViT-B-32.pt")
    (downloaded once, cached by huggingface_hub); inputs are resized to
    224×224. Runs on CPU by default.

    Band contract (Option B, binding for Task 13): `encode_image` consumes
    ONLY the 3-channel RGB view — Sentinel-2 B04/B03/B02 stacked to
    (H, W, 3) float32 (values in [0, 1] or [0, 255], or uint8). NIR/4-band
    arrays never enter the model: callers slice the RGB view themselves, and
    anything that is not (H, W, 3) raises here.
    """

    def __init__(self, device: str = "cpu") -> None:
        # Lazy imports (Global Constraint: no top-level torch anywhere in app/).
        import open_clip
        import torch
        from huggingface_hub import hf_hub_download
        from PIL import Image

        weights = hf_hub_download("chendelong/RemoteCLIP", "RemoteCLIP-ViT-B-32.pt")
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained=weights
        )
        self._torch = torch
        self._Image = Image
        self.device = torch.device(device)
        self._model = model.to(self.device).eval()
        self._preprocess = preprocess
        self._tokenizer = open_clip.get_tokenizer("ViT-B-32")

    def encode_text(self, text: str) -> np.ndarray:
        tokens = self._tokenizer([text]).to(self.device)
        with self._torch.no_grad():
            feats = self._model.encode_text(tokens)
        return _unit(feats[0].detach().float().cpu().numpy())

    def encode_image(self, arr: np.ndarray) -> np.ndarray:
        # Band contract (Option B): callers pass the RGB view (B04/B03/B02 →
        # (H, W, 3) float32). NIR/4-band arrays never enter the model.
        a = np.asarray(arr)
        if a.ndim != 3 or a.shape[-1] != 3:
            raise ValueError(
                "RemoteCLIPEncoder.encode_image expects the 3-channel RGB view "
                f"(H, W, 3) — got shape {a.shape}; slice B04/B03/B02 first "
                "(NIR/4-band data never enters the model)"
            )
        img = self._Image.fromarray(_to_uint8_rgb(a))
        img = img.resize((224, 224), self._Image.Resampling.BILINEAR)
        x = self._preprocess(img).unsqueeze(0).to(self.device)
        with self._torch.no_grad():
            feats = self._model.encode_image(x)
        return _unit(feats[0].detach().float().cpu().numpy())


# R15: process-level singleton cache. Construction of RemoteCLIPEncoder costs
# ~2 s (model load) — building one per search request made e2e p95 miss the
# 800 ms budget (docs/benchmarks.md, initial run). Keyed by the two plain
# strings (encoder, device): Settings is a pydantic BaseSettings and
# unhashable. Invalidation: NEVER within a process — env/config are fixed at
# startup (uvicorn/compose), so a different key can only appear in a new
# process, which starts with an empty cache.
_ENCODER_CACHE: dict[tuple[str, str], Encoder] = {}
_ENCODER_LOCK = threading.Lock()


def _construct(encoder_name: str) -> Encoder:
    if encoder_name == "fake":
        return FakeEncoder()
    if encoder_name == "remoteclip":
        return RemoteCLIPEncoder()
    raise ValueError(
        f"unknown encoder {encoder_name!r}; expected 'fake' or 'remoteclip'"
    )


def get_encoder(settings: "Settings") -> Encoder:
    """Factory over `Settings.encoder` / env ENCODER — "fake" | "remoteclip".

    Returns the process-level singleton for `(settings.encoder, device)`
    (R15): the first call pays construction/model load, every later call —
    e.g. every search request — reuses the same instance. Thread-safe
    (double-checked lock); unknown encoder names still raise before caching.
    """
    key = (settings.encoder, _DEFAULT_DEVICE)
    cached = _ENCODER_CACHE.get(key)
    if cached is not None:
        return cached
    with _ENCODER_LOCK:
        cached = _ENCODER_CACHE.get(key)
        if cached is not None:
            return cached
        encoder = _construct(settings.encoder)
        _ENCODER_CACHE[key] = encoder
        return encoder
