"""Sentinel-2 L2A scene downloader — Earth Search STAC (ETL, offline batch).

Queries the STAC catalog for scenes intersecting a bbox and writes
``$ETL_CACHE_DIR/manifest.json``.  The manifest ALWAYS carries, per scene:
``scene_id``, ``datetime``, ``bbox``, ``cloud_cover`` and the per-band https
COG asset URLs (B02/B03/B04/B08) — plus local file paths once downloaded.
Task 12 reads the manifest and does windowed ``/vsicurl/`` range reads, so the
default run is a cheap STAC query + manifest only; pass ``--download-assets``
to also fetch the (~450 MB/scene) TIFFs.

Fallback ladder for asset access (spec §7 / task ruling R2):
  1. full-file download of the primary catalog's https COG href(s) for the
     scene — retry other hrefs of the same scene when one is denied,
  2. switch to Microsoft Planetary Computer (signed hrefs via its public SAS
     signing endpoint),
  3. degraded mode — skip downloads, record fixture-only coverage in the
     manifest, exit 0 with honest log lines.
If no catalog can even be queried (both Earth Search and Planetary Computer
unreachable) the run is unrecoverable: a clear ``LadderError`` names both
outcomes — never a bare traceback.

CLI:
    python etl/download_sentinel2.py --bbox 34.5 16.5 40.0 29.0 \
        --max-scenes 40 --cloud-cover 20 [--download-assets]
Env: ETL_CACHE_DIR (default data/scenes), SAUDI_REDSEA_BBOX (comma-separated
default bbox when --bbox is omitted).  Run tests from etl/: ``pytest -v``
(``-m smoke`` for the one live scene).

Probe facts (verified live 2026-10-06 — keep, do not "fix" without re-probing):
  * STAC search: POST https://earth-search.aws.element84.com/v1/search with
    collections ["sentinel-2-l2a"] (pystac-client 0.9 POSTs by default).
  * Band COGs live on the public bucket
    https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/...
    with Cache-Control: public, Accept-Ranges: bytes, no auth —
    HEAD 200 / GET 200 / range GET 206 all proven (no requester-pays).
  * Example scene S2A_37QDD_20250929_0_L2A: B02.tif = 116,745,801 bytes,
    10980x10980 uint16 (10 m band).
  * `thumbnail` asset is a small JPEG (preview.jpg) — usable as UI thumb
    before chips are extracted.
  * Auxiliary s3://sentinel-s2-l2a/... assets (cloud, snow, product_metadata)
    are NOT needed — never selected, never downloaded.
  * Earth Search asset keys are semantic: blue/green/red/nir carry the
    B02/B03/B04/B08 https COG hrefs; blue-jp2 etc. are raw s3:// jp2 variants
    (requester-pays territory) that we never touch.
  * Planetary Computer fallback (https://planetarycomputer.microsoft.com/api/stac/v1)
    uses B02..B08 asset keys and different scene ids
    (S2C_MSIL2A_<t>_R135_T<tile>_<t>); unsigned blob URLs answer HTTP 409, so
    every MPC href is signed via
    https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=...
    MPC can lag Earth Search by days: a scene missing there is a legitimate
    ladder outcome (rung 2 -> None -> degraded rung 3).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from pystac_client import Client

logger = logging.getLogger("download_sentinel2")

COLLECTION = "sentinel-2-l2a"
EARTH_SEARCH_URL = "https://earth-search.aws.element84.com/v1"
MPC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
MPC_SIGN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
BANDS = ("B02", "B03", "B04", "B08")
# Earth Search names its raster assets semantically; these aliases map the
# band contract (B02/B03/B04/B08) onto them (and still match literal B02.. keys).
BAND_ALIASES = {"B02": "blue", "B03": "green", "B04": "red", "B08": "nir"}
DEFAULT_BBOX = (34.5, 16.5, 40.0, 29.0)  # Saudi Red Sea window (.env.example)
DEFAULT_MAX_SCENES = 40
DEFAULT_CLOUD_COVER = 20.0
DEFAULT_CACHE_DIR = "data/scenes"
HTTP_TIMEOUT = (15, 120)  # (connect, read-per-chunk) seconds

# scene-id schemes: Earth Search "S2A_37QDD_20261004_0_L2A" vs MPC
# "S2C_MSIL2A_20261004T074731_R135_T37QDD_20261004T110813" (both encode the
# same MGRS tile + ESA sensing date, so they can be matched across catalogs).
_ES_ID_RE = re.compile(r"^S2[A-Z]_(\d{2}[A-Z]{3})_(\d{8})_")
_MPC_ID_RE = re.compile(r"_T(\d{2}[A-Z]{3})_(\d{8})")


class LadderError(RuntimeError):
    """The fallback ladder itself could not run (no catalog reachable)."""


class AccessDeniedError(Exception):
    """HTTP 403 / AccessDenied — the ladder trigger."""


# --------------------------------------------------------------------------
# Asset-URL policy
# --------------------------------------------------------------------------


def _band_asset_keys(band: str, assets: dict) -> list[str]:
    """Asset keys belonging to `band`: exact/prefixed band name or alias."""
    alias = BAND_ALIASES.get(band)
    keys = []
    for key in assets:
        if key == band or key.startswith((band + "_", band + "-")) or alias and (
            key == alias or key.startswith((alias + "_", alias + "-"))
        ):
            keys.append(key)
    return keys


def candidate_hrefs(band: str, assets: dict) -> list[str]:
    """All hrefs for `band`, ordered https > http > s3 (stable within a class).

    Requester-pays lives on the S3 layer, so s3:// hrefs sort last and are
    only ever reached when they are the sole option; the downloader itself
    only ever fetches http(s) hrefs.
    """
    hrefs = []
    for key in _band_asset_keys(band, assets):
        href = (assets.get(key) or {}).get("href")
        if href:
            hrefs.append(href)

    def scheme_rank(href: str) -> int:
        scheme = href.split("://", 1)[0] if "://" in href else ""
        return {"https": 0, "http": 1, "s3": 2}.get(scheme, 3)

    return sorted(hrefs, key=scheme_rank)


def pick_asset_href(band: str, assets: dict) -> str | None:
    """Best href for `band`: https wins whenever it exists; s3 only if alone."""
    hrefs = candidate_hrefs(band, assets)
    return hrefs[0] if hrefs else None


# --------------------------------------------------------------------------
# STAC item normalization
# --------------------------------------------------------------------------


def _item_fields(item) -> tuple[str, list | None, dict, dict]:
    """(id, bbox, properties, assets) from a pystac Item or a plain dict."""
    if isinstance(item, dict):
        return (
            item["id"],
            item.get("bbox"),
            dict(item.get("properties") or {}),
            dict(item.get("assets") or {}),
        )
    return (
        item.id,
        list(item.bbox) if item.bbox else None,
        dict(item.properties),
        {key: {"href": asset.href} for key, asset in item.assets.items()},
    )


def scene_key(scene_id: str) -> tuple[str, str] | None:
    """(mgrs_tile, YYYYMMDD) for either catalog's id scheme, else None."""
    match = _ES_ID_RE.match(scene_id or "")
    if match:
        return match.group(1), match.group(2)
    match = _MPC_ID_RE.search(scene_id or "")
    if match:
        return match.group(1), match.group(2)
    return None


