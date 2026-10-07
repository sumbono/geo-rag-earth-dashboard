"""Tests for etl/download_sentinel2.py (Task 11).

Run from ``etl/``:

    ../.venv/bin/pytest -v            # deterministic, offline
    ../.venv/bin/pytest -v -m smoke   # one live scene (~450 MB download)
"""
import json
import logging
import os

import pytest

# --------------------------------------------------------------------------
# Brief Step 1 — pinned contract tests (verbatim from the task brief)
# --------------------------------------------------------------------------


def test_pick_asset_prefers_https_over_s3():
    """Requester-pays lives on the S3 layer — HTTPS must win when both exist."""
    from download_sentinel2 import pick_asset_href
    assets = {
        "B04": {"href": "s3://sentinel-s2-l2a/x/B04.tif"},
        "B04_https": {"href": "https://sentinel-c1.example/x/B04.tif"},
    }
    assert pick_asset_href("B04", assets).startswith("https://")
    assert pick_asset_href("B04", {"B04": assets["B04"]}).startswith("s3://")  # s3 only when alone


@pytest.mark.smoke
def test_one_scene_downloads(tmp_path):
    from download_sentinel2 import download_one_scene
    scene = download_one_scene(bbox=(39.0, 21.0, 39.5, 21.5), out_dir=tmp_path)  # small Red Sea window
    assert scene["files"], "no assets downloaded"
    total = sum(os.path.getsize(p) for p in scene["files"])
    assert total > 1_000_000, f"assets too small ({total} B) — requester-pays or auth failure?"
    assert (tmp_path / "manifest.json").exists()


# --------------------------------------------------------------------------
# Deterministic tests (no network): fallback ladder, manifest, CLI contract
# --------------------------------------------------------------------------

ES_COG_ROOT = (
    "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs"
    "/37/Q/DD/2026/10/S2A_37QDD_20261004_0_L2A"
)
MPC_BLOB_ROOT = (
    "https://sentinel2l2a01.blob.core.windows.net/sentinel2-l2"
    "/37/Q/DD/2026/10/S2C_MSIL2A_20261004"
)
SMOKE_BBOX = [39.0, 21.0, 39.5, 21.5]


def es_item(**overrides):
    """Earth Search shaped STAC item (asset keys blue/green/red/nir)."""
    item = {
        "id": "S2A_37QDD_20261004_0_L2A",
        "bbox": [38.253473, 20.709718, 39.09435, 21.703381],
        "properties": {"datetime": "2026-10-04T08:04:23.747000Z", "eo:cloud_cover": 0.0018},
        "assets": {
            "blue": {"href": f"{ES_COG_ROOT}/B02.tif"},
            "green": {"href": f"{ES_COG_ROOT}/B03.tif"},
            "red": {"href": f"{ES_COG_ROOT}/B04.tif"},
            "red-jp2": {"href": "s3://sentinel-s2-l2a/tiles/37/Q/DD/2026/10/4/0/R10m/B04.jp2"},
            "nir": {"href": f"{ES_COG_ROOT}/B08.tif"},
            "thumbnail": {"href": f"{ES_COG_ROOT}/preview.jpg"},
        },
    }
    item.update(overrides)
    return item


def mpc_item():
    """Planetary Computer shaped STAC item (asset keys B02..B08, different id scheme)."""
    return {
        "id": "S2C_MSIL2A_20261004T074731_R135_T37QDD_20261004T110813",
        "bbox": [38.253473, 20.709718, 39.09435, 21.703381],
        "properties": {"datetime": "2026-10-04T07:47:31.025000Z", "eo:cloud_cover": 0.0018},
        "assets": {
            band: {"href": f"{MPC_BLOB_ROOT}/{band}.tif"}
            for band in ("B02", "B03", "B04", "B08")
        },
    }


