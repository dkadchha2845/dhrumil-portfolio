/* ============================================================
   PHOTOGRAPHY ARCHIVE — Interactive Digital Exhibition
   GSAP + ScrollTrigger + Lenis (globals, no modules).

   Five viewing modes driven by one mode registry:
     vertical   FLOW    — masonry, Lenis scroll, staggered reveals
     horizontal REEL    — drag/wheel filmstrip w/ momentum + skew
     grid       GRID    — explorer w/ 3D tilt + sibling dim
     circular   ORBIT   — wheel: drag/scroll rotate, inertia, snap-to-focus
     floating   SCATTER — infinite canvas: pan/zoom/drag, depth parallax

   Mode switches morph items in place (manual FLIP: viewport-space
   deltas), so layouts flow into each other — no flashing.
   Overlays follow the site's hardening rules: every close/finish
   has a wall-clock failsafe, never only a GSAP onComplete.
   ============================================================ */
(function () {
  "use strict";

  if (!window.gsap) return; // inline failsafe in HTML will reveal the page
  gsap.registerPlugin(ScrollTrigger);

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var TOUCH = window.matchMedia("(hover: none)").matches;
  var clamp = gsap.utils.clamp;

  /* ---------- DOM ---------- */
  var $ = function (s, p) { return (p || document).querySelector(s); };
  var $$ = function (s, p) { return Array.prototype.slice.call((p || document).querySelectorAll(s)); };

  var gallery      = $("#gallery");
  var wrapper      = $("#galleryWrapper");
  var orbitRing    = $("#orbitRing");
  var entrance     = $("#archiveEntrance");
  var entranceNum  = $("#entranceCount");
  var entranceBar  = $("#entranceBar");
  var header       = $("#archiveHeader");
  var headerMode   = $("#headerMode");
  var modeSelector = $("#modeSelector");
  var counterBox   = $("#archiveCounter");
  var counterCurr  = $("#counterCurrent");
  var counterTotal = $("#counterTotal");
  var hintEl       = $("#galleryHint");
  var zoomHud      = $("#zoomHud");
  var zoomVal      = $("#zoomVal");
  var orbitCaption = $("#orbitCaption");
  var orbitTitle   = $("#orbitCaptionTitle");
  var orbitMeta    = $("#orbitCaptionMeta");

  /* ---------- state ---------- */
  var images = [];
  var items = [];
  var mode = "circular";
  var switching = false;
  var booted = false;
  var lastDragAt = 0;     // wall-clock of last drag > threshold (click suppression)
  var counterIdx = -1;

  var wasDrag = function () { return performance.now() - lastDragAt < 220; };

  /* ------------------------------------------------------------
     Lenis smooth scroll (same wiring as the homepage)
  ------------------------------------------------------------ */
  var lenis = null;
  if (window.Lenis && !REDUCED) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    window.__lenis = lenis;
  }
  function scrollTop(immediate) {
    if (lenis) lenis.scrollTo(0, { immediate: immediate !== false, force: true });
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------
     Manifest
  ------------------------------------------------------------ */
  function loadImages() {
    return fetch("/data/images.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () {
        // folder convention fallback: /images/archive/pNNN.jpg
        return Array.from({ length: 60 }, function (_, i) {
          var f = "p" + String(i + 1).padStart(3, "0") + ".jpg";
          return {
            src: "/images/archive/" + f,
            thumb: "/images/archive/thumb/" + f,
            filename: f, category: "Archive",
            meta: { title: "Frame " + String(i + 1).padStart(2, "0"), camera: "", settings: "" },
            orient: "portrait",
          };
        });
      })
      .then(function (list) {
        images = list;
        counterTotal.textContent = String(images.length).padStart(2, "0");
      });
  }

  /* ------------------------------------------------------------
     Render
  ------------------------------------------------------------ */
  function renderGallery() {
    var frag = document.createDocumentFragment();
    images.forEach(function (img, i) {
      var el = document.createElement("figure");
      el.className = "gallery-item";
      el.dataset.index = i;
      el.dataset.orient = img.orient || "portrait";
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", "Open photograph — " + (img.meta.title || img.filename));
      el.innerHTML =
        '<div class="gallery-item__media"><img src="' + (img.thumb || img.src) + '" alt="' +
        (img.meta.title || img.filename) + '" loading="lazy" decoding="async"/></div>' +
        '<div class="gallery-item__glass"></div>' +
        '<figcaption class="gallery-item__info">' +
        '<span class="gallery-item__num mono">A·' + String(i + 1).padStart(2, "0") + "</span>" +
        '<span class="gallery-item__title">' + (img.meta.title || "Untitled") + "</span>" +
        '<span class="gallery-item__meta mono">' + [img.meta.camera, img.meta.settings].filter(Boolean).join(" · ") + "</span>" +
        "</figcaption>";

      var im = el.querySelector("img");
      var loaded = function () { el.classList.add("is-loaded"); };
      if (im.complete && im.naturalWidth > 0) loaded();
      else { im.addEventListener("load", loaded, { once: true }); im.addEventListener("error", loaded, { once: true }); }

      el.addEventListener("click", function () {
        if (switching || wasDrag()) return;
        MODES[mode].onItemClick ? MODES[mode].onItemClick(i, el) : openLightbox(i, el);
      });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(i, el); }
      });

      frag.appendChild(el);
    });
    wrapper.appendChild(frag);
    items = $$(".gallery-item", wrapper);
  }

  /* ------------------------------------------------------------
     Entrance — real thumbnail preload drives the counter.
     Wall-clock capped so it can never hang the page.
  ------------------------------------------------------------ */
  function runEntrance(onOpen) {
    var quick = false;
    try {
      quick = sessionStorage.getItem("dk-wipe") === "archive";
      sessionStorage.removeItem("dk-wipe");
    } catch (e) {}

    var total = Math.min(12, images.length);
    var done = 0;
    var target = 0;   // real progress 0..1
    var shown = { p: 0 };
    var opened = false;

    for (var i = 0; i < total; i++) {
      (function () {
        var im = new Image();
        var fin = function () { done++; target = done / total; };
        im.onload = fin; im.onerror = fin;
        im.src = images[i].thumb || images[i].src;
        if (im.complete) fin();
      })();
    }

    var minTime = quick ? 250 : 850;
    var t0 = performance.now();

    var tick = function () {
      var real = target;
      var elapsed = (performance.now() - t0) / minTime;
      shown.p += (Math.min(real, elapsed) - shown.p) * 0.14;
      var n = Math.round(shown.p * images.length);
      entranceNum.textContent = String(Math.min(n, images.length)).padStart(2, "0") + " / " + String(images.length);
      if (entranceBar) entranceBar.style.transform = "scaleX(" + shown.p + ")";
      if (shown.p > 0.995 && elapsed >= 1) open();
    };
    gsap.ticker.add(tick);

    function open() {
      if (opened) return;
      opened = true;
      gsap.ticker.remove(tick);
      if (entranceBar) entranceBar.style.transform = "scaleX(1)";
      entranceNum.textContent = images.length + " / " + images.length;

      var finish = function () {
        if (entrance.style.display === "none") return;
        entrance.style.display = "none";
        onOpen();
      };
      gsap.timeline({ onComplete: finish })
        .to(".archive-entrance__inner", { opacity: 0, duration: 0.3 })
        .to(".archive-entrance__panel--top", { yPercent: -101, duration: REDUCED ? 0.01 : 1, ease: "power4.inOut" }, 0.1)
        .to(".archive-entrance__panel--bottom", { yPercent: 101, duration: REDUCED ? 0.01 : 1, ease: "power4.inOut" }, 0.1);
      setTimeout(finish, 1600); // wall-clock failsafe
    }
    // absolute cap — open even if some thumbs never load
    setTimeout(open, quick ? 900 : 3000);
  }

  /* ------------------------------------------------------------
     Custom cursor (quickTo — one tween pair, not one per event)
  ------------------------------------------------------------ */
  function setupCursor() {
    var cursor = $("#cursor");
    if (!cursor || TOUCH) return;
    var xTo = gsap.quickTo(cursor, "x", { duration: 0.35, ease: "power3.out" });
    var yTo = gsap.quickTo(cursor, "y", { duration: 0.35, ease: "power3.out" });
    var label = $("#cursorLabel");
    document.addEventListener("mousemove", function (e) { xTo(e.clientX); yTo(e.clientY); });
    document.addEventListener("mouseover", function (e) {
      var t = e.target;
      var item = t.closest && t.closest(".gallery-item");
      if (item) {
        label.textContent = mode === "circular" && !item.classList.contains("is-focus") ? "FOCUS" : "VIEW";
        cursor.classList.add("is-label");
        return;
      }
      if (t.closest && t.closest("[data-hover]")) { cursor.classList.add("is-link"); return; }
      var gal = t.closest && t.closest(".gallery");
      if (gal && MODES[mode].dragHint) { label.textContent = "DRAG"; cursor.classList.add("is-label"); }
    });
    document.addEventListener("mouseout", function (e) {
      var t = e.target;
      if (t.closest && (t.closest(".gallery-item") || t.closest(".gallery"))) cursor.classList.remove("is-label");
      if (t.closest && t.closest("[data-hover]")) cursor.classList.remove("is-link");
    });
  }

  /* ------------------------------------------------------------
     HUD helpers
  ------------------------------------------------------------ */
  var hintTween = null;
  function showHint(text) {
    if (!hintEl) return;
    hintEl.textContent = text;
    if (hintTween) hintTween.kill();
    hintTween = gsap.timeline()
      .to(hintEl, { opacity: 1, duration: 0.5 })
      .to(hintEl, { opacity: 0, duration: 0.8 }, "+=3.2");
  }
  function setCounter(i) {
    if (i === counterIdx || i < 0 || i >= images.length) return;
    counterIdx = i;
    counterCurr.textContent = String(i + 1).padStart(2, "0");
  }

  /* ------------------------------------------------------------
     Shared pointer-drag engine.
     onMove receives raw dx/dy since last event; suppresses the
     click that ends a real drag (lastDragAt).
  ------------------------------------------------------------ */
  function makeDrag(el, opts) {
    var down = false, sx = 0, sy = 0, lx = 0, ly = 0, moved = 0, id = null;
    var pointers = {};

    function pdown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 2 && opts.onPinchStart) {
        down = false; el.classList.remove("is-dragging");
        opts.onPinchStart(pinchDist());
        return;
      }
      down = true; id = e.pointerId;
      sx = lx = e.clientX; sy = ly = e.clientY; moved = 0;
      el.classList.add("is-dragging");
      if (opts.onStart) opts.onStart(e);
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function pmove(e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 2 && opts.onPinch) { opts.onPinch(pinchDist()); return; }
      if (!down || e.pointerId !== id) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      moved = Math.max(moved, Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy));
      if (moved > 8) lastDragAt = performance.now();
      opts.onMove(dx, dy, e);
    }
    function pup(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2 && opts.onPinchEnd) opts.onPinchEnd();
      if (!down || e.pointerId !== id) return;
      down = false;
      el.classList.remove("is-dragging");
      if (moved > 8) lastDragAt = performance.now();
      if (opts.onEnd) opts.onEnd();
    }
    function pinchDist() {
      var k = Object.keys(pointers);
      var a = pointers[k[0]], b = pointers[k[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    el.addEventListener("pointerdown", pdown);
    el.addEventListener("pointermove", pmove);
    el.addEventListener("pointerup", pup);
    el.addEventListener("pointercancel", pup);
    return function () {
      el.removeEventListener("pointerdown", pdown);
      el.removeEventListener("pointermove", pmove);
      el.removeEventListener("pointerup", pup);
      el.removeEventListener("pointercancel", pup);
      el.classList.remove("is-dragging");
    };
  }

  /* ------------------------------------------------------------
     Delegated 3D tilt (FLOW + GRID)
  ------------------------------------------------------------ */
  function makeTilt(maxDeg) {
    if (TOUCH || REDUCED) return function () {};
    var active = null;
    function quick(el) {
      if (!el.__tilt) {
        gsap.set(el, { transformPerspective: 800 });
        el.__tilt = {
          rx: gsap.quickTo(el, "rotationX", { duration: 0.6, ease: "power3.out" }),
          ry: gsap.quickTo(el, "rotationY", { duration: 0.6, ease: "power3.out" }),
        };
      }
      return el.__tilt;
    }
    function move(e) {
      if (switching) return;
      var item = e.target.closest && e.target.closest(".gallery-item");
      if (item !== active && active) { var q0 = quick(active); q0.rx(0); q0.ry(0); }
      active = item;
      if (!item) return;
      var r = item.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      var q = quick(item);
      q.rx(-py * maxDeg); q.ry(px * maxDeg);
    }
    function leave() {
      if (active) { var q = quick(active); q.rx(0); q.ry(0); active = null; }
    }
    wrapper.addEventListener("mousemove", move);
    wrapper.addEventListener("mouseleave", leave);
    return function () {
      wrapper.removeEventListener("mousemove", move);
      wrapper.removeEventListener("mouseleave", leave);
      leave();
    };
  }

  /* ------------------------------------------------------------
     Scroll-mode counter (item nearest viewport centre)
  ------------------------------------------------------------ */
  function makeScrollCounter() {
    var t = 0;
    var handler = function () {
      var now = performance.now();
      if (now - t < 140) return;
      t = now;
      var mid = window.innerHeight / 2, best = -1, bd = Infinity;
      for (var i = 0; i < items.length; i++) {
        var r = items[i].getBoundingClientRect();
        if (r.bottom < -60 || r.top > window.innerHeight + 60) continue;
        var d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) setCounter(best);
    };
    if (lenis) { lenis.on("scroll", handler); }
    else window.addEventListener("scroll", handler, { passive: true });
    handler();
    return function () {
      if (lenis) lenis.off("scroll", handler);
      else window.removeEventListener("scroll", handler);
    };
  }

  /* ------------------------------------------------------------
     Reveal batches (FLOW + GRID) — reveal once, remember per item
  ------------------------------------------------------------ */
  function makeReveals(fromVars) {
    var unseen = items.filter(function (el) { return !el.dataset.seen; });
    if (!unseen.length) return [];
    unseen.forEach(function (el) { gsap.set(el, { opacity: 0 }); });
    return ScrollTrigger.batch(unseen, {
      start: "top 97%",
      once: true,
      batchMax: 10,
      onEnter: function (batch) {
        batch.forEach(function (el) { el.dataset.seen = "1"; });
        gsap.fromTo(batch, fromVars, {
          opacity: 1, y: 0, scale: 1, rotationZ: 0,
          duration: REDUCED ? 0.01 : 1.05,
          ease: "power3.out",
          stagger: 0.08,
          overwrite: "auto",
          clearProps: "rotationZ",
        });
      },
    });
  }

  /* ============================================================
     MODE REGISTRY
     layout(): position items instantly, return per-item finals
     mount():  bind interaction; unmount(): cleanup listeners/STs
     ============================================================ */
  var MODES = {};

  /* ================== FLOW (vertical masonry) ================== */
  MODES.vertical = {
    label: "FLOW", scroll: true, dragHint: false,
    hint: "SCROLL · CLICK TO VIEW",
    layout: function () { return null; },
    mount: function () {
      var cleanups = [];
      if (lenis) lenis.start();
      document.body.classList.remove("is-fixed-mode");
      var sts = makeReveals({ opacity: 0, y: 76, rotationZ: function () { return gsap.utils.random(-1.6, 1.6); } });
      cleanups.push(function () { sts.forEach(function (st) { st.kill(); }); });
      cleanups.push(makeTilt(3.5));
      cleanups.push(makeScrollCounter());
      ScrollTrigger.refresh();
      return cleanups;
    },
  };


  /* ================== ORBIT (circular wheel) ================== */
  MODES.circular = {
    label: "ORBIT", scroll: false, dragHint: true,
    hint: "DRAG TO ROTATE · PINCH TO ZOOM",
    geo: null,
    state: { rot: 0, tz: 1, z: 1 },
    layout: function () {
      var W = window.innerWidth;
      var H = gallery.offsetHeight || (window.innerHeight - 96);
      var iw = items[0] ? items[0].offsetWidth || 160 : 160;
      var ih = items[0] ? items[0].offsetHeight || iw * 4 / 3 : 213;
      var gap = 40;
      
      var need = (items.length * (iw + gap)) / (2 * Math.PI);
      var largeR = Math.max(need, H * 0.9);
      var smallR = Math.min(W, H) * 0.30;
      var step = 360 / items.length;
      
      this.geo = { largeR: largeR, smallR: smallR, step: step, W: W, H: H, iw: iw, ih: ih };
      
      var focus = this.focusIdx || 0;
      this.state.rot = -focus * step;

      if (orbitRing) orbitRing.style.display = "block";
      this.place(false, true); 
      return items.map(function (el) {
        return { x: gsap.getProperty(el, "x"), y: gsap.getProperty(el, "y"), rot: gsap.getProperty(el, "rotationZ"), scale: gsap.getProperty(el, "scale") };
      });
    },
    place: function (withFocusFx, forceAll) {
      var g = this.geo, rot = this.state.rot, step = g.step;
      var tz = this.state.z; // smooth interpolated zoom
      
      // Interpolate radius and center Y based on zoom
      // tz=1 -> zoomed in (largeR, cy below screen)
      // tz=0.3 -> zoomed out (smallR, cy center of screen)
      var t = (tz - 0.3) / 0.7;
      var galleryTop = gallery.getBoundingClientRect().top || 96;
      var trueCenterY = (window.innerHeight / 2) - galleryTop;
      
      var currentR = g.smallR + (g.largeR - g.smallR) * t;
      var cyLarge = trueCenterY + g.largeR; // Focused item at true center
      var cySmall = trueCenterY; // Wheel centered at true center
      var currentCy = cySmall + (cyLarge - cySmall) * t;
      var cx = g.W / 2;
      
      var baseScale = tz;

      var best = 0, bd = Infinity;
      for (var i = 0; i < items.length; i++) {
        var deg = i * step + rot; // 0 = focused (top of wheel)
        var norm = ((deg % 360) + 540) % 360 - 180; // -180..180
        var ad = Math.abs(norm);
        if (ad < bd) { bd = ad; best = i; }
        
        // When zoomed in, cull back half of circle. When zoomed out, show all.
        var vis = (ad < 100) || (tz < 0.6) || forceAll;
        items[i].style.visibility = vis ? "" : "hidden";
        if (!vis) continue; 
        
        var ang = (deg - 90) * Math.PI / 180; // -90 is top of wheel
        var x = cx + Math.cos(ang) * currentR - g.iw / 2;
        var y = currentCy + Math.sin(ang) * currentR - g.ih / 2;
        
        var focusT = (withFocusFx && tz > 0.8) ? clamp(0, 1, 1 - ad / (step * 1.4)) : 0;
        var isHov = items[i].classList.contains("is-hovered");
        items[i]._hov = items[i]._hov || 0;
        items[i]._hov += ((isHov ? 1 : 0) - items[i]._hov) * 0.15;
        
        gsap.set(items[i], {
          x: x, y: y, z: 0,
          rotationY: 0,
          rotationZ: deg, // Rotate in 2D
          scale: (baseScale + focusT * 0.12) + items[i]._hov * 0.1 * baseScale,
          zIndex: Math.round(100 - ad + items[i]._hov * 50),
        });
        items[i].classList.toggle("is-focus", withFocusFx && ad < step * 0.55 && tz > 0.8);
      }
      // Rotate the background ring to match the wheel (only visible when zoomed out)
      if (orbitRing) {
        gsap.set(orbitRing, { 
          x: cx - g.largeR, y: currentCy - g.largeR, 
          width: g.largeR * 2, height: g.largeR * 2,
          rotation: rot,
          scale: currentR / g.largeR
        });
      }
      return best;
    },
    setFocusCaption: function (i, animate) {
      if (i === this.focusIdx) return;
      this.focusIdx = i;
      setCounter(i);
      var im = images[i];
      if (!im) return; 
      orbitTitle.textContent = im.meta.title || "Untitled";
      orbitMeta.textContent = [im.category, im.meta.camera, im.meta.settings].filter(Boolean).join(" · ");
      if (animate && !REDUCED) gsap.fromTo(orbitCaption, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", overwrite: true });
      else gsap.set(orbitCaption, { opacity: 1, y: 0 });
    },
    mount: function () {
      var self = this;
      var cleanups = [];
      if (lenis) lenis.stop();
      document.body.classList.add("is-fixed-mode");
      if (zoomHud) zoomHud.classList.add("is-visible");
      self.focusIdx = undefined;

      orbitCaption.classList.add("is-visible");
      if (orbitRing) gsap.to(orbitRing, { opacity: 0.15, duration: 0.8 });
      var focus = self.place(true);
      self.setFocusCaption(focus, true);

      var velocity = 0, coasting = false, pinchZ0 = 1, pinchD0 = 0;
      var degPerPx = 180 / (Math.PI * self.geo.largeR); // base drag sensitivity

      var autoSpeed = -0.06;
      var tickFn = function () {
        if (typeof xlbOpen !== 'undefined' && xlbOpen) return;
        
        // Smooth zoom interpolation
        self.state.z += (self.state.tz - self.state.z) * 0.12;
        
        if (coasting) {
          self.state.rot += velocity;
          velocity *= 0.94;
          if (Math.abs(velocity) < 0.02) coasting = false;
        } else {
          // Cinematic continuous rotation
          self.state.rot += autoSpeed;
        }
        
        // Only show caption when zoomed in
        var opacityT = clamp(0, 1, (self.state.z - 0.7) / 0.3);
        orbitCaption.style.opacity = opacityT;
        
        self.setFocusCaption(self.place(true), false);
      };
      gsap.ticker.add(tickFn);
      cleanups.push(function () { gsap.ticker.remove(tickFn); });

      function setZoom(z) {
        self.state.tz = clamp(0.3, 1.0, z);
        if (zoomVal) zoomVal.textContent = Math.round(self.state.tz * 100) + "%";
      }
      self.setZoom = setZoom;
      setZoom(1); // default zoomed in

      var lastDx = 0;
      var killDrag = makeDrag(gallery, {
        onStart: function () { velocity = 0; lastDx = 0; coasting = false; },
        onMove: function (dx, dy) {
          self.state.rot += dx * degPerPx * (1 / self.state.z); 
          lastDx = dx;
          self.setFocusCaption(self.place(true), true);
        },
        onEnd: function () {
          velocity = clamp(-3.2, 3.2, lastDx * degPerPx * 1.6 * (1 / self.state.z));
          if (Math.abs(velocity) > 0.04 && !REDUCED) coasting = true;
        },
        onPinchStart: function (d) { coasting = false; pinchD0 = d; pinchZ0 = self.state.tz; },
        onPinch: function (d) { if (pinchD0 > 0) setZoom(pinchZ0 * (d / pinchD0)); },
        onPinchEnd: function () { pinchD0 = 0; },
      });
      cleanups.push(killDrag);

      var wheel = function (e) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { setZoom(self.state.tz * (1 - e.deltaY * 0.0035)); return; }
        var d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        self.state.rot -= clamp(-26, 26, d * 0.045 * (1 / self.state.z));
        self.setFocusCaption(self.place(true), false);
        velocity = clamp(-1, 1, -d * 0.02 * (1 / self.state.z));
        coasting = true;
      };
      gallery.addEventListener("wheel", wheel, { passive: false });
      cleanups.push(function () { gallery.removeEventListener("wheel", wheel); });

      var keys = function (e) {
        if (xlbOpen || switching) return;
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        var dir = e.key === "ArrowRight" ? 1 : -1;
        var g = self.geo;
        gsap.to(self.state, {
          rot: (Math.round(self.state.rot / g.step) - dir) * g.step,
          duration: 0.65, ease: "power3.out", overwrite: true,
          onUpdate: function () { self.setFocusCaption(self.place(true), true); },
        });
      };
      window.addEventListener("keydown", keys);
      cleanups.push(function () { window.removeEventListener("keydown", keys); });

      var dbl = function (e) {
        if (e.target.closest && e.target.closest(".gallery-item")) return;
        var cur = self.state.tz > 0.6 ? 0.3 : 1;
        setZoom(cur);
      };
      gallery.addEventListener("dblclick", dbl);
      cleanups.push(function () { gallery.removeEventListener("dblclick", dbl); });

      var zin = $("#zoomIn"), zout = $("#zoomOut");
      var zi = function () { setZoom(self.state.tz + 0.2); }, zo = function () { setZoom(self.state.tz - 0.2); };
      if (zin) zin.addEventListener("click", zi);
      if (zout) zout.addEventListener("click", zo);
      cleanups.push(function () {
        if (zin) zin.removeEventListener("click", zi);
        if (zout) zout.removeEventListener("click", zo);
      });

      var onResize = function () { self.layout(); self.setFocusCaption(self.place(true), false); };
      window.addEventListener("resize", onResize);
      cleanups.push(function () { window.removeEventListener("resize", onResize); });

      cleanups.push(function () {
        if (zoomHud) zoomHud.classList.remove("is-visible");
        orbitCaption.classList.remove("is-visible");
        if (orbitRing) gsap.to(orbitRing, { opacity: 0, duration: 0.3 });
        items.forEach(function (el) { el.classList.remove("is-focus"); el.style.visibility = ""; });
      });
      return cleanups;
    },
  };

  /* ================== SCATTER (floating canvas) ================== */
  MODES.floating = {
    label: "SCATTER", scroll: false, dragHint: true,
    hint: "DRAG · SCROLL TO PAN · PINCH TO ZOOM",
    world: null,
    layout: function () {
      var W = window.innerWidth;
      var H = gallery.offsetHeight || (window.innerHeight - 96);
      
      var iw = items[0] ? items[0].offsetWidth || 220 : 220;
      var ih = items[0] ? items[0].offsetHeight || 280 : 280;
      var gap = 40;
      
      var cols = Math.ceil(Math.sqrt(items.length * (W / H)));
      var rows = Math.ceil(items.length / cols);
      
      var aw = cols * (iw + gap);
      var ah = rows * (ih + gap);
      
      var ox = -(aw - W) / 2, oy = -(ah - H) / 2;

      var cells = [];
      for (var c = 0; c < cols * rows; c++) cells.push(c);
      var seed = 7;
      var rand = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      for (var s = cells.length - 1; s > 0; s--) {
        var j = Math.floor(rand() * (s + 1));
        var tmp = cells[s]; cells[s] = cells[j]; cells[j] = tmp;
      }

      var nodes = items.map(function (el, i) {
        var cell = cells[i];
        // Clean staggered grid layout
        var col = cell % cols;
        var row = Math.floor(cell / cols);
        
        var gx = col * (iw + gap);
        var gy = row * (ih + gap);
        
        // Stagger every other column slightly for an organic feel
        if (col % 2 !== 0) gy += (ih + gap) / 2;

        return {
          el: el,
          iw: iw, ih: ih,
          bx: ox + gx, by: oy + gy,
          z: 1, par: 1, rot: 0, scale: 1,
          sp: 0, ph: 0,
          qx: gsap.quickSetter(el, "x", "px"),
          qy: gsap.quickSetter(el, "y", "px"),
          qr: gsap.quickSetter(el, "rotation", "deg"),
        };
      });
      this.world = {
        nodes: nodes, aw: aw, ah: ah, ox: ox, oy: oy, W: W, H: H,
        panX: 0, panY: 0, tx: 0, ty: 0, z: 1, tz: 1,
      };
      gsap.set(wrapper, { transformOrigin: (W / 2) + "px " + (H / 2) + "px", scale: 1 });

      var finals = [];
      var wld = this.world;
      nodes.forEach(function (n, i) {
        var p = MODES.floating.project(n, wld);
        gsap.set(n.el, {
          x: p.x, y: p.y, rotation: n.rot, scale: n.scale,
          zIndex: 100,
        });
        n.el.style.filter = "";
        finals[i] = { x: p.x, y: p.y, rot: n.rot, scale: n.scale };
      });
      if (zoomVal) zoomVal.textContent = "100%";
      return finals;
    },
    project: function (n, w) {
      // world → screen wrapped into the world torus
      var x = n.bx + w.panX * n.par;
      var y = n.by + w.panY * n.par;
      x = x - w.aw * Math.floor((x - w.ox) / w.aw);
      y = y - w.ah * Math.floor((y - w.oy) / w.ah);
      return { x: x - n.iw / 2, y: y - n.ih / 2 };
    },
    mount: function () {
      var self = this;
      var w = self.world;
      var cleanups = [];
      if (lenis) lenis.stop();
      document.body.classList.add("is-fixed-mode");
      if (zoomHud) zoomHud.classList.add("is-visible");

      var vx = 0, vy = 0, isDown = false, pinchZ0 = 1, pinchD0 = 0;

      var tickFn = function () {
        if (!isDown) {
          w.tx += vx; w.ty += vy;
          vx *= 0.93; vy *= 0.93;
          if (Math.abs(vx) < 0.05) vx = 0;
          if (Math.abs(vy) < 0.05) vy = 0;
          
          // Cinematic auto-drift when not interacting
          w.tx -= 0.6;
          w.ty -= 0.4;
        }
        w.panX += (w.tx - w.panX) * (REDUCED ? 1 : 0.1);
        w.panY += (w.ty - w.panY) * (REDUCED ? 1 : 0.1);
        w.z += (w.tz - w.z) * 0.12;
        gsap.set(wrapper, { scale: w.z });

        var m = 260; // cull margin
        for (var i = 0; i < w.nodes.length; i++) {
          var n = w.nodes[i];
          var p = self.project(n, w);
          var sx = p.x, sy = p.y;
          var off = sx < -n.iw - m || sx > w.W + m || sy < -n.ih - m || sy > w.H + m;
          n.el.style.visibility = off ? "hidden" : "";
          if (off) continue;
          n.qx(sx); n.qy(sy); n.qr(n.rot);
        }
        // counter: nearest to screen centre (cheap — uses computed positions)
        if ((tickFn.n = (tickFn.n || 0) + 1) % 14 === 0) {
          var best = -1, bd = Infinity;
          for (var k = 0; k < w.nodes.length; k++) {
            var nn = w.nodes[k];
            if (nn.el.style.visibility === "hidden") continue;
            var pp = self.project(nn, w);
            var d = Math.hypot(pp.x + nn.iw / 2 - w.W / 2, pp.y + nn.ih / 2 - w.H / 2);
            if (d < bd) { bd = d; best = k; }
          }
          if (best >= 0) setCounter(parseInt(w.nodes[best].el.dataset.index, 10));
        }
      };
      gsap.ticker.add(tickFn);
      cleanups.push(function () { gsap.ticker.remove(tickFn); });

      var lastDx = 0, lastDy = 0;
      var killDrag = makeDrag(gallery, {
        onStart: function () { isDown = true; vx = vy = 0; lastDx = lastDy = 0; },
        onMove: function (dx, dy) {
          w.tx += dx / w.z; w.ty += dy / w.z;
          lastDx = dx; lastDy = dy;
        },
        onEnd: function () {
          isDown = false;
          if (!REDUCED) { vx = clamp(-70, 70, lastDx * 1.7) / w.z; vy = clamp(-70, 70, lastDy * 1.7) / w.z; }
        },
        onPinchStart: function (d) { isDown = false; pinchD0 = d; pinchZ0 = w.tz; },
        onPinch: function (d) { if (pinchD0 > 0) setZoom(pinchZ0 * (d / pinchD0)); },
        onPinchEnd: function () { pinchD0 = 0; },
      });
      cleanups.push(killDrag);

      function setZoom(z) {
        w.tz = clamp(0.6, 1.7, z);
        if (zoomVal) zoomVal.textContent = Math.round(w.tz * 100) + "%";
      }
      self.setZoom = setZoom;

      var wheel = function (e) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { setZoom(w.tz * (1 - e.deltaY * 0.0035)); return; }
        w.tx -= e.deltaX / w.z;
        w.ty -= e.deltaY / w.z;
        vx = vy = 0;
      };
      gallery.addEventListener("wheel", wheel, { passive: false });
      cleanups.push(function () { gallery.removeEventListener("wheel", wheel); });

      var dbl = function (e) {
        if (e.target.closest && e.target.closest(".gallery-item")) return;
        setZoom(w.tz > 1.15 ? 1 : 1.4);
      };
      gallery.addEventListener("dblclick", dbl);
      cleanups.push(function () { gallery.removeEventListener("dblclick", dbl); });

      var zin = $("#zoomIn"), zout = $("#zoomOut");
      var zi = function () { setZoom(w.tz + 0.2); }, zo = function () { setZoom(w.tz - 0.2); };
      if (zin) zin.addEventListener("click", zi);
      if (zout) zout.addEventListener("click", zo);
      cleanups.push(function () {
        if (zin) zin.removeEventListener("click", zi);
        if (zout) zout.removeEventListener("click", zo);
      });

      var keys = function (e) {
        if (xlbOpen || switching) return;
        var step = 120;
        if (e.key === "ArrowRight") w.tx -= step;
        else if (e.key === "ArrowLeft") w.tx += step;
        else if (e.key === "ArrowDown") w.ty -= step;
        else if (e.key === "ArrowUp") w.ty += step;
        else if (e.key === "+" || e.key === "=") setZoom(w.tz + 0.15);
        else if (e.key === "-") setZoom(w.tz - 0.15);
      };
      window.addEventListener("keydown", keys);
      cleanups.push(function () { window.removeEventListener("keydown", keys); });

      var onResize = function () { self.layout(); };
      window.addEventListener("resize", onResize);
      cleanups.push(function () { window.removeEventListener("resize", onResize); });

      cleanups.push(function () {
        zoomHud.classList.remove("is-visible");
        gsap.set(wrapper, { scale: 1 });
        items.forEach(function (el) { el.style.visibility = ""; el.style.filter = ""; });
      });
      return cleanups;
    },
  };

  /* ------------------------------------------------------------
     Mode switching — manual FLIP in viewport space.
     Items morph from where they visually are to where the next
     layout puts them. No flashing, ever.
  ------------------------------------------------------------ */
  var modeCleanups = [];

  function unmountCurrent() {
    modeCleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
    modeCleanups = [];
  }

  function mountCurrent() {
    modeCleanups = MODES[mode].mount() || [];
    showHint(MODES[mode].hint);
    headerMode.textContent = MODES[mode].label;
  }

  function switchMode(next, instant) {
    if (switching || next === mode || !MODES[next]) return;
    switching = true;
    gallery.classList.add("is-switching");

    $$(".mode-btn").forEach(function (b) {
      var on = b.dataset.mode === next;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    // 1 — capture current visual state (viewport space)
    var vh = window.innerHeight;
    var before = items.map(function (el) {
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      return {
        r: r,
        rot: gsap.getProperty(el, "rotation") || 0,
        vis: r.bottom > -100 && r.top < vh + 100 && r.right > -100 && r.left < window.innerWidth + 100 &&
             cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.03,
      };
    });

    unmountCurrent();
    gsap.killTweensOf(items);

    // 2 — jump to the new layout instantly
    mode = next;
    gallery.dataset.mode = next;
    scrollTop(true);
    items.forEach(function (el) {
      el.style.visibility = ""; el.style.filter = "";
      el.classList.remove("is-focus", "is-hovered");
    });
    gsap.set(items, { clearProps: "transform,opacity,zIndex" });
    gsap.set(wrapper, { clearProps: "transform" });
    var finals = MODES[next].layout() || items.map(function () { return null; });

    // 3 — morph every visible frame from old rect → new rect
    var reduced = REDUCED || instant;
    var tl = gsap.timeline();
    items.forEach(function (el, i) {
      var b = before[i];
      var a = el.getBoundingClientRect();
      var f = finals[i] || { x: 0, y: 0, rot: 0, scale: 1 };
      var aVis = a.bottom > -100 && a.top < vh + 100 && a.right > -100 && a.left < window.innerWidth + 100;

      if (!b.vis && !aVis) { gsap.set(el, { opacity: 1 }); return; } // scroll-mode reveals re-hide unseen ones on mount
      if (!b.vis) {
        el.dataset.seen = "1";
        tl.fromTo(el, { opacity: 0, scale: f.scale * 0.86 },
          { opacity: 1, scale: f.scale, duration: reduced ? 0.01 : 0.75, ease: "power3.out", immediateRender: true },
          reduced ? 0 : 0.28 + (i % 14) * 0.028);
        return;
      }
      el.style.visibility = ""; // fly even if the target layout culls this slot — the mode re-culls on mount
      var dx = (b.r.left + b.r.width / 2) - (a.left + a.width / 2);
      var dy = (b.r.top + b.r.height / 2) - (a.top + a.height / 2);
      var s = a.width > 0 ? b.r.width / a.width : 1;
      tl.fromTo(el,
        { x: f.x + dx, y: f.y + dy, rotation: b.rot, scale: f.scale * s, opacity: 1 },
        { x: f.x, y: f.y, rotation: f.rot, scale: f.scale, duration: reduced ? 0.01 : 1.05, ease: "expo.inOut", immediateRender: true },
        reduced ? 0 : i * 0.0055);
    });

    // 4 — hand over to the new mode (wall-clock finish, per house rules)
    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      gallery.classList.remove("is-switching");
      mountCurrent();
      switching = false;
    };
    tl.eventCallback("onComplete", finish);
    setTimeout(finish, reduced ? 120 : 1900);
  }

  function setupModeSelector() {
    $$(".mode-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { switchMode(btn.dataset.mode); });
    });
  }

  /* ------------------------------------------------------------
     Header scroll state
  ------------------------------------------------------------ */
  function setupHeaderScroll() {
    var apply = function (y) { header.classList.toggle("is-scrolled", y > 60); };
    if (lenis) lenis.on("scroll", function (l) { apply(l.scroll || 0); });
    else window.addEventListener("scroll", function () { apply(window.scrollY); }, { passive: true });
  }

  /* ------------------------------------------------------------
     LIGHTBOX (.xlb) — clone flight from the clicked frame
  ------------------------------------------------------------ */
  var xlb = $("#xlb");
  var xlbBg = $("#xlbBg");
  var xlbImg = $("#xlbImg");
  var xlbTitle = $("#xlbTitle");
  var xlbInfo = $("#xlbInfo");
  var xlbStage = $("#xlbStage");
  var xlbHeader = $(".xlb__header");
  var xlbCounter = $("#xlbCounter");
  var xlbOpen = false;
  var xlbIdx = -1;

  function fitStageRect(ratio) {
    var maxW = window.innerWidth * (window.innerWidth < 768 ? 0.88 : 0.78);
    var maxH = window.innerHeight - (window.innerWidth < 768 ? 170 : 210);
    var w = maxW, h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    return { w: w, h: h, x: (window.innerWidth - w) / 2, y: 90 + (maxH - h) / 2 };
  }

  function xlbFill(i) {
    var im = images[i];
    xlbImg.src = im.src;
    xlbImg.alt = im.meta.title || im.filename;
    xlbTitle.textContent = im.meta.title || "Untitled";
    xlbInfo.textContent = [im.category, im.meta.camera, im.meta.settings, im.filename].filter(Boolean).join(" · ");
    xlbCounter.textContent = String(i + 1).padStart(2, "0") + " / " + String(images.length).padStart(2, "0");
  }

  function preloadFull(i) {
    var im = new Image();
    im.src = images[((i % images.length) + images.length) % images.length].src;
  }

  function openLightbox(i, originItem) {
    if (xlbOpen) return;
    xlbOpen = true;
    xlbIdx = i;
    xlbFill(i);
    xlb.classList.add("is-open");
    xlb.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    if (lenis) lenis.stop();

    gsap.killTweensOf([xlbBg, xlbStage, xlbHeader, xlbCounter]);
    $$(".xlb-flight").forEach(function (n) { n.remove(); });
    gsap.fromTo(xlbBg, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" });
    gsap.to([xlbHeader, xlbCounter], { opacity: 1, duration: 0.45, delay: 0.25 });
    gsap.to($$(".xlb__arrow"), { opacity: 1, duration: 0.45, delay: 0.35 });

    var thumb = originItem && originItem.querySelector("img");
    if (thumb && !REDUCED) {
      var r = thumb.getBoundingClientRect();
      var ratio = thumb.naturalWidth > 0 ? thumb.naturalWidth / thumb.naturalHeight : r.width / Math.max(r.height, 1);
      var fit = fitStageRect(ratio);
      var rot = gsap.getProperty(originItem, "rotation") || 0;

      var clone = document.createElement("img");
      clone.src = thumb.currentSrc || thumb.src;
      clone.className = "xlb-flight";
      clone.setAttribute("aria-hidden", "true");
      gsap.set(clone, { left: r.left, top: r.top, width: r.width, height: r.height, rotation: rot });
      document.body.appendChild(clone);

      gsap.set(xlbStage, { opacity: 0 });
      gsap.to(clone, { left: fit.x, top: fit.y, width: fit.w, height: fit.h, rotation: 0, duration: 0.85, ease: "expo.inOut" });

      var settle = function () {
        gsap.to(xlbStage, { opacity: 1, duration: 0.4, ease: "power2.out" });
        gsap.to(clone, { opacity: 0, duration: 0.35, delay: 0.1, onComplete: function () { clone.remove(); } });
      };
      var fallback = setTimeout(settle, 1600);
      var ready = xlbImg.decode ? xlbImg.decode().catch(function () {}) : Promise.resolve();
      Promise.resolve(ready).then(function () {
        setTimeout(function () { clearTimeout(fallback); settle(); }, 870);
      });
    } else {
      gsap.fromTo(xlbStage, { opacity: 0, scale: 0.94, y: 22 }, { opacity: 1, scale: 1, y: 0, duration: 0.65, ease: "power3.out", delay: 0.1 });
    }
    preloadFull(i + 1); preloadFull(i - 1);
  }

  function closeLightbox() {
    if (!xlbOpen) return;
    xlbOpen = false;
    $$(".xlb-flight").forEach(function (n) { n.remove(); });
    var finish = function () {
      if (!xlb.classList.contains("is-open")) return;
      xlb.classList.remove("is-open");
      xlb.setAttribute("aria-hidden", "true");
      document.documentElement.style.overflow = "";
      xlbImg.src = "";
      if (lenis && MODES[mode].scroll && booted) lenis.start();
    };
    gsap.killTweensOf([xlbBg, xlbStage]);
    gsap.to(xlbStage, { opacity: 0, scale: 0.96, duration: 0.32, ease: "power2.in" });
    gsap.to([xlbHeader, xlbCounter].concat($$(".xlb__arrow")), { opacity: 0, duration: 0.25 });
    gsap.to(xlbBg, { opacity: 0, duration: 0.4, delay: 0.08, onComplete: finish });
    setTimeout(finish, 700); // wall-clock failsafe — rAF throttling must never wedge it
  }

  function navLightbox(dir) {
    xlbIdx = (xlbIdx + dir + images.length) % images.length;
    var idx = xlbIdx;
    gsap.to(xlbStage, {
      opacity: 0, x: dir * -46, duration: 0.24, ease: "power2.in",
      onComplete: function () {
        xlbFill(idx);
        gsap.fromTo(xlbStage, { opacity: 0, x: dir * 46 }, { opacity: 1, x: 0, duration: 0.4, ease: "power3.out" });
      },
    });
    preloadFull(xlbIdx + dir);
  }

  function setupLightbox() {
    $("#xlbClose").addEventListener("click", closeLightbox);
    xlbBg.addEventListener("click", closeLightbox);
    $("#xlbPrev").addEventListener("click", function () { navLightbox(-1); });
    $("#xlbNext").addEventListener("click", function () { navLightbox(1); });
    xlbImg.addEventListener("click", function () { if (xlbImg.src) window.open(xlbImg.src, "_blank"); });

    window.addEventListener("keydown", function (e) {
      if (!xlbOpen) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") navLightbox(1);
      else if (e.key === "ArrowLeft") navLightbox(-1);
    });

    // swipe
    var tx = 0, ty = 0;
    xlbStage.addEventListener("touchstart", function (e) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    xlbStage.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - tx;
      var dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) navLightbox(dx > 0 ? -1 : 1);
      else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) closeLightbox();
    }, { passive: true });
  }

  /* ------------------------------------------------------------
     Wipe back to the portfolio
  ------------------------------------------------------------ */
  function setupWipeOut() {
    var wipe = $("#wipe");
    $$('a[href="/"], a[href="/index.html"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var go = function () { window.location.href = a.getAttribute("href"); };
        if (REDUCED || !wipe) { go(); return; }
        try { sessionStorage.setItem("dk-wipe", "home"); } catch (err) {}
        wipe.classList.add("is-active");
        gsap.timeline()
          .to(".wipe__panel--top", { y: "0%", duration: 0.65, ease: "power4.inOut" }, 0)
          .to(".wipe__panel--bottom", { y: "0%", duration: 0.65, ease: "power4.inOut" }, 0)
          .to(".wipe__label", { opacity: 1, duration: 0.3 }, 0.3)
          .call(go, null, 0.78);
        setTimeout(go, 1300); // navigation must never be lost to a dead tween
      });
    });
  }

  /* ------------------------------------------------------------
     BOOT
  ------------------------------------------------------------ */
  function init() {
    loadImages().then(function () {
      renderGallery();
      gsap.set(items, { opacity: 0 }); // no flash behind the entrance
      setupCursor();
      setupModeSelector();
      setupLightbox();
      setupHeaderScroll();
      setupWipeOut();

      runEntrance(function () {
        booted = true;
        window.__archiveReady = true;
        if (window.__archiveFailsafe) { clearTimeout(window.__archiveFailsafe); window.__archiveFailsafe = null; }
        // CSS transform is translate(-50%, 24px); tween y only — GSAP keeps the parsed centering x
        gsap.to(modeSelector, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" });
        gsap.to(counterBox, { opacity: 1, duration: 0.8, delay: 0.25 });
        setCounter(0);
        gallery.dataset.mode = mode;
        MODES[mode].layout();
        mountCurrent();
        if (mode !== "vertical") {
          gsap.to(items, { opacity: 1, duration: 1.2, stagger: 0.02, ease: "power2.out" });
        }
      });
    });
  }

  /* verification / tooling hook */
  window.__archive = {
    switchMode: switchMode,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox,
    get mode() { return mode; },
    get switching() { return switching; },
    get items() { return items; },
    MODES: MODES,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