def build_scene_record(item, catalog_url: str) -> dict:
    """Manifest record for one STAC item (https band URLs, never s3 aux)."""
    scene_id, bbox, properties, assets = _item_fields(item)
    band_assets: dict[str, str] = {}
    missing: list[str] = []
    for band in BANDS:
        href = pick_asset_href(band, assets)
        if href:
            band_assets[band] = href
        else:
            missing.append(band)
    thumb = assets.get("thumbnail") or assets.get("rendered_preview") or {}
    return {
        "scene_id": scene_id,
        "datetime": properties.get("datetime"),
        "bbox": list(bbox) if bbox else None,
        "cloud_cover": properties.get("eo:cloud_cover"),
        "catalog": catalog_url,
        "assets": band_assets,
        "thumbnail": thumb.get("href"),
        "missing_bands": missing,
        "files": [],
        "status": "manifest-only",
        "reason": None,
    }


# --------------------------------------------------------------------------
# Catalog query (ladder rung: Earth Search -> Planetary Computer)
# --------------------------------------------------------------------------


def _item_cloud(item) -> float:
    cloud = _item_fields(item)[2].get("eo:cloud_cover")
    return float(cloud) if cloud is not None else float("inf")


def _search_catalog(url, bbox, cloud_cover, max_scenes, day=None) -> list:
    """One catalog query: bbox + cloud cap, sorted cloud-asc then recent-first."""
    client = Client.open(url)
    kwargs: dict = {
        "collections": [COLLECTION],
        "bbox": [float(v) for v in bbox],
        "max_items": max(int(max_scenes) * 2, 40),
    }
    if cloud_cover is not None:
        kwargs["query"] = {"eo:cloud_cover": {"lte": float(cloud_cover)}}
    if day:
        kwargs["datetime"] = (
            f"{day[0:4]}-{day[4:6]}-{day[6:8]}T00:00:00Z/"
            f"{day[0:4]}-{day[4:6]}-{day[6:8]}T23:59:59Z"
        )
    items = list(client.search(**kwargs).items())
    items.sort(key=lambda it: _item_fields(it)[2].get("datetime") or "", reverse=True)
    items.sort(key=_item_cloud)  # stable: cloud asc, recent first within ties
    return items[: max(int(max_scenes), 0)]