def test_missing_band_scene_skipped_with_warning(tmp_path, monkeypatch, caplog):
    """spec §7: missing band -> scene skipped with WARNING, coverage recorded."""
    import download_sentinel2 as dls
    broken = es_item()
    del broken["assets"]["nir"]  # no B08 / nir anywhere in the item
    monkeypatch.setattr(
        dls, "search_scenes", lambda *a, **k: ([broken], dls.EARTH_SEARCH_URL)
    )

    def _boom(url, dest):
        raise AssertionError("skipped scene must not download anything")

    monkeypatch.setattr(dls, "download_file", _boom)
    with caplog.at_level(logging.WARNING):
        manifest = dls.run(
            bbox=tuple(SMOKE_BBOX),
            cache_dir=tmp_path,
            max_scenes=1,
            cloud_cover=20,
            download_assets=True,
        )
    scene = manifest["scenes"][0]
    assert scene["status"] == "skipped"
    assert "B08" in scene["reason"]
    assert scene["files"] == []
    assert scene["assets"].get("B02", "").startswith("https://")  # what WAS covered
    assert manifest["coverage"]["scenes_total"] == 1
    assert manifest["coverage"]["scenes_covered"] == 0
    assert any("B08" in m for m in caplog.messages)


def test_403_falls_back_to_planetary_computer(tmp_path, monkeypatch):
    """Ladder rung 2: Earth Search COG 403 -> MPC signed href -> download lands."""
    import download_sentinel2 as dls

    monkeypatch.setattr(
        dls, "search_scenes", lambda *a, **k: ([es_item()], dls.EARTH_SEARCH_URL)
    )
    mpc = mpc_item()

    def fake_search(url, bbox, cloud_cover, max_scenes, day=None):
        if url == dls.MPC_URL:
            return [mpc]
        raise AssertionError(f"unexpected catalog lookup: {url}")

    monkeypatch.setattr(dls, "_search_catalog", fake_search)
    monkeypatch.setattr(dls, "sign_href", lambda href: href + "?sig=test")

    fetched = []

    def fake_fetch(url, dest):
        fetched.append(url)
        if "sentinel-cogs" in url:
            raise dls.AccessDeniedError(f"HTTP 403 for {url}")  # bucket policy changed
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x" * 2048)
        return dest.stat().st_size

    monkeypatch.setattr(dls, "download_file", fake_fetch)

    manifest = dls.run(
        bbox=tuple(SMOKE_BBOX),
        cache_dir=tmp_path,
        max_scenes=1,
        cloud_cover=20,
        download_assets=True,
    )
    scene = manifest["scenes"][0]
    assert scene["status"] == "downloaded", scene["reason"]
    assert len(scene["files"]) == 4
    assert sum(1 for u in fetched if "sentinel-cogs" in u) == 4  # L1 tried first
    assert sum(1 for u in fetched if "blob.core.windows.net" in u) == 4  # L2 landed
    assert all(os.path.exists(p) for p in scene["files"])
    assert (tmp_path / scene["scene_id"] / "scene.json").exists()


def test_ladder_exhausted_degrades_to_manifest_exit_zero(tmp_path, monkeypatch, caplog):
    """Ladder rung 3: 403 + MPC unreachable -> degraded, manifest written, exit 0."""
    import download_sentinel2 as dls

    monkeypatch.setattr(
        dls, "search_scenes", lambda *a, **k: ([es_item()], dls.EARTH_SEARCH_URL)
    )

    def mpc_down(url, bbox, cloud_cover, max_scenes, day=None):
        raise ConnectionError("MPC unreachable")

    monkeypatch.setattr(dls, "_search_catalog", mpc_down)

    def denied(url, dest):
        raise dls.AccessDeniedError(f"HTTP 403 for {url}")

    monkeypatch.setattr(dls, "download_file", denied)
    monkeypatch.setenv("ETL_CACHE_DIR", str(tmp_path))

    with caplog.at_level(logging.WARNING):
        rc = dls.main(
            ["--bbox", "39.0", "21.0", "39.5", "21.5",
             "--max-scenes", "1", "--download-assets"]
        )
    assert rc == 0, "degraded mode must exit 0 (fixture-only coverage)"
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    scene = manifest["scenes"][0]
    assert scene["status"] == "degraded"
    assert scene["files"] == []
    assert "ladder exhausted" in scene["reason"]
    assert manifest["coverage"]["scenes_degraded"] == 1
    assert any("ladder" in m.lower() for m in caplog.messages)


