# Dhrumil Kadchha — Portfolio

Single-page portfolio for a UI/UX & product designer and photographer. Dark editorial
design with an orange accent, cinematic GSAP motion, a WebGL particle-wave hero,
real project case studies, and a photography archive (contact sheet + draggable
film reel) built from real photos with real EXIF.

**Stack:** vanilla HTML / CSS / JS (no build step) · GSAP + ScrollTrigger · Lenis smooth
scroll · Three.js — all via CDN.
**Fonts:** Clash Display (Fontshare) · Space Grotesk · Instrument Serif · Space Mono.

---

## Run locally

```bash
python3 -m http.server 4173 --directory .
# → http://localhost:4173
```

A server is required (not `file://`): `js/main.js` is an ES module. Note the server
caches — hard-refresh (⌘⇧R) after edits.

---

## Structure

```
├── index.html            # all sections + case-study / lightbox overlays
├── css/style.css         # design system + components
├── js/main.js            # motion engine (see below)
├── data/archive.json     # generated photo catalogue (EXIF, dims, blur placeholders)
├── images/
│   ├── work/             # project mockups (Blends, Traffic AI, Meteor Madness, Blends App)
│   ├── about/portrait.jpg
│   ├── og/og-cover.jpg
│   └── archive/          # full-size photos (+ thumb/ auto-generated)
└── tools/build-archive.py
```

## Photography archive

Drop photos into `images/archive/` and run `python3 tools/build-archive.py`
(uses Pillow if present; falls back to `sips`). It extracts EXIF, measures
dimensions, writes grid thumbnails + blur placeholders, and regenerates
`data/archive.json`. The contact-sheet and film-reel markup in `index.html`
is generated from that catalogue (see git-less backups before regenerating).

## Motion / interaction map (`js/main.js`)

| System | Notes |
|---|---|
| Preloader + intro | char-split reveal; wall-clock failsafe — never stuck blank |
| Fit-to-width titles | `fitHeadlines()` — hero/section/contact never clip |
| WebGL hero | particle wave; GSAP quickTo mouse springs (fast bump + lagging wake), click ripple ring, camera dolly-in, scroll depth parallax |
| Sticky header | always visible; frosted glass + hairline after 40px; orange scroll-progress bar |
| Work | pinned horizontal track; 3D card tilt; case-study overlay per project |
| Archive | scatter→assemble contact sheet (function-based `fromTo`, resize-proof, pinned) + inertial draggable reel; every photo opens the lightbox via a **FLIP** clone flight |
| Lightbox | full-res + EXIF strip, keyboard ←/→/Esc; all overlays close with a wall-clock failsafe (rAF-throttle-proof) |
| Contact | magnetic email button + detail grid (contact / availability / socials / live IST clock) |

Reduced-motion is respected throughout (`prefers-reduced-motion`).
