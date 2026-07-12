#!/usr/bin/env python3
"""
build-archive.py — Photography archive manifest generator.

Drop full-size JP/PNG photos into images/archive/ and run:

    python3 tools/build-archive.py

It will, for every photo:
  • read real EXIF (camera, lens, date, exposure) when present
  • measure dimensions (for a zero-CLS masonry layout)
  • generate a lightweight grid thumbnail -> images/archive/thumb/<name>.jpg
  • generate a tiny blurred base64 placeholder (blur-up, no extra request)
and write the whole catalogue to data/archive.json, which the site fetches
at runtime. No manual importing: the gallery is whatever is in the folder.

Degrades gracefully: uses Pillow if installed (full EXIF + thumbs + blur),
otherwise falls back to macOS `sips` for dimensions only.
"""
import os, sys, json, subprocess, base64, io, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC  = os.path.join(ROOT, "images", "archive")
THUMB = os.path.join(SRC, "thumb")
OUT  = os.path.join(ROOT, "data", "archive.json")

THUMB_EDGE = 820      # longest edge of grid thumbnail (retina-friendly for ~450px cols)
THUMB_Q    = 72       # thumbnail JPEG quality
BLUR_EDGE  = 20       # longest edge of the blur-up placeholder
FORCE      = "--force" in sys.argv

try:
    from PIL import Image, ImageOps
    from PIL.ExifTags import TAGS
    HAVE_PIL = True
except Exception:
    HAVE_PIL = False


def sips_dims(path):
    try:
        out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                             capture_output=True, text=True).stdout
        w = int(re.search(r"pixelWidth:\s*(\d+)", out).group(1))
        h = int(re.search(r"pixelHeight:\s*(\d+)", out).group(1))
        return w, h
    except Exception:
        return None, None


def clean_camera(make, model):
    if not model:
        return None
    model = model.strip()
    make = (make or "").strip()
    # Avoid duplication like "NIKON CORPORATION" + "NIKON D5100"
    first = make.split()[0].lower() if make else ""
    if first and not model.lower().startswith(first):
        return f"{make.split()[0].title()} {model}"
    # Normalise common makes
    return model.replace("NIKON", "Nikon")


def frac_shutter(exposure):
    try:
        v = float(exposure)
        if v == 0:
            return None
        if v >= 1:
            return f"{v:g}s"
        return f"1/{round(1/v)}s"
    except Exception:
        return None


def read_exif(img):
    """Return a dict of the fields we care about from a Pillow image."""
    info = {"camera": None, "lens": None, "date": None, "year": None,
            "iso": None, "f": None, "focal": None, "shutter": None}
    try:
        raw = img._getexif() or {}
    except Exception:
        raw = {}
    tags = {TAGS.get(k, k): v for k, v in raw.items()}
    info["camera"] = clean_camera(tags.get("Make"), tags.get("Model"))
    lens = tags.get("LensModel")
    info["lens"] = lens.strip() if isinstance(lens, str) and lens.strip() else None
    dt = tags.get("DateTimeOriginal") or tags.get("DateTime")
    if isinstance(dt, str) and len(dt) >= 10:
        y, m, d = dt[:10].split(":")
        info["date"] = f"{y}-{m}-{d}"
        info["year"] = int(y)
    iso = tags.get("ISOSpeedRatings") or tags.get("PhotographicSensitivity")
    if isinstance(iso, (list, tuple)):
        iso = iso[0]
    info["iso"] = int(iso) if iso else None
    fn = tags.get("FNumber")
    try:
        info["f"] = round(float(fn), 1) if fn else None
    except Exception:
        info["f"] = None
    fl = tags.get("FocalLength")
    try:
        info["focal"] = round(float(fl)) if fl else None
    except Exception:
        info["focal"] = None
    info["shutter"] = frac_shutter(tags.get("ExposureTime"))
    return info


def orient(w, h):
    if not w or not h:
        return "landscape"
    r = w / h
    if r > 1.12:
        return "landscape"
    if r < 0.9:
        return "portrait"
    return "square"


def process(name):
    path = os.path.join(SRC, name)
    entry = {"file": name}
    if HAVE_PIL:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)  # honour orientation
            w, h = im.size
            entry.update(read_exif(Image.open(path)))
            # grid thumbnail
            tpath = os.path.join(THUMB, name)
            if FORCE or not os.path.exists(tpath):
                t = im.copy()
                t.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
                t.convert("RGB").save(tpath, "JPEG", quality=THUMB_Q, optimize=True, progressive=True)
            # blur-up placeholder (tiny, inlined as data URI)
            b = im.copy()
            b.thumbnail((BLUR_EDGE, BLUR_EDGE), Image.LANCZOS)
            buf = io.BytesIO()
            b.convert("RGB").save(buf, "JPEG", quality=40)
            entry["blur"] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    else:
        w, h = sips_dims(path)
        for k in ("camera", "lens", "date", "year", "iso", "f", "focal", "shutter", "blur"):
            entry[k] = None
    entry["w"], entry["h"] = w, h
    entry["ratio"] = round(w / h, 4) if w and h else 1.0
    entry["orient"] = orient(w, h)
    return entry


def main():
    if not os.path.isdir(SRC):
        print("no images/archive folder", file=sys.stderr); sys.exit(1)
    os.makedirs(THUMB, exist_ok=True)
    names = sorted(f for f in os.listdir(SRC)
                   if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")) and not f.startswith("."))
    photos = []
    for i, name in enumerate(names, 1):
        try:
            photos.append(process(name))
        except Exception as e:
            print(f"  ! skip {name}: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  ...{i}/{len(names)}")
    # facets for filters — only real, EXIF-derived taxonomies
    cameras = sorted({p["camera"] for p in photos if p.get("camera")})
    years   = sorted({p["year"] for p in photos if p.get("year")}, reverse=True)
    manifest = {
        "generated": True,
        "count": len(photos),
        "facets": {"cameras": cameras, "years": years},
        "photos": photos,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(manifest, open(OUT, "w"), separators=(",", ":"))
    kb = os.path.getsize(OUT) // 1024
    print(f"✓ {len(photos)} photos → data/archive.json ({kb} KB)")
    print(f"  cameras: {cameras or '—'}")
    print(f"  years:   {years or '—'}")
    print(f"  Pillow:  {'yes (EXIF + thumbs + blur)' if HAVE_PIL else 'no (sips dims only)'}")


if __name__ == "__main__":
    main()