def test_cli_default_writes_manifest_urls_without_downloading(tmp_path, monkeypatch):
    """R2: default run = STAC query + manifest with per-band https URLs, no TIFFs."""
    import download_sentinel2 as dls

    seen = {}

    def fake_search(bbox, cloud_cover, max_scenes):
        seen.update(bbox=tuple(bbox), cloud_cover=cloud_cover, max_scenes=max_scenes)
        return [es_item()], dls.EARTH_SEARCH_URL

    monkeypatch.setattr(dls, "search_scenes", fake_search)
    monkeypatch.setenv("ETL_CACHE_DIR", str(tmp_path))

    def _boom(url, dest):
        raise AssertionError("default run must not download assets")

    monkeypatch.setattr(dls, "download_file", _boom)

    rc = dls.main(
        ["--bbox", "39.0", "21.0", "39.5", "21.5", "--max-scenes", "1", "--cloud-cover", "20"]
    )
    assert rc == 0
    assert seen == {"bbox": (39.0, 21.0, 39.5, 21.5), "cloud_cover": 20.0, "max_scenes": 1}

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    scene = manifest["scenes"][0]
    assert scene["status"] == "manifest-only"
    assert scene["files"] == []
    assert set(scene["assets"]) == {"B02", "B03", "B04", "B08"}
    assert all(u.startswith("https://") for u in scene["assets"].values())
    assert scene["datetime"] and scene["bbox"] and scene["cloud_cover"] is not None
    assert scene["scene_id"] == "S2A_37QDD_20261004_0_L2A"


def test_env_defaults_bbox_and_cache_dir(tmp_path, monkeypatch):
    """ETL_CACHE_DIR + SAUDI_REDSEA_BBOX env vars are honored; brief CLI defaults."""
    import download_sentinel2 as dls

    monkeypatch.setenv("ETL_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("SAUDI_REDSEA_BBOX", "39.0, 21.0, 39.5, 21.5")

    seen = {}

    def fake_search(bbox, cloud_cover, max_scenes):
        seen.update(bbox=tuple(bbox), cloud_cover=cloud_cover, max_scenes=max_scenes)
        return [], dls.EARTH_SEARCH_URL

    monkeypatch.setattr(dls, "search_scenes", fake_search)

    rc = dls.main([])  # no flags at all
    assert rc == 0
    assert seen["bbox"] == (39.0, 21.0, 39.5, 21.5)
    assert seen["cloud_cover"] == 20.0  # brief default
    assert seen["max_scenes"] == 40  # brief default
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["scenes"] == []
    assert manifest["coverage"]["scenes_total"] == 0


def test_query_ladder_unrecoverable_names_both_catalogs(tmp_path, monkeypatch, caplog):
    """Unrecoverable query: error names the ladder outcome; CLI exits 2, no traceback."""
    import download_sentinel2 as dls

    def down(url, *a, **k):
        raise ConnectionError(f"{url} refused")

    monkeypatch.setattr(dls, "_search_catalog", down)
    with pytest.raises(dls.LadderError) as exc:
        dls.search_scenes(tuple(SMOKE_BBOX), 20, 1)
    msg = str(exc.value)
    assert dls.EARTH_SEARCH_URL in msg and dls.MPC_URL in msg

    monkeypatch.setattr(
        dls, "search_scenes",
        lambda *a, **k: (_ for _ in ()).throw(dls.LadderError("both catalogs down")),
    )
    monkeypatch.setenv("ETL_CACHE_DIR", str(tmp_path))
    with caplog.at_level(logging.ERROR):
        rc = dls.main(["--bbox", "39.0", "21.0", "39.5", "21.5", "--max-scenes", "1"])
    assert rc == 2
    assert any("both catalogs down" in m for m in caplog.messages)


def _seed_manifest(cache_dir, record):
    """Write a manifest as an earlier run would have left it."""
    (cache_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": 1,
                "generated_at": "2026-10-06T00:00:00Z",
                "last_run": {},
                "coverage": {},
                "scenes": [record],
            }
        ),
        encoding="utf-8",
    )