def search_scenes(bbox, cloud_cover, max_scenes) -> tuple[list, str]:
    """Query the catalog ladder; returns (items, catalog_url).

    Raises LadderError naming every catalog outcome when none is reachable —
    there is no scene enumeration without a catalog, so this is the
    unrecoverable case (CLI exits 2 with that message, no traceback).
    """
    failures = []
    for url in (EARTH_SEARCH_URL, MPC_URL):
        try:
            items = _search_catalog(url, bbox, cloud_cover, max_scenes)
        except Exception as exc:  # noqa: BLE001 — ladder must record any cause
            detail = f"{url}: {type(exc).__name__}: {exc}"
            failures.append(detail)
            logger.warning("STAC query failed on %s", detail)
            continue
        logger.info("catalog %s returned %d scene(s)", url, len(items))
        return items, url
    raise LadderError(
        "no reachable STAC catalog (ladder: Earth Search -> Planetary Computer; "
        "degraded mode needs a catalog to enumerate scenes): " + " | ".join(failures)
    )


# --------------------------------------------------------------------------
# Catalog-switch lookups (ladder rung 2)
# --------------------------------------------------------------------------


def _record_day(record: dict) -> str | None:
    """YYYYMMDD sensing day — prefer the ESA product date in the scene id."""
    key = scene_key(record.get("scene_id", ""))
    if key:
        return key[1]
    stamp = record.get("datetime") or ""
    if len(stamp) >= 10 and stamp[4] == "-":
        return stamp[:10].replace("-", "")
    return None


def _parse_dt(stamp):
    if not stamp:
        return None
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None


def _match_item(items: list, record: dict):
    """Same scene in another catalog: matching (tile, date), closest datetime."""
    target = scene_key(record.get("scene_id", ""))
    if target is None:
        return None
    matches = [it for it in items if scene_key(_item_fields(it)[0]) == target]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    record_dt = _parse_dt(record.get("datetime"))

    def distance(item) -> float:
        item_dt = _parse_dt(_item_fields(item)[2].get("datetime"))
        if item_dt and record_dt:
            return abs((item_dt - record_dt).total_seconds())
        return float("inf")

    return min(matches, key=distance)


