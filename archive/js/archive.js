/* ============================================================
   ARCHIVE — Interactive Gallery Exhibition
   Pure GSAP (no ES modules). Globals: gsap, ScrollTrigger, Draggable, Flip, Observer
   ============================================================ */
(function () {
  "use strict";

  gsap.registerPlugin(ScrollTrigger, Draggable, Flip, Observer);

  // ---------- CONFIG ----------
  const MANIFEST_URL = "/data/images.json";
  let images = [];
  let currentMode = "vertical";
  let activeSTs = [];   // ScrollTriggers to kill on mode switch
  let activeDrags = []; // Draggables to kill
  let lightboxIdx = -1;

  // ---------- DOM ----------
  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

  const gallery     = $("#gallery");
  const wrapper     = $("#galleryWrapper");
  const entrance    = $("#archiveEntrance");
  const entranceCount = $("#entranceCount");
  const header      = $("#archiveHeader");
  const modeSelector = $("#modeSelector");
  const counter     = $("#archiveCounter");
  const counterCurr = $("#counterCurrent");
  const counterTotal = $("#counterTotal");

  // Lightbox
  const lb          = $("#lightbox");
  const lbBg        = $("#lightboxBg");
  const lbImg       = $("#lightboxImg");
  const lbTitle     = $("#lightboxTitle");
  const lbInfo      = $("#lightboxInfo");
  const lbClose     = $("#lightboxClose");
  const lbPrev      = $("#lightboxPrev");
  const lbNext      = $("#lightboxNext");
  const lbStage     = $("#lightboxStage");
  const lbHeader    = $(".lightbox__header");
  const lbCounter   = $("#lightboxCounter");

  // Cursor
  const cursor      = $("#cursor");
  const cursorDot   = $(".cursor__dot");
  const cursorLabel = $("#cursorLabel");

  // ---------- INIT ----------
  async function init() {
    await loadImages();
    renderGallery();
    setupEntrance();
    setupCursor();
    setupModeSelector();
    setupLightbox();
    setupHeaderScroll();
  }

  // ---------- LOAD IMAGES ----------
  async function loadImages() {
    try {
      const r = await fetch(MANIFEST_URL);
      if (!r.ok) throw new Error(r.status);
      images = await r.json();
    } catch (e) {
      console.warn("Manifest failed, using fallback:", e);
      images = Array.from({ length: 58 }, (_, i) => ({
        src: `/images/archive/p${String(i + 3).padStart(3, "0")}.jpg`,
        thumb: `/images/archive/thumb/p${String(i + 3).padStart(3, "0")}.jpg`,
        filename: `p${String(i + 3).padStart(3, "0")}.jpg`,
        category: "Archive",
        meta: { title: `Frame ${String(i + 1).padStart(2, "0")}`, camera: "", settings: "" },
      }));
    }
    counterTotal.textContent = String(images.length).padStart(2, "0");
  }

  // ---------- RENDER ----------
  function renderGallery() {
    wrapper.innerHTML = "";
    images.forEach((img, i) => {
      const el = document.createElement("figure");
      el.className = "gallery-item";
      el.dataset.index = i;
      el.innerHTML = `
        <img src="${img.thumb || img.src}" alt="${img.meta.title || img.filename}" loading="lazy" decoding="async" />
        <div class="gallery-item__glass"></div>
        <div class="gallery-item__info">
          <div class="gallery-item__num">A·${String(i + 1).padStart(2, "0")}</div>
          <div class="gallery-item__title">${img.meta.title || "Untitled"}</div>
          <div class="gallery-item__meta">${img.category}${img.meta.camera ? " · " + img.meta.camera : ""}</div>
        </div>
      `;
      el.addEventListener("click", () => openLightbox(i));
      wrapper.appendChild(el);
    });
  }

  // ---------- ENTRANCE ----------
  function setupEntrance() {
    let progress = 0;
    const iv = setInterval(() => {
      progress = Math.min(100, progress + Math.floor(Math.random() * 20) + 8);
      entranceCount.textContent = String(progress).padStart(2, "0");
      if (progress >= 100) {
        clearInterval(iv);
        const tl = gsap.timeline({
          onComplete: () => {
            entrance.style.display = "none";
            enterGallery();
          },
        });
        tl.to(entrance.querySelectorAll(".archive-entrance__label, .archive-entrance__count"), {
          opacity: 0, duration: 0.3,
        })
        .to($(".archive-entrance__panel--top"), { yPercent: -100, duration: 1, ease: "power4.inOut" }, 0.15)
        .to($(".archive-entrance__panel--bottom"), { yPercent: 100, duration: 1, ease: "power4.inOut" }, 0.15);
      }
    }, 80);
  }

  function enterGallery() {
    gsap.to(modeSelector, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" });
    gsap.to(counter, { opacity: 1, duration: 0.8, delay: 0.2 });
    applyMode("vertical", false);
  }

  // ---------- HEADER SCROLL ----------
  function setupHeaderScroll() {
    window.addEventListener("scroll", () => {
      header.classList.toggle("is-scrolled", window.scrollY > 60);
    }, { passive: true });
  }

  // ---------- CURSOR ----------
  function setupCursor() {
    if (window.matchMedia("(hover: none)").matches) return;
    let mx = 0, my = 0;
    document.addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      gsap.to(cursor, { x: mx, y: my, duration: 0.5, ease: "power3.out" });
    });
    // Hover labels
    document.addEventListener("mouseover", (e) => {
      const item = e.target.closest(".gallery-item");
      if (item) {
        cursor.classList.add("is-label");
        cursorLabel.textContent = "VIEW";
      }
      if (e.target.closest("[data-hover]")) cursor.classList.add("is-link");
    });
    document.addEventListener("mouseout", (e) => {
      const item = e.target.closest(".gallery-item");
      if (item) cursor.classList.remove("is-label");
      if (e.target.closest("[data-hover]")) cursor.classList.remove("is-link");
    });
  }

  // ---------- MODE SELECTOR ----------
  function setupModeSelector() {
    $$(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        if (mode === currentMode) return;
        $$(".mode-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        applyMode(mode, true);
      });
    });
  }

  // ---------- KILL CURRENT MODE ----------
  function killMode() {
    activeSTs.forEach((st) => st.kill());
    activeSTs = [];
    activeDrags.forEach((d) => d.kill());
    activeDrags = [];
    // Clear inline styles
    gsap.set($$(".gallery-item"), { clearProps: "all" });
    gsap.set(wrapper, { clearProps: "all" });
    window.scrollTo({ top: 0 });
  }

  // ---------- APPLY MODE ----------
  function applyMode(mode, animate) {
    killMode();
    gallery.dataset.mode = mode;
    currentMode = mode;

    const items = $$(".gallery-item");

    switch (mode) {
      case "vertical":
        setupVertical(items, animate);
        break;
      case "horizontal":
        setupHorizontal(items, animate);
        break;
      case "grid":
        setupGrid(items, animate);
        break;
      case "circular":
        setupCircular(items, animate);
        break;
      case "floating":
        setupFloating(items, animate);
        break;
    }
  }

  // ====== VERTICAL FLOW ======
  function setupVertical(items, animate) {
    if (animate) {
      gsap.fromTo(items,
        { opacity: 0, y: 60 },
        { opacity: 1, y: 0, duration: 0.8, stagger: 0.03, ease: "power3.out" }
      );
    }
    // Scroll reveal
    items.forEach((item) => {
      const st = ScrollTrigger.create({
        trigger: item,
        start: "top 92%",
        onEnter: () => gsap.to(item, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }),
        onLeaveBack: () => gsap.to(item, { opacity: 0, y: 40, duration: 0.4, ease: "power2.in" }),
      });
      activeSTs.push(st);
      if (!animate) gsap.set(item, { opacity: 0, y: 40 });
    });
  }

  // ====== HORIZONTAL REEL ======
  function setupHorizontal(items, animate) {
    // Measure total width
    const totalW = items.reduce((sum, el) => sum + el.offsetWidth, 0) + (items.length - 1) * (window.innerWidth * 0.02);
    const maxDrag = -(totalW - window.innerWidth + window.innerWidth * 0.08);

    const drag = Draggable.create(wrapper, {
      type: "x",
      bounds: { minX: maxDrag, maxX: 0 },
      edgeResistance: 0.65,
      throwProps: false,
      dragResistance: 0.15,
      onDrag: updateHorizontalCounter,
      onThrowUpdate: updateHorizontalCounter,
    })[0];
    activeDrags.push(drag);

    // Wheel scroll → horizontal drag
    gallery.addEventListener("wheel", horizontalWheel, { passive: false });
    activeSTs.push({ kill: () => gallery.removeEventListener("wheel", horizontalWheel) });

    let xTarget = gsap.getProperty(wrapper, "x") || 0;
    function horizontalWheel(e) {
      e.preventDefault();
      const delta = e.deltaY || e.deltaX;
      xTarget = gsap.utils.clamp(maxDrag, 0, xTarget - delta * 1.5);
      gsap.to(wrapper, { x: xTarget, duration: 0.8, ease: "power3.out", onUpdate: updateHorizontalCounter });
    }

    function updateHorizontalCounter() {
      const x = Math.abs(gsap.getProperty(wrapper, "x"));
      const pct = x / Math.abs(maxDrag);
      const idx = Math.round(pct * (items.length - 1)) + 1;
      counterCurr.textContent = String(Math.min(idx, items.length)).padStart(2, "0");
    }

    if (animate) {
      gsap.fromTo(items,
        { opacity: 0, scale: 0.9 },
        { opacity: 1, scale: 1, duration: 0.6, stagger: 0.04, ease: "power3.out" }
      );
    }
  }

  // ====== GRID EXPLORER ======
  function setupGrid(items, animate) {
    if (animate) {
      gsap.fromTo(items,
        { opacity: 0, scale: 0.85 },
        { opacity: 1, scale: 1, duration: 0.6, stagger: 0.02, ease: "power3.out" }
      );
    }
    items.forEach((item) => {
      const st = ScrollTrigger.create({
        trigger: item,
        start: "top 92%",
        onEnter: () => gsap.to(item, { opacity: 1, scale: 1, duration: 0.5, ease: "power3.out" }),
        onLeaveBack: () => gsap.to(item, { opacity: 0, scale: 0.9, duration: 0.3, ease: "power2.in" }),
      });
      activeSTs.push(st);
      if (!animate) gsap.set(item, { opacity: 0, scale: 0.9 });
    });
  }

  // ====== CIRCULAR ======
  function setupCircular(items, animate) {
    const count = items.length; // Use all images
    const radius = Math.max(window.innerWidth, window.innerHeight) * 0.8;
    let angle = 0;

    gsap.set(wrapper, { x: window.innerWidth / 2, y: window.innerHeight / 2, rotation: 0 });

    items.forEach((item, i) => {
      item.style.display = "block";
      const a = (i / count) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      const rot = (a * 180) / Math.PI + 90;
      
      gsap.set(item, {
        x, y, rotation: rot, left: 0, top: 0, position: 'absolute',
        xPercent: -50, yPercent: -50, zIndex: 1
      });

      item.addEventListener("mouseenter", orbitEnter);
      item.addEventListener("mouseleave", orbitLeave);
    });

    function orbitEnter(e) {
      if (currentMode !== "circular") return;
      gsap.to(e.currentTarget, { scale: 1.4, zIndex: 100, duration: 0.4, ease: "back.out(1.5)" });
    }
    function orbitLeave(e) {
      if (currentMode !== "circular") return;
      gsap.to(e.currentTarget, { scale: 1, zIndex: 1, duration: 0.4, ease: "power2.out" });
    }

    activeSTs.push({
      kill: () => {
        items.forEach(item => {
          item.removeEventListener("mouseenter", orbitEnter);
          item.removeEventListener("mouseleave", orbitLeave);
        });
      }
    });

    // Dummy proxy for drag
    const proxy = document.createElement("div");
    const drag = Draggable.create(proxy, {
      trigger: gallery,
      type: "x",
      onDrag: function() {
        angle += this.deltaX * 0.1;
        gsap.set(wrapper, { rotation: angle });
      }
    })[0];
    activeDrags.push(drag);

    gallery.addEventListener("wheel", circularWheel, { passive: false });
    activeSTs.push({ kill: () => gallery.removeEventListener("wheel", circularWheel) });

    function circularWheel(e) {
      e.preventDefault();
      angle += (e.deltaY || e.deltaX) * 0.1;
      gsap.to(wrapper, { rotation: angle, duration: 0.5, ease: "power2.out" });
    }

    if (animate) {
      gsap.fromTo(items,
        { opacity: 0, scale: 0 },
        { opacity: 1, scale: 1, duration: 0.8, stagger: 0.015, ease: "back.out(1.2)" }
      );
    }
  }

  // ====== FLOATING CANVAS ======
  function setupFloating(items, animate) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const pad = Math.max(W, H) * 0.5; // Padding outside viewport for wrapping
    const areaW = W + pad * 2;
    const areaH = H + pad * 2;

    gsap.set(wrapper, { x: 0, y: 0, rotation: 0 });

    items.forEach((item) => {
      item.style.display = "block";
      item._x = Math.random() * areaW;
      item._y = Math.random() * areaH;
      item._rot = (Math.random() - 0.5) * 35;
      gsap.set(item, { xPercent: -50, yPercent: -50, left: 0, top: 0, position: 'absolute' });
    });

    let panX = 0, panY = 0;

    function renderFloating() {
      items.forEach(item => {
        // Infinite modulo wrap between -pad and W + pad
        let x = item._x + panX;
        let y = item._y + panY;
        x = x - areaW * Math.floor((x + pad) / areaW);
        y = y - areaH * Math.floor((y + pad) / areaH);
        
        gsap.set(item, { x, y, rotation: item._rot });
      });
    }

    renderFloating(); // initial render

    const proxy = document.createElement("div");
    const drag = Draggable.create(proxy, {
      trigger: gallery,
      type: "x,y",
      onDrag: function() {
        panX += this.deltaX;
        panY += this.deltaY;
        renderFloating();
      }
    })[0];
    activeDrags.push(drag);

    gallery.addEventListener("wheel", floatingWheel, { passive: false });
    activeSTs.push({ kill: () => gallery.removeEventListener("wheel", floatingWheel) });

    function floatingWheel(e) {
      e.preventDefault();
      panX -= e.deltaX;
      panY -= e.deltaY;
      renderFloating();
    }

    if (animate) {
      gsap.fromTo(items,
        { opacity: 0, scale: 0.5, rotation: "+=30" },
        { opacity: 1, scale: 1, rotation: (i, t) => items[i]._rot, duration: 0.8, stagger: 0.02, ease: "power3.out" }
      );
    }
  }

  // ============================================================
  // LIGHTBOX
  // ============================================================
  function setupLightbox() {
    lbClose.addEventListener("click", closeLightbox);
    lbBg.addEventListener("click", closeLightbox);
    lbPrev.addEventListener("click", () => navLightbox(-1));
    lbNext.addEventListener("click", () => navLightbox(1));

    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("is-open")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") navLightbox(1);
      if (e.key === "ArrowLeft") navLightbox(-1);
    });

    // Swipe support
    let touchStartX = 0;
    lbStage.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    lbStage.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) navLightbox(dx > 0 ? -1 : 1);
    }, { passive: true });
  }

  function openLightbox(idx) {
    lightboxIdx = idx;
    updateLightboxContent(idx);
    lb.classList.add("is-open");
    document.body.style.overflow = "hidden";

    gsap.timeline()
      .to(lbBg, { opacity: 1, duration: 0.5, ease: "power2.inOut" })
      .to(lbHeader, { opacity: 1, duration: 0.4 }, 0.2)
      .fromTo(lbStage, { opacity: 0, scale: 1.05 }, { opacity: 1, scale: 1, duration: 0.6, ease: "power3.out" }, 0.2)
      .to([lbPrev, lbNext], { opacity: 1, duration: 0.4 }, 0.3)
      .to(lbCounter, { opacity: 1, duration: 0.3 }, 0.4);
  }

  function closeLightbox() {
    gsap.timeline({
      onComplete: () => {
        lb.classList.remove("is-open");
        lbImg.src = "";
        document.body.style.overflow = "";
      },
    })
      .to(lbStage, { opacity: 0, scale: 0.95, duration: 0.35, ease: "power3.in" })
      .to([lbHeader, lbPrev, lbNext, lbCounter], { opacity: 0, duration: 0.25 }, 0)
      .to(lbBg, { opacity: 0, duration: 0.4, ease: "power2.inOut" }, 0.15);
  }

  function navLightbox(dir) {
    lightboxIdx = (lightboxIdx + dir + images.length) % images.length;
    gsap.to(lbStage, {
      opacity: 0, x: dir * -40, duration: 0.25, ease: "power2.in",
      onComplete: () => {
        updateLightboxContent(lightboxIdx);
        gsap.fromTo(lbStage,
          { opacity: 0, x: dir * 40 },
          { opacity: 1, x: 0, duration: 0.35, ease: "power2.out" }
        );
      },
    });
  }

  function updateLightboxContent(idx) {
    const img = images[idx];
    lbImg.src = img.src;
    lbImg.alt = img.meta.title || img.filename;
    lbTitle.textContent = img.meta.title || "Untitled";
    lbInfo.textContent = `${img.category}${img.meta.camera ? " · " + img.meta.camera : ""} · ${img.filename}`;
    lbCounter.textContent = `${String(idx + 1).padStart(2, "0")} / ${String(images.length).padStart(2, "0")}`;
  }

  // ---------- BOOT ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