def test_manifest_upsert_preserves_download_state_on_manifest_only_rerun(
    tmp_path, monkeypatch
):
    """Re-running the default (no-flag) command must not erase downloaded state.

    Review finding (Important): the upsert replaced same-scene records
    wholesale, resetting files=[] / status="manifest-only" over ~530 MB/scene
    sitting on disk and driving coverage.scenes_downloaded to 0 (Task 12
    consumes those paths). Metadata (URL/datetime/cloud) must still refresh
    from the fresh query.
    """
    import download_sentinel2 as dls

    item = es_item()
    seed_files = [
        str(tmp_path / item["id"] / f"{band}.tif") for band in ("B02", "B03", "B04", "B08")
    ]
    _seed_manifest(
        tmp_path,
        {
            "scene_id": item["id"],
            "datetime": "2026-10-04T08:04:23.747000Z",
            "bbox": item["bbox"],
            "cloud_cover": 0.0018,
            "catalog": dls.EARTH_SEARCH_URL,
            "assets": {band: item["assets"][key]["href"]
                       for band, key in (("B02", "blue"), ("B03", "green"),
                                         ("B04", "red"), ("B08", "nir"))},
            "thumbnail": item["assets"]["thumbnail"]["href"],
            "missing_bands": [],
            "files": seed_files,
            "status": "downloaded",
            "reason": None,
        },
    )

    # Fresh default run: same scene, refreshed metadata from the new query.
    refreshed = es_item(
        properties={
            "datetime": "2026-10-04T08:04:24.000000Z",
            "eo:cloud_cover": 1.25,
        }
    )
    refreshed["assets"]["blue"] = {"href": f"{ES_COG_ROOT}/B02_v2.tif"}
    monkeypatch.setattr(
        dls, "search_scenes", lambda *a, **k: ([refreshed], dls.EARTH_SEARCH_URL)
    )

    def _boom(url, dest):
        raise AssertionError("manifest-only rerun must not download")

    monkeypatch.setattr(dls, "download_file", _boom)
    monkeypatch.setenv("ETL_CACHE_DIR", str(tmp_path))

    rc = dls.main(["--bbox", "39.0", "21.0", "39.5", "21.5", "--max-scenes", "1"])
    assert rc == 0

    merged = json.loads((tmp_path / "manifest.json").read_text())
    assert len(merged["scenes"]) == 1
    scene = merged["scenes"][0]
    # PRESERVED: download state the R2 manifest promises to Task 12
    assert scene["files"] == seed_files
    assert scene["status"] == "downloaded"
    assert merged["coverage"]["scenes_downloaded"] == 1
    assert merged["coverage"]["scenes_manifest_only"] == 0
    assert merged["coverage"]["coverage_pct"] == 100.0
    # REFRESHED: URL / datetime / cloud-cover come from the fresh query
    assert scene["cloud_cover"] == 1.25
    assert scene["datetime"] == "2026-10-04T08:04:24.000000Z"
    assert scene["assets"]["B02"].endswith("/B02_v2.tif")


def test_manifest_upsert_fresh_download_overwrites_stale(tmp_path, monkeypatch):
    """Inverse: when the incoming record carries files, it wins outright."""
    import download_sentinel2 as dls

    item = es_item()
    _seed_manifest(
        tmp_path,
        {
            "scene_id": item["id"],
            "datetime": "2020-01-01T00:00:00.000000Z",
            "bbox": item["bbox"],
            "cloud_cover": 99.0,
            "catalog": dls.EARTH_SEARCH_URL,
            "assets": {band: item["assets"][key]["href"]
                       for band, key in (("B02", "blue"), ("B03", "green"),
                                         ("B04", "red"), ("B08", "nir"))},
            "thumbnail": None,
            "missing_bands": [],
            "files": ["/stale/old/B02.tif"],
            "status": "failed",
            "reason": "old transport failure",
        },
    )

    def fake_fetch(url, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x" * 1024)
        return dest.stat().st_size

    monkeypatch.setattr(dls, "download_file", fake_fetch)
    monkeypatch.setattr(
        dls, "search_scenes", lambda *a, **k: ([item], dls.EARTH_SEARCH_URL)
    )
    monkeypatch.setenv("ETL_CACHE_DIR", str(tmp_path))

    rc = dls.main(
        ["--bbox", "39.0", "21.0", "39.5", "21.5",
         "--max-scenes", "1", "--download-assets"]
    )
    assert rc == 0

    merged = json.loads((tmp_path / "manifest.json").read_text())
    scene = merged["scenes"][0]
    fresh_files = [
        str(tmp_path / item["id"] / f"{band}.tif")
        for band in ("B02", "B03", "B04", "B08")
    ]
    assert scene["files"] == fresh_files  # stale path gone, fresh evidence in
    assert all(os.path.exists(p) for p in scene["files"])
    assert scene["status"] == "downloaded"
    assert scene["reason"] is None
    assert scene["cloud_cover"] == 0.0018
    assert scene["datetime"] == item["properties"]["datetime"]
    assert merged["coverage"]["scenes_downloaded"] == 1