def lookup_band_href(catalog_url, record: dict, band: str, *, sign_needed: bool):
    """Best http(s) href for `band` of `record`'s scene in `catalog_url`.

    None means this rung is exhausted (unreachable catalog, scene not
    present — MPC can lag —, no band asset, or signing failure).
    """
    try:
        items = _search_catalog(
            catalog_url,
            bbox=record["bbox"],
            cloud_cover=None,
            max_scenes=20,
            day=_record_day(record),
        )
    except Exception as exc:  # noqa: BLE001 — rung outcome, not a crash
        logger.warning(
            "ladder lookup: %s unreachable for %s (%s: %s)",
            catalog_url, record["scene_id"], type(exc).__name__, exc,
        )
        return None
    item = _match_item(items, record)
    if item is None:
        logger.warning(
            "ladder lookup: scene %s not found in %s", record["scene_id"], catalog_url
        )
        return None
    href = pick_asset_href(band, _item_fields(item)[3])
    if not href or not href.startswith(("https://", "http://")):
        return None
    if sign_needed:
        try:
            return sign_href(href)
        except Exception as exc:  # noqa: BLE001 — rung outcome, not a crash
            logger.warning(
                "ladder lookup: signing failed for %s (%s: %s)",
                href, type(exc).__name__, exc,
            )
            return None
    return href


def _mpc_band_href(record: dict, band: str):
    return lookup_band_href(MPC_URL, record, band, sign_needed=True)


def _es_band_href(record: dict, band: str):
    return lookup_band_href(EARTH_SEARCH_URL, record, band, sign_needed=False)


# --------------------------------------------------------------------------
# Network primitives
# --------------------------------------------------------------------------


def sign_href(href: str) -> str:
    """Sign an MPC href via its public SAS endpoint (unsigned -> HTTP 409)."""
    response = requests.get(MPC_SIGN_URL, params={"href": href}, timeout=(10, 30))
    response.raise_for_status()
    signed = response.json().get("href")
    if not signed:
        raise RuntimeError(f"signing response for {href} carried no href")
    return signed


def download_file(url: str, dest: Path, *, timeout=HTTP_TIMEOUT) -> int:
    """Stream `url` to `dest` (atomic .part rename). Returns bytes written.

    Raises AccessDeniedError on HTTP 403 (the ladder trigger); any other
    transport error propagates to the per-scene failure path (spec §7).
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    try:
        with requests.get(url, stream=True, timeout=timeout) as response:
            if response.status_code == 403:
                raise AccessDeniedError(f"HTTP 403 for {url}")
            response.raise_for_status()
            length = response.headers.get("Content-Length")
            logger.info(
                "GET %s -> %s%s", url, dest, f" ({length} bytes)" if length else "",
            )
            written = 0
            with open(part, "wb") as fh:
                for chunk in response.iter_content(chunk_size=1 << 20):
                    if chunk:
                        fh.write(chunk)
                        written += len(chunk)
        part.replace(dest)
        logger.info("wrote %s (%d bytes)", dest, written)
        return written
    except Exception:
        part.unlink(missing_ok=True)
        raise


# --------------------------------------------------------------------------
# Per-scene download with the fallback ladder
# --------------------------------------------------------------------------


def _try_fetches(urls, dest, record, band, rung, notes) -> bool:
    """Fetch `urls` in order; first success wins, 403s fall through."""
    for url in urls:
        try:
            written = download_file(url, dest)
        except AccessDeniedError as exc:
            note = f"{rung} {band}: denied — {exc}"
            notes.append(note)
            logger.warning("ladder %s: %s denied (%s)", rung, band, exc)
            continue
        record["files"].append(str(dest))
        logger.info(
            "scene %s band %s downloaded via %s (%d bytes)",
            record["scene_id"], band, rung, written,
        )
        return True
    return False


def _write_scene_json(scene_dir: Path, record: dict) -> None:
    (scene_dir / "scene.json").write_text(
        json.dumps(record, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )


def download_scene(record: dict, scene_dir: Path, raw_assets: dict) -> dict:
    """Download B02/B03/B04/B08 for one scene into scene_dir (ladder rungs 1-3).

    Mutates `record` (files/status/reason); always writes scene.json when the
    directory exists. Non-access transport failures are logged + recorded as
    'failed' (spec §7), 403s walk the ladder to 'degraded' — neither crashes
    the batch.
    """
    scene_dir = Path(scene_dir)
    record["files"] = []
    notes: list[str] = []
    degraded: list[str] = []
    try:
        scene_dir.mkdir(parents=True, exist_ok=True)
        primary_is_mpc = record["catalog"] == MPC_URL
        for band in BANDS:
            dest = scene_dir / f"{band}.tif"
            # Rung 1: the primary catalog's own http(s) hrefs for this scene
            # (all of them — "retry other hrefs of same scene" on 403).
            rung1 = [
                href
                for href in candidate_hrefs(band, raw_assets)
                if href.startswith(("https://", "http://"))
            ]
            if primary_is_mpc:
                signed = []
                for href in rung1:
                    try:
                        signed.append(sign_href(href))
                    except Exception as exc:  # noqa: BLE001 — rung outcome
                        notes.append(f"L1 {band}: sign failed — {exc}")
                rung1 = signed
            ok = _try_fetches(rung1, dest, record, band, "L1", notes)
            if not ok:
                # Rung 2: switch catalog (signing when crossing to MPC).
                alternate = (
                    _es_band_href if primary_is_mpc else _mpc_band_href
                )(record, band)
                if alternate:
                    ok = _try_fetches([alternate], dest, record, band, "L2", notes)
                else:
                    notes.append(f"L2 {band}: no alternate-catalog href")
            if not ok:
                # Rung 3: degraded — fixture-only coverage, no download.
                degraded.append(band)
                notes.append(
                    f"L3 {band}: degraded — ladder exhausted, fixture-only coverage"
                )
                logger.warning(
                    "ladder exhausted for scene %s band %s — degraded, "
                    "fixture-only coverage (manifest records it)",
                    record["scene_id"], band,
                )
        if degraded:
            record["status"] = "degraded"
            record["reason"] = "ladder exhausted: " + "; ".join(notes)
        else:
            record["status"] = "downloaded"
            record["reason"] = None
    except Exception as exc:  # non-access failure: logged + skipped (spec §7)
        record["status"] = "failed"
        record["reason"] = f"{type(exc).__name__}: {exc}"
        logger.warning(
            "scene %s download failed: %s — skipped, coverage recorded",
            record["scene_id"], record["reason"],
        )
    finally:
        if scene_dir.exists():
            _write_scene_json(scene_dir, record)
    return record


def process_scenes(items, catalog_url: str, cache_dir: Path, download_assets: bool):
    """Build manifest records for items; download when asked, else URL-only."""
    cache_dir = Path(cache_dir)
    records = []
    for item in items:
        record = build_scene_record(item, catalog_url)
        if record["missing_bands"]:
            # spec §7: missing band -> scene skipped with a WARNING; the
            # manifest still records what WAS covered (the present URLs).
            record["status"] = "skipped"
            record["reason"] = (
                "missing band(s): "
                + ", ".join(record["missing_bands"])
                + " — scene skipped, partial coverage recorded"
            )
            logger.warning(
                "scene %s: %s", record["scene_id"], record["reason"],
            )
            records.append(record)
            continue
        if download_assets:
            safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", record["scene_id"])
            raw_assets = _item_fields(item)[3]
            download_scene(record, cache_dir / safe_id, raw_assets)
        records.append(record)
    return records


# --------------------------------------------------------------------------
# Manifest
# --------------------------------------------------------------------------


def _coverage(scenes: list) -> dict:
    def count(status: str) -> int:
        return sum(1 for s in scenes if s.get("status") == status)

    total = len(scenes)
    covered = sum(1 for s in scenes if not s.get("missing_bands"))
    return {
        "scenes_total": total,
        "scenes_covered": covered,
        "scenes_downloaded": count("downloaded"),
        "scenes_degraded": count("degraded"),
        "scenes_skipped": count("skipped"),
        "scenes_failed": count("failed"),
        "scenes_manifest_only": count("manifest-only"),
        "coverage_pct": round(100.0 * covered / total, 1) if total else 0.0,
    }


def _merge_scene_record(existing: dict | None, incoming: dict) -> dict:
    """Merge one incoming record into the manifest (keyed by scene_id).

    Download evidence on disk must survive a later manifest-only query:
    re-running the documented default (no-flag) command over an already
    downloaded scene must not reset files=[] / status and orphan the TIFFs
    Task 12 consumes. Rules: an incoming record WITH files (fresh download)
    always wins; an incoming record without files never erases an existing
    record's files/status/reason (they describe what is on disk); URL,
    datetime, bbox and cloud-cover metadata always come from the freshest
    query.
    """
    if existing is None:
        return incoming
    if incoming.get("files"):
        return incoming
    if existing.get("files") or existing.get("status") == "downloaded":
        return {
            **incoming,
            "files": existing.get("files", []),
            "status": existing.get("status", incoming.get("status")),
            "reason": existing.get("reason"),
        }
    return incoming


def finalize_manifest(cache_dir: Path, new_records: list, run_info: dict) -> dict:
    """Merge this run's records into $cache_dir/manifest.json and return it.

    Scenes persist on disk across runs, so the manifest accumulates by
    scene_id (per-scene merge, see _merge_scene_record) instead of being
    clobbered by a later run over a smaller bbox or a manifest-only rerun.
    """
    cache_dir = Path(cache_dir)
    path = cache_dir / "manifest.json"
    scenes: dict[str, dict] = {}
    if path.is_file():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(existing, dict) and existing.get("version") == 1:
                for scene in existing.get("scenes", []):
                    scenes[scene["scene_id"]] = scene
            else:
                logger.warning("ignoring unrecognized manifest at %s", path)
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("could not read existing manifest %s (%s); rebuilding",
                           path, exc)
    for record in new_records:
        scenes[record["scene_id"]] = _merge_scene_record(
            scenes.get(record["scene_id"]), record
        )
    manifest = {
        "version": 1,
        "generated_at": _utc_now(),
        "last_run": {**run_info, "generated_at": _utc_now()},
        "coverage": _coverage(list(scenes.values())),
        "scenes": list(scenes.values()),
    }
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    return manifest


def _log_summary(manifest: dict, path: Path) -> None:
    cov = manifest["coverage"]
    logger.info(
        "manifest %s | scenes total=%d covered=%d downloaded=%d degraded=%d "
        "skipped=%d failed=%d manifest-only=%d coverage=%.1f%%",
        path, cov["scenes_total"], cov["scenes_covered"], cov["scenes_downloaded"],
        cov["scenes_degraded"], cov["scenes_skipped"], cov["scenes_failed"],
        cov["scenes_manifest_only"], cov["coverage_pct"],
    )
    if cov["scenes_degraded"]:
        logger.warning(
            "DEGRADED: %d scene(s) unreachable via the ladder — no assets "
            "downloaded for them; fixture-only coverage recorded in the "
            "manifest (spec §7, exiting 0)",
            cov["scenes_degraded"],
        )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------


def run(
    bbox,
    cache_dir,
    *,
    max_scenes: int = DEFAULT_MAX_SCENES,
    cloud_cover: float = DEFAULT_CLOUD_COVER,
    download_assets: bool = False,
) -> dict:
    """Query, record (and optionally download) scenes; write manifest.json.

    Default is manifest-only (R2): STAC query + per-band https URLs, no
    TIFFs. Unrecoverable catalog failure raises LadderError.
    """
    bbox = tuple(float(v) for v in bbox)
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    items, catalog = search_scenes(bbox, cloud_cover, max_scenes)
    if not items:
        logger.warning(
            "no scenes matched bbox=%s cloud_cover<=%s in %s — coverage 0%% "
            "(spec §7, manifest still written)",
            bbox, cloud_cover, catalog,
        )
    records = process_scenes(items, catalog, cache_dir, download_assets)
    manifest = finalize_manifest(
        cache_dir,
        records,
        {
            "bbox": list(bbox),
            "max_scenes": max_scenes,
            "cloud_cover": cloud_cover,
            "download_assets": download_assets,
            "catalog": catalog,
            "mode": "download" if download_assets else "manifest-only",
        },
    )
    _log_summary(manifest, cache_dir / "manifest.json")
    return manifest


def download_one_scene(
    bbox,
    out_dir,
    *,
    download_assets: bool = True,
    cloud_cover: float = DEFAULT_CLOUD_COVER,
) -> dict:
    """Best (lowest-cloud) scene of `bbox`: downloads it, writes the manifest.

    Raises when the scene could not be fully downloaded (degraded ladder
    outcome or transport failure) so callers cannot mistake a partial fetch
    for success.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    bbox = tuple(float(v) for v in bbox)
    items, catalog = search_scenes(bbox, cloud_cover, 1)
    if not items:
        raise RuntimeError(
            f"no scenes matched bbox={bbox} cloud_cover<={cloud_cover} "
            f"in {catalog} — nothing to download"
        )
    records = process_scenes(items, catalog, out_dir, download_assets)
    scene = records[0]
    finalize_manifest(
        out_dir,
        records,
        {
            "bbox": list(bbox),
            "max_scenes": 1,
            "cloud_cover": cloud_cover,
            "download_assets": download_assets,
            "catalog": catalog,
            "mode": "download" if download_assets else "manifest-only",
        },
    )
    if download_assets and scene["status"] != "downloaded":
        raise RuntimeError(
            f"scene {scene['scene_id']} not fully downloaded "
            f"(status={scene['status']}): {scene['reason']}"
        )
    return scene


def _load_env_file(path: Path) -> None:
    """Minimal .env reader: fills unset variables only (stdlib, no dep)."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip("'\"")


def _env_bbox() -> tuple[float, float, float, float] | None:
    raw = os.environ.get("SAUDI_REDSEA_BBOX", "").strip()
    if not raw:
        return None
    try:
        parts = [float(part) for part in raw.split(",")]
    except ValueError:
        return None
    return tuple(parts) if len(parts) == 4 else None


def _parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="download_sentinel2",
        description=(
            "Query Earth Search STAC for Sentinel-2 L2A scenes over a bbox and "
            "write $ETL_CACHE_DIR/manifest.json (per-band https COG URLs always; "
            "TIFFs only with --download-assets)."
        ),
    )
    parser.add_argument(
        "--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"), default=None,
        help="west south east north (default: $SAUDI_REDSEA_BBOX, else "
             "34.5 16.5 40.0 29.0)",
    )
    parser.add_argument(
        "--max-scenes", type=int, default=DEFAULT_MAX_SCENES,
        help=f"maximum scenes to record (default {DEFAULT_MAX_SCENES})",
    )
    parser.add_argument(
        "--cloud-cover", type=float, default=DEFAULT_CLOUD_COVER,
        help=f"max eo:cloud_cover percent (default {DEFAULT_CLOUD_COVER:g})",
    )
    parser.add_argument(
        "--download-assets", action="store_true",
        help="also download B02/B03/B04/B08 COG TIFFs (~450 MB/scene); "
             "default writes the manifest with URLs only",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    _load_env_file(Path.cwd() / ".env")
    _load_env_file(Path(__file__).resolve().parent.parent / ".env")
    if args.bbox is not None:
        bbox = tuple(args.bbox)
    else:
        bbox = _env_bbox()
        if bbox is None:
            default_env = os.environ.get("SAUDI_REDSEA_BBOX")
            if default_env:
                logger.error(
                    "invalid SAUDI_REDSEA_BBOX=%r — expected "
                    "'west,south,east,north'", default_env,
                )
                return 2
            bbox = DEFAULT_BBOX
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        logger.error(
            "invalid bbox %s — expected west < east and south < north in "
            "WGS84 ranges", bbox,
        )
        return 2
    cache_dir = Path(os.environ.get("ETL_CACHE_DIR", DEFAULT_CACHE_DIR))
    try:
        run(
            bbox,
            cache_dir,
            max_scenes=args.max_scenes,
            cloud_cover=args.cloud_cover,
            download_assets=args.download_assets,
        )
    except LadderError as exc:
        logger.error("unrecoverable: %s", exc)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
