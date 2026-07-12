/* ============================================================
   DHRUMIL KADCHHA — Portfolio
   GSAP + ScrollTrigger + Lenis + Three.js
   Hardened: never gets stuck blank, headlines always fit,
   draggable film-reel archive + lightbox.
   ============================================================ */
import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOUCH = window.matchMedia("(hover: none)").matches;
const EASE = "expo.out";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* If main.js parses & runs at all, the page can't be "stuck blank",
   so cancel the HTML-level CSS failsafe. Runtime errors are still
   caught by the inline error handler. */
if (window.__failsafe) { clearTimeout(window.__failsafe); window.__failsafe = null; }

/* ------------------------------------------------------------
   Text splitting utilities
------------------------------------------------------------ */
function splitChars(el) {
  if (el.dataset.split === "done") return el.querySelectorAll(".char");
  const text = el.textContent;
  el.textContent = "";
  el.setAttribute("aria-hidden", "true");
  el.dataset.split = "done";
  const frag = document.createDocumentFragment();
  for (const ch of text) {
    const s = document.createElement("span");
    s.className = "char";
    s.innerHTML = ch === " " ? "&nbsp;" : ch;
    frag.appendChild(s);
  }
  el.appendChild(frag);
  return el.querySelectorAll(".char");
}

function splitLines(el) {
  // Restore from a cached source so re-splitting (on resize) is clean.
  if (!el.dataset.source) el.dataset.source = el.innerHTML;
  else el.innerHTML = el.dataset.source;

  const words = [];
  [...el.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent.split(/\s+/).filter(Boolean).forEach((w) => {
        const s = document.createElement("span");
        s.className = "word"; s.style.display = "inline-block";
        s.textContent = w; words.push(s);
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const s = document.createElement("span");
      s.className = "word"; s.style.display = "inline-block";
      s.appendChild(node.cloneNode(true)); words.push(s);
    }
  });
  el.textContent = "";
  words.forEach((w, i) => {
    el.appendChild(w);
    if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
  });
  // group into visual lines by offsetTop
  let lines = [], current = [], lastTop = null;
  words.forEach((w) => {
    const top = w.offsetTop;
    if (lastTop !== null && Math.abs(top - lastTop) > 2) { lines.push(current); current = []; }
    current.push(w); lastTop = top;
  });
  if (current.length) lines.push(current);

  el.textContent = "";
  return lines.map((lineWords) => {
    const wrap = document.createElement("span");
    wrap.className = "line-wrap";
    const line = document.createElement("span");
    line.className = "line";
    lineWords.forEach((w, i) => {
      line.appendChild(w);
      if (i < lineWords.length - 1) line.appendChild(document.createTextNode(" "));
    });
    wrap.appendChild(line); el.appendChild(wrap);
    return line;
  });
}

/* ------------------------------------------------------------
   Fit headlines to their container — no clipping, ever.
   Measures intrinsic text width at a reference size, then scales.
------------------------------------------------------------ */
function fitFontSize(containerEl, inners, getAvail, min, max) {
  if (!containerEl || !inners.length) return;
  const REF = 120;
  containerEl.style.fontSize = REF + "px";
  let size = max;
  inners.forEach((inner) => {
    const textW = inner.scrollWidth || inner.getBoundingClientRect().width;
    const avail = getAvail(inner);
    if (textW > 0 && avail > 0) size = Math.min(size, REF * (avail / textW));
  });
  containerEl.style.fontSize = clamp(size, min, max) + "px";
}

function fitHero() {
  const title = document.querySelector(".hero__title");
  if (!title) return;
  const lines = [...title.querySelectorAll(".hero__line")];
  const inners = lines.map((l) => l.firstElementChild || l);
  fitFontSize(title, inners, (inner) => {
    const line = inner.closest(".hero__line");
    const padL = parseFloat(getComputedStyle(line).paddingLeft) || 0;
    return title.clientWidth - padL;
  }, 30, 210);
}

function fitHeadlines() {
  fitHero();
  document.querySelectorAll(".section-title").forEach((t) => {
    const inner = t.querySelector(".split") || t;
    fitFontSize(t, [inner], () => t.clientWidth, 40, 180);
  });
  const contact = document.querySelector(".contact__title");
  if (contact) {
    const inners = [...contact.querySelectorAll(".split, .contact__line--serif .serif")];
    if (inners.length) fitFontSize(contact, inners, () => contact.clientWidth, 32, 130);
  }
}

/* ------------------------------------------------------------
   Smooth scroll (Lenis)
------------------------------------------------------------ */
let lenis = null;
if (!REDUCED) {
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  window.__lenis = lenis; // exposed for tooling / verification
}

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  if (a.closest("#menu")) return; // overlay-menu links are handled by initNav (close, then scroll)
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    if (id.length < 2) return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
    else target.scrollIntoView({ behavior: "smooth" });
  });
});

/* ------------------------------------------------------------
   Scroll progress hairline
------------------------------------------------------------ */
(function initProgress() {
  const bar = document.getElementById("progressBar");
  if (!bar) return;
  const set = (p) => (bar.style.transform = `scaleX(${clamp(p, 0, 1)})`);
  if (lenis) {
    lenis.on("scroll", (l) => set(l.limit ? l.scroll / l.limit : 0));
  } else {
    const onS = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      set(max > 0 ? window.scrollY / max : 0);
    };
    window.addEventListener("scroll", onS, { passive: true });
    onS();
  }
})();

/* ------------------------------------------------------------
   Boot sequence — split, fit, then intro. Runs after fonts so
   measurements (line wrapping, fit-to-width) are correct.
------------------------------------------------------------ */
const heroChars = [];
let introDone = false;
let aboutReveal = null;

function initType() {
  // Character splitting is width-independent, so it's safe to run immediately.
  document.querySelectorAll(".hero__title .split").forEach((el) => heroChars.push(...splitChars(el)));
  document.querySelectorAll(".section-title .split, .contact__line .split").forEach((el) => splitChars(el));
  if (!REDUCED) gsap.set(".hero__title .char", { yPercent: 120, rotate: 6 });
}

function revealHeroFinal() {
  gsap.set(".hero__title .char", { yPercent: 0, rotate: 0 });
  gsap.set(".hero .reveal-line", { opacity: 1, y: 0 });
}

function finishIntro() {
  if (introDone) return;
  introDone = true;
  window.__introDone = true;
  const pl = document.getElementById("preloader");
  if (pl) pl.remove();
  revealHeroFinal();
  if (lenis) lenis.start();
  ScrollTrigger.refresh();
}

function heroIntro() {
  const tl = gsap.timeline({ defaults: { ease: EASE }, onComplete: finishIntro });
  tl.to(".hero__title .char", { yPercent: 0, rotate: 0, duration: 1.3, stagger: 0.03 })
    .to(".hero .reveal-line", { opacity: 1, y: 0, duration: 1, stagger: 0.12 }, "-=0.85");
}

function runPreloader() {
  const preloader = document.getElementById("preloader");
  // Skip the cinematic intro if the tab is hidden or motion is reduced.
  if (REDUCED || document.visibilityState === "hidden") {
    if (preloader) preloader.remove();
    revealHeroFinal();
    gsap.set(".reveal-line", { opacity: 1, y: 0 });
    document.querySelectorAll(".about__text .line").forEach((l) => gsap.set(l, { y: 0 }));
    introDone = true;
    if (lenis) lenis.start();
    return;
  }

  if (lenis) lenis.stop();
  const count = { v: 0 };
  const counterEl = document.getElementById("loadCount");
  const tl = gsap.timeline({ onComplete: () => { if (lenis) lenis.start(); } });
  tl.to(".preloader__name span", { y: 0, duration: 1, ease: EASE, stagger: 0.06 }, 0)
    .to(count, {
      v: 100, duration: 1.6, ease: "power2.inOut",
      onUpdate: () => (counterEl.textContent = String(Math.round(count.v)).padStart(2, "0")),
    }, 0)
    .to(".preloader__name span", { y: "-110%", duration: 0.8, ease: "expo.in", stagger: 0.04 }, 1.7)
    .to(".preloader__count", { opacity: 0, duration: 0.3 }, 1.9)
    .to(".preloader__panel--top", { yPercent: -100, duration: 1, ease: "expo.inOut" }, 2.3)
    .to(".preloader__panel--bottom", { yPercent: 100, duration: 1, ease: "expo.inOut", onComplete: () => {
      const pl = document.getElementById("preloader"); if (pl) pl.remove();
    } }, 2.3)
    .add(heroIntro, 2.55);

  /* Wall-clock failsafe: even if rAF throttles (background tab) and the
     GSAP timeline never advances, force the final state at 5s. */
  setTimeout(finishIntro, 5000);
}

/* Boot: split type immediately, then fit + build reveals + intro once
   fonts are ready (so widths/line-wrapping are correct). Falls back on a
   timer so slow/blocked fonts never stall the page. */
initType();
(function boot() {
  let started = false;
  const afterFonts = () => {
    if (started) return;
    started = true;
    fitHeadlines();
    buildScrollReveals(); // hoisted; includes about line-splitting (needs fonts)
    runPreloader();
  };
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { fitHeadlines(); afterFonts(); });
    setTimeout(afterFonts, 1500);
  } else {
    afterFonts();
  }
})();

/* ------------------------------------------------------------
   Three.js — particle wave terrain in hero
------------------------------------------------------------ */
(function initWebGL() {
  const canvas = document.getElementById("webgl");
  if (!canvas) return;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) { canvas.remove(); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(0, 1.6, 5.2);
  camera.lookAt(0, 0, 0);

  const COLS = TOUCH ? 110 : 200;
  const ROWS = TOUCH ? 70 : 120;
  const W = 16, H = 10;
  const positions = new Float32Array(COLS * ROWS * 3);
  let i = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      positions[i++] = (x / (COLS - 1) - 0.5) * W;
      positions[i++] = 0;
      positions[i++] = (y / (ROWS - 1) - 0.5) * H;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const uniforms = {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },   // fast cursor bump
    uTrail: { value: new THREE.Vector2(0, 0) },   // lagging wake (comet tail)
    uPulseAmp: { value: 0 },                      // click ripple amplitude
    uPulseStart: { value: -10 },                  // click time (elapsed secs)
    uPulseOrigin: { value: new THREE.Vector2(0, 0) },
    uColorA: { value: new THREE.Color("#6b675c") },
    uColorB: { value: new THREE.Color("#ff4d00") },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime; uniform vec2 uMouse; uniform vec2 uTrail;
      uniform float uPulseAmp; uniform float uPulseStart; uniform vec2 uPulseOrigin;
      varying float vElev; varying float vMd;
      void main() {
        vec3 p = position; float t = uTime * 0.6;
        float elev = sin(p.x * 0.9 + t) * 0.22
                   + sin(p.z * 1.4 + t * 1.3) * 0.18
                   + sin((p.x + p.z) * 0.6 + t * 0.7) * 0.25;
        vec2 gp = p.xz * 0.12;
        float dF = distance(gp, uMouse);
        float dS = distance(gp, uTrail);
        elev += smoothstep(0.45, 0.0, dF) * 0.55;      // cursor bump
        elev += smoothstep(0.38, 0.0, dS) * 0.28;      // trailing wake
        float age = max(uTime - uPulseStart, 0.0);     // click ripple ring
        float dp = distance(gp, uPulseOrigin);
        elev += uPulseAmp * sin(dp * 24.0 - age * 5.0) * exp(-dp * 3.5) * exp(-age * 1.1);
        p.y = elev; vElev = elev; vMd = dF;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (3.4 + elev * 3.5) * (5.6 / -mv.z);
      }`,
    fragmentShader: `
      uniform vec3 uColorA; uniform vec3 uColorB; varying float vElev; varying float vMd;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.1, d);
        vec3 col = mix(uColorA, uColorB, smoothstep(0.05, 0.7, vElev));
        col += uColorB * smoothstep(0.35, 0.0, vMd) * 0.35;  // glow near cursor
        gl_FragColor = vec4(col, a * 0.85);
      }`,
  });

  const points = new THREE.Points(geo, mat);
  points.position.y = -1.2;
  scene.add(points);

  /* Mouse springs — GSAP quickTo gives the field a fast bump that the
     lagging "wake" chases, so moving the cursor drags a comet tail through
     the particles. Click/press drops a ripple ring at the cursor. */
  const mFast = { x: 0, y: 0 };
  const mSlow = { x: 0, y: 0 };
  if (!REDUCED) {
    const fx = gsap.quickTo(mFast, "x", { duration: 0.4, ease: "power3.out" });
    const fy = gsap.quickTo(mFast, "y", { duration: 0.4, ease: "power3.out" });
    const sx = gsap.quickTo(mSlow, "x", { duration: 1.3, ease: "power2.out" });
    const sy = gsap.quickTo(mSlow, "y", { duration: 1.3, ease: "power2.out" });
    window.addEventListener("pointermove", (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -(e.clientY / window.innerHeight) * 2 + 1;
      fx(nx); fy(ny); sx(nx); sy(ny);
    });
    window.addEventListener("pointerdown", () => {
      uniforms.uPulseOrigin.value.set(mFast.x * 0.9, -mFast.y * 0.55);
      uniforms.uPulseStart.value = clock.getElapsedTime();
      gsap.fromTo(uniforms.uPulseAmp, { value: 0.55 }, { value: 0, duration: 1.8, ease: "expo.out", overwrite: true });
    });
    /* Cinematic dolly-in while the preloader plays (tick only writes x/y). */
    gsap.fromTo(camera.position, { z: 8.4 }, { z: 5.2, duration: 2.8, ease: "expo.out", delay: 0.3 });
    /* Depth parallax: the field rises gently as the hero scrolls away. */
    gsap.to(points.position, {
      y: -0.55, ease: "none",
      scrollTrigger: { trigger: "#hero", start: "top top", end: "bottom top", scrub: 0.6 },
    });
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas.parentElement;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  let raf, running = false;
  function tick() {
    running = true;
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uMouse.value.set(mFast.x * 0.9, -mFast.y * 0.55);
    uniforms.uTrail.value.set(mSlow.x * 0.9, -mSlow.y * 0.55);
    camera.position.x = mFast.x * 0.35;
    camera.position.y = 1.6 + mFast.y * 0.15;
    camera.lookAt(0, -0.4, 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  if (REDUCED) {
    renderer.render(scene, camera);
  } else {
    tick();
    ScrollTrigger.create({
      trigger: "#hero", start: "top bottom", end: "bottom top",
      onLeave: () => { cancelAnimationFrame(raf); running = false; },
      onEnterBack: () => { if (!running) tick(); },
      onLeaveBack: () => { cancelAnimationFrame(raf); running = false; },
      onEnter: () => { if (!running) tick(); },
    });
  }
})();

/* ------------------------------------------------------------
   Interactive Cursor Background Glow
------------------------------------------------------------ */
(function initCursorGlow() {
  const glow = document.getElementById("cursorGlow");
  if (!glow || TOUCH || REDUCED) return;
  
  const xTo = gsap.quickTo(glow, "left", { duration: 0.6, ease: "power3" });
  const yTo = gsap.quickTo(glow, "top", { duration: 0.6, ease: "power3" });
  
  let isActive = false;
  window.addEventListener("pointermove", (e) => {
    xTo(e.clientX);
    yTo(e.clientY);
    if (!isActive) {
      glow.classList.add("is-active");
      isActive = true;
    }
  });

  // Enhance glow on interactive elements
  const hoverTargets = document.querySelectorAll("a, button, .work-card, .sheet__cell, .frame, [role='button']");
  hoverTargets.forEach(el => {
    el.addEventListener("mouseenter", () => glow.classList.add("is-hovering"));
    el.addEventListener("mouseleave", () => glow.classList.remove("is-hovering"));
  });
})();

/* ------------------------------------------------------------
   Marquee — direction & speed react to scroll velocity
------------------------------------------------------------ */
(function initMarquee() {
  const track = document.getElementById("marqueeTrack");
  if (!track) return;
  const half = () => track.scrollWidth / 2;
  let x = 0, dir = 1;
  gsap.ticker.add((time, dt) => {
    if (REDUCED) return;
    const v = lenis ? lenis.velocity : 0;
    if (Math.abs(v) > 0.5) dir = v > 0 ? 1 : -1;
    const speed = 70 + Math.min(Math.abs(v) * 8, 380);
    x -= dir * speed * (dt / 1000);
    const h = half();
    if (h > 0) { if (x <= -h) x += h; if (x > 0) x -= h; }
    track.style.transform = `translate3d(${x}px,0,0)`;
  });
})();

/* ------------------------------------------------------------
   Scroll reveals
------------------------------------------------------------ */
function buildScrollReveals() {
  if (REDUCED) {
    gsap.set(".reveal-line", { opacity: 1, y: 0 });
    document.querySelectorAll(".about__text .line, .contact__line--serif .serif").forEach((el) => (el.style.transform = "none"));
    document.querySelectorAll(".profile__imgwrap").forEach((el) => (el.style.clipPath = "none"));
    document.querySelectorAll(".contact__line .char").forEach((el) => {
      el.style.color = "";
      el.style.webkitTextStrokeWidth = "0px";
    });
    return;
  }

  document.querySelectorAll(".reveal-line").forEach((el) => {
    if (el.closest(".hero")) return;
    gsap.to(el, { opacity: 1, y: 0, duration: 1.1, ease: EASE, scrollTrigger: { trigger: el, start: "top 88%" } });
  });

  document.querySelectorAll(".section-title").forEach((el) => {
    gsap.from(el.querySelectorAll(".char"), {
      yPercent: 120, rotate: 5, duration: 1.2, ease: EASE, stagger: 0.04,
      scrollTrigger: { trigger: el, start: "top 85%" },
    });
  });

  const aboutEl = document.querySelector("[data-lines]");
  if (aboutEl) {
    const aboutLines = splitLines(aboutEl);
    gsap.set(aboutLines, { y: "110%" });
    aboutReveal = gsap.to(aboutLines, {
      y: "0%", duration: 1.3, ease: EASE, stagger: 0.12,
      scrollTrigger: { trigger: ".about__text", start: "top 80%" },
    });
  }

  // Profile — portrait curtain reveal + settle, then career rows cascade
  const pWrap = document.querySelector(".profile__imgwrap");
  if (pWrap) {
    const pImg = pWrap.querySelector("img");
    const cap = document.querySelector(".profile__media figcaption");
    const ptl = gsap.timeline({ scrollTrigger: { trigger: ".profile", start: "top 78%" }, defaults: { ease: EASE } });
    ptl.to(pWrap, { clipPath: "inset(0 0 0% 0)", duration: 1.25 })
       .from(pImg, { scale: 1.22, duration: 1.7 }, 0);
    if (cap) ptl.from(cap, { opacity: 0, y: 14, duration: 0.7 }, 0.55);
  }
  const careerRows = gsap.utils.toArray(".career-row");
  if (careerRows.length) {
    gsap.from(careerRows, {
      y: 30, opacity: 0, duration: 0.9, ease: EASE, stagger: 0.09,
      scrollTrigger: { trigger: ".profile__career", start: "top 88%" },
    });
  }

  const contactTl = gsap.timeline({ scrollTrigger: { trigger: ".contact__title", start: "top 80%" }, defaults: { ease: EASE } });
  contactTl
    .from(".contact__line .char", { yPercent: 120, duration: 1.2, stagger: 0.04 })
    // serif is pre-hidden at translateY(110%) by CSS. GSAP parses that as an
    // absolute y (~px) in the matrix, so we must zero BOTH y and yPercent to
    // actually reveal it (and a .from would tween 110%→110% — also wrong).
    .to(".contact__line--serif .serif", { y: 0, yPercent: 0, duration: 1.2 }, 0.35);

  // Ghost-outline → solid fill, scrubbed continuously with scroll (not a
  // one-shot reveal): letters wipe solid left-to-right as the footer scrolls
  // through view, "create" settles in alongside it on the same scrub clock.
  const inkColor = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#eae6dd";
  gsap.timeline({
    scrollTrigger: { trigger: ".contact", start: "top 75%", end: "top 15%", scrub: 0.6 },
    defaults: { ease: "none" },
  })
    .to(".contact__line:not(.contact__line--serif) .char", {
      color: inkColor, "-webkit-text-stroke-width": 0, stagger: 0.02,
    }, 0)
    .from(".contact__line--serif .serif", { scale: 0.75, rotate: -8, duration: 1 }, 0);
}

/* ------------------------------------------------------------
   Work — pinned horizontal scroll (desktop) / swipe (mobile)
------------------------------------------------------------ */
const mm = gsap.matchMedia();
mm.add("(min-width: 901px)", () => {
  if (REDUCED) return;
  const track = document.getElementById("workTrack");
  const pin = document.getElementById("workPin");
  if (!track || !pin) return;
  const getDist = () => Math.max(0, track.scrollWidth - window.innerWidth + 64);
  const tween = gsap.to(track, {
    x: () => -getDist(), ease: "none",
    scrollTrigger: {
      trigger: pin, start: "top 12%", end: () => "+=" + getDist(),
      pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1,
    },
  });
  return () => { if (tween.scrollTrigger) tween.scrollTrigger.kill(); tween.kill(); gsap.set(track, { clearProps: "transform" }); };
});
mm.add("(max-width: 900px)", () => {
  const pin = document.getElementById("workPin");
  if (!pin) return;
  pin.style.overflowX = "auto";
  pin.style.webkitOverflowScrolling = "touch";
  return () => (pin.style.overflowX = "");
});

/* ------------------------------------------------------------
   Archive — contact sheet: scatter → develop on scroll
------------------------------------------------------------ */
(function initSheet() {
  const cells = gsap.utils.toArray("#sheetGrid .sheet__cell");
  if (!cells.length || REDUCED) return;
  const rand = (i, salt) => { const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return v - Math.floor(v); };

  /* Function-based FROM values: re-evaluated on every ScrollTrigger refresh
     (resize, font swap, pin recalc), so the scatter can never go stale or
     collapse mid-scroll — this was the source of the janky assemble. */
  gsap.set("#sheetCaption", { opacity: 0, y: 20 });
  gsap.timeline({
    scrollTrigger: { trigger: "#sheet", start: "top top", end: "+=140%", pin: true, scrub: 0.8, invalidateOnRefresh: true },
  })
    .fromTo(cells, {
      x: (i) => (rand(i, 1) - 0.5) * window.innerWidth * 0.8,
      y: (i) => (rand(i, 2) - 0.5) * window.innerHeight * 0.85,
      rotation: (i) => (rand(i, 3) - 0.5) * 50,
      scale: (i) => 0.55 + rand(i, 4) * 0.2,
      opacity: 0.85,
    }, {
      x: 0, y: 0, rotation: 0, scale: 1, opacity: 1,
      ease: "power2.out", duration: 1,
      stagger: { each: 0.05, from: "random" },
    })
    .to("#sheetCaption", { opacity: 1, y: 0, duration: 0.3 }, ">-0.15");
})();

/* ------------------------------------------------------------
   Archive — FILM REEL: drag + momentum + velocity skew + develop
------------------------------------------------------------ */
(function initReel() {
  const reel = document.getElementById("reel");
  const rail = document.getElementById("reelRail");
  const bar = document.getElementById("reelBar");
  const indexEl = document.getElementById("reelIndex");
  if (!reel || !rail) return;
  const frames = gsap.utils.toArray(".frame", rail);

  let maxScroll = 0, target = 0, current = 0, velocity = 0;
  let dragging = false, didDrag = false, startX = 0, startTarget = 0, lastX = 0, lastV = 0, downTarget = null;

  function measure() {
    maxScroll = Math.max(0, rail.scrollWidth - window.innerWidth);
    target = clamp(target, -maxScroll, 0);
  }
  measure();
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);

  // Reduced motion / fallback: native horizontal scroll, all developed.
  if (REDUCED) {
    reel.style.overflowX = "auto";
    frames.forEach((f) => f.classList.add("is-focus"));
    return;
  }

  // Drag (pointer = mouse + touch)
  rail.addEventListener("pointerdown", (e) => {
    downTarget = e.target.closest(".frame");
    dragging = true; didDrag = false; rail.classList.add("is-dragging");
    startX = e.clientX; startTarget = target; lastX = e.clientX; lastV = 0; velocity = 0;
    rail.setPointerCapture(e.pointerId);
  });
  rail.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 6) didDrag = true;
    target = clamp(startTarget + dx, -maxScroll, 0);
    lastV = e.clientX - lastX; lastX = e.clientX;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false; rail.classList.remove("is-dragging");
    velocity = clamp(lastV * 1.6, -120, 120); // fling momentum
  };
  rail.addEventListener("pointerup", endDrag);
  rail.addEventListener("pointercancel", endDrag);
  rail.addEventListener("lostpointercapture", endDrag);
  // Swallow the click that ends a drag, but let genuine clicks through.
  rail.addEventListener("click", (e) => {
    if (didDrag) {
      e.preventDefault(); e.stopPropagation(); didDrag = false;
    } else if (e.isTrusted && downTarget) {
      // Fix for pointer capture retargeting clicks to the rail
      e.preventDefault(); e.stopPropagation();
      downTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  }, true);

  // Trackpad horizontal swipe advances the reel. Vertical wheel is left alone
  // so the page never feels "trapped" — drag is the universal control.
  reel.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const next = clamp(target - e.deltaX, -maxScroll, 0);
    if (next !== target) { target = next; velocity = 0; e.preventDefault(); }
  }, { passive: false });

  const vpCenter = () => window.innerWidth / 2;
  gsap.ticker.add(() => {
    if (!dragging) {
      target = clamp(target + velocity, -maxScroll, 0);
      velocity *= 0.9;
      if (Math.abs(velocity) < 0.08) velocity = 0;
    }
    current += (target - current) * 0.11;
    const skew = clamp((target - current) * 0.04, -7, 7);
    rail.style.transform = `translate3d(${current}px,0,0) skewX(${skew}deg)`;

    if (bar) bar.style.transform = `scaleX(${maxScroll ? (0.12 + (-current / maxScroll) * 0.88) : 1})`;

    // develop-in-focus + closest index
    let best = 0, bestDist = Infinity;
    const cx = vpCenter();
    frames.forEach((f, i) => {
      const r = f.getBoundingClientRect();
      const dist = Math.abs(r.left + r.width / 2 - cx);
      f.classList.toggle("is-focus", dist < r.width * 0.62);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    if (indexEl) indexEl.textContent = String(best + 1).padStart(2, "0");
  });
})();

/* ------------------------------------------------------------
   Lightbox — open from a frame, prev/next, esc/backdrop close
------------------------------------------------------------ */
(function initLightbox() {
  const lb = document.getElementById("lightbox");
  if (!lb) return;
  const frames = gsap.utils.toArray(".frame");
  const img = document.getElementById("lightboxImg");
  const wrap = lb.querySelector(".lightbox__imgwrap");
  const backdrop = document.getElementById("lightboxBackdrop");
  const numEl = document.getElementById("lightboxNum");
  const titleEl = document.getElementById("lightboxTitle");
  const placeEl = document.getElementById("lightboxPlace");
  const stage = lb.querySelector(".lightbox__stage");
  let idx = -1, isOpen = false;

  const preload = (i) => { const f = frames[i]; if (f) { const im = new Image(); im.src = f.dataset.img; } };

  function fill(i) {
    const f = frames[i];
    img.style.width = ""; img.style.height = ""; // clear FLIP sizing
    img.src = f.dataset.img;
    img.alt = f.dataset.title || "";
    numEl.textContent = f.dataset.num || "";
    titleEl.textContent = f.dataset.title || "";
    placeEl.textContent = f.dataset.place || "";
  }

  /* Open the viewer. When `origin` (the clicked thumbnail <img>) is given,
     a clone flies from the thumbnail's rect to the stage (FLIP) while the
     full-resolution image loads underneath, then crossfades away. */
  /* Budget height around the meta block + stage gap + lightbox padding —
     not just 76vh — otherwise a tall meta caption forces the flex-shrunk
     .lightbox__imgwrap shorter than this box and its overflow:hidden
     clips the bottom of the image off. Used to size the image explicitly
     in px (both for the FLIP flight and its resting state) since
     width:auto/height:auto + max-height on the <img> does NOT respect the
     wrap's actual flex-shrunk box — only its own max-height/max-width. */
  function fitLightboxImage(natR) {
    const metaH = (lb.querySelector(".lightbox__meta") || {}).offsetHeight || 90;
    const lbCS = getComputedStyle(lb);
    const padY = (parseFloat(lbCS.paddingTop) || 0) + (parseFloat(lbCS.paddingBottom) || 0);
    const gapH = parseFloat(getComputedStyle(stage).rowGap) || 20;
    const maxW = Math.min(window.innerWidth * 0.92, 1100);
    const maxH = Math.min(window.innerHeight * 0.76, window.innerHeight - padY - metaH - gapH - 8);
    let w = maxW, h = w / natR;
    if (h > maxH) { h = maxH; w = h * natR; }
    return { w, h, metaH };
  }

  function open(i, origin) {
    idx = i; fill(i); isOpen = true;
    lb.classList.add("is-open");
    lb.setAttribute("aria-hidden", "false");
    if (lenis) lenis.stop();
    document.documentElement.style.cursor = "auto";
    gsap.killTweensOf([backdrop, stage, img]);
    document.querySelectorAll(".lightbox__flip").forEach((n) => n.remove());
    gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" });

    const canFlip = origin && !REDUCED && typeof origin.getBoundingClientRect === "function";
    if (canFlip) {
      const r = origin.getBoundingClientRect();
      const natR = (origin.naturalWidth > 0 && origin.naturalHeight > 0)
        ? origin.naturalWidth / origin.naturalHeight
        : r.width / Math.max(r.height, 1);
      const { w: tw, h: th, metaH } = fitLightboxImage(natR);
      const tx = (window.innerWidth - tw) / 2;
      const ty = Math.max((window.innerHeight - th - metaH - 20) / 2, 20);

      // stabilise the real stage at the destination size while full-res loads
      img.style.width = tw + "px"; img.style.height = th + "px";
      gsap.set(stage, { opacity: 0, scale: 1, y: 0 });
      gsap.set(img, { scale: 1 });

      const clone = document.createElement("img");
      clone.src = origin.currentSrc || origin.src;
      clone.alt = ""; clone.className = "lightbox__flip"; clone.setAttribute("aria-hidden", "true");
      Object.assign(clone.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      document.body.appendChild(clone);

      gsap.to(clone, { left: tx, top: ty, width: tw, height: th, duration: 0.8, ease: EASE });
      gsap.to(stage, { opacity: 1, duration: 0.45, delay: 0.55, ease: "power2.out" });
      const clear = () => {
        if (!clone.parentNode) return;
        gsap.to(clone, { opacity: 0, duration: 0.3, onComplete: () => clone.remove() });
      };
      const fallback = setTimeout(clear, 1500);
      const ready = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
      Promise.resolve(ready).then(() => {
        // The origin thumbnail is lazy-loaded and may not have finished
        // loading at click time, making natR an unreliable guess from the
        // rendered box instead of the real image. Re-fit now that the
        // actual full-res image is guaranteed decoded, so the settled
        // image is never sized off a wrong ratio (which is what let
        // .lightbox__imgwrap's overflow:hidden clip it).
        if (img.naturalWidth > 0) {
          const fixed = fitLightboxImage(img.naturalWidth / img.naturalHeight);
          img.style.width = fixed.w + "px"; img.style.height = fixed.h + "px";
        }
        setTimeout(() => { clearTimeout(fallback); clear(); }, 820);
      });
    } else {
      const natR = (origin && origin.naturalWidth > 0 && origin.naturalHeight > 0)
        ? origin.naturalWidth / origin.naturalHeight : null;
      const applyFit = (r) => { const { w, h } = fitLightboxImage(r); img.style.width = w + "px"; img.style.height = h + "px"; };
      if (natR) applyFit(natR);
      else img.addEventListener("load", () => applyFit(img.naturalWidth / img.naturalHeight), { once: true });
      gsap.fromTo(stage, { opacity: 0, scale: 0.92, y: 24 }, { opacity: 1, scale: 1, y: 0, duration: 0.7, ease: EASE });
      gsap.fromTo(img, { scale: 1.18 }, { scale: 1, duration: 0.9, ease: EASE });
    }
    preload((i + 1) % frames.length); preload((i - 1 + frames.length) % frames.length);
  }

  function close() {
    isOpen = false;
    document.querySelectorAll(".lightbox__flip").forEach((n) => n.remove());
    /* Finish on a wall clock too — a throttled rAF (background tab) must
       never leave the lightbox stuck open. Same pattern as the preloader. */
    const finish = () => {
      if (!lb.classList.contains("is-open")) return;
      lb.classList.remove("is-open");
      lb.setAttribute("aria-hidden", "true");
      if (lenis) lenis.start();
    };
    gsap.killTweensOf([backdrop, stage]);
    gsap.to(stage, { opacity: 0, scale: 0.94, y: 20, duration: 0.4, ease: "power2.in" });
    gsap.to(backdrop, { opacity: 0, duration: 0.4, delay: 0.05, onComplete: finish });
    setTimeout(finish, 650);
  }

  function go(dir) {
    idx = (idx + dir + frames.length) % frames.length;
    fill(idx);
    const applyFit = () => { const { w, h } = fitLightboxImage(img.naturalWidth / img.naturalHeight); img.style.width = w + "px"; img.style.height = h + "px"; };
    if (img.complete && img.naturalWidth > 0) applyFit();
    else img.addEventListener("load", applyFit, { once: true });
    gsap.fromTo(img, { opacity: 0, x: dir * 60 }, { opacity: 1, x: 0, duration: 0.6, ease: EASE });
    gsap.fromTo([numEl, titleEl, placeEl], { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.04, ease: EASE });
    preload((idx + 1) % frames.length); preload((idx - 1 + frames.length) % frames.length);
  }

  frames.forEach((f, i) => {
    f.addEventListener("click", (e) => {
      // ignore clicks that were actually drags (handled/blocked by reel)
      if (e.defaultPrevented) return;
      open(i, f.querySelector(".frame__media img"));
    });
  });

  // Lightbox image can be clicked to open full raw photo in a new tab
  img.style.cursor = "zoom-in";
  img.addEventListener("click", () => {
    if (img.src) window.open(img.src, "_blank");
  });

  // Contact-sheet cells open the same viewer, flying from the clicked cell
  document.querySelectorAll(".sheet__cell[data-frame]").forEach((cell) => {
    const go = () => open(parseInt(cell.dataset.frame, 10), cell.querySelector("img"));
    cell.addEventListener("click", go);
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
  });
  document.getElementById("lightboxClose").addEventListener("click", close);
  document.getElementById("lightboxBackdrop").addEventListener("click", close);
  document.getElementById("lightboxPrev").addEventListener("click", () => go(-1));
  document.getElementById("lightboxNext").addEventListener("click", () => go(1));
  window.addEventListener("keydown", (e) => {
    if (!isOpen) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  });
})();

/* ------------------------------------------------------------
   Project case study (detail view) — opens from a work card
------------------------------------------------------------ */
const PROJECTS = {
  "blends-website": {
    title: "Blends", kind: "Website — Campus Event Ecosystem", eyebrow: "Selected Work / 001", badge: null,
    image: "images/work/blends-website.jpg",
    lead: "A comprehensive college event platform that connects students with exclusive experiences, clubs and communities — <span class='serif'>all in one place.</span>",
    stats: [["20+", "Colleges"], ["50+", "Partners"], ["10k+", "Students"], ["Web · App", "Ecosystem"]],
    caps: [
      ["Event Discovery", "Find events tailored to your interests, across music, tech and culture."],
      ["Club Connections", "Connect with clubs and campus communities in one social layer."],
      ["Easy Bookings", "Get tickets and passes in a few taps, with digital wallet passes."],
      ["Real-time Updates", "Stay informed with instant notifications for everything you follow."],
    ],
    tags: ["Product Design", "Web", "Design System", "UX"],
  },
  "traffic-ai": {
    title: "Traffic AI", kind: "Neural Traffic Command", eyebrow: "Selected Work / 002", badge: null,
    image: "images/work/traffic-ai.jpg",
    lead: "An AI-powered traffic platform that predicts, monitors and optimizes urban mobility in real time. <span class='serif'>Built for Bangalore, designed for the future.</span>",
    stats: [["3.2M+", "Vehicles Tracked"], ["−24%", "Avg Wait Time"], ["132", "Interventions"], ["98.6%", "System Uptime"]],
    caps: [
      ["Neural Traffic Command", "Real-time traffic control with AI-driven automation across the grid."],
      ["Live Network Intelligence", "City-wide monitoring with interactive, map-based visualization."],
      ["Predictive Analytics", "Forecast congestion and optimize traffic flow before it builds."],
      ["Emergency Response", "AI-routed emergency corridors for measurably faster response."],
    ],
    tags: ["AI", "Dashboard", "Data Viz", "Product Design"],
  },
  "meteor-madness": {
    title: "Meteor Madness", kind: "Asteroid Impact Simulator", eyebrow: "NASA Space Apps 2025", badge: "Global Nominee",
    image: "images/work/meteor-madness.jpg",
    lead: "A NASA-powered asteroid impact simulator built for the Space Apps Challenge 2025 — real-time NEO tracking and impact prediction from <span class='serif'>real NASA data.</span>",
    stats: [["2025", "Space Apps"], ["Global", "Nominee"], ["Real", "NASA Data"], ["3D", "Orbital Sim"]],
    caps: [
      ["Impact Simulator", "Configure asteroid size, velocity, angle and composition to model outcomes."],
      ["NEO Gallery", "Browse real near-Earth objects with live orbital and approach data."],
      ["Historical Impacts", "Chicxulub, Tunguska and more — with their real, modelled consequences."],
      ["NASA Data Integration", "A real-time NEO feed powering the impact prediction system."],
    ],
    tags: ["Data Viz", "Simulation", "WebGL", "Research"],
  },
  "blends-app": {
    title: "Blends App", kind: "Prototype — The Ultimate Campus Experience", eyebrow: "Selected Work / 004", badge: null,
    image: "images/work/blends-app.jpg",
    lead: "A unified app for students to discover events, join clubs, access perks and manage digital passes — <span class='serif'>prototyped screen by screen.</span>",
    stats: [["Discover", "Events"], ["Join", "Clubs"], ["Access", "Perks"], ["Manage", "Passes"]],
    caps: [
      ["Explore", "Find your next experience by category, tag or venue in seconds."],
      ["Trending Now", "See what's happening around you in real time, near your campus."],
      ["My Tickets", "Digital festival passes and event tickets, together in one wallet."],
      ["Discover Clubs", "Join campus life across communities so you never miss out."],
    ],
    tags: ["Mobile", "Prototype", "iOS", "UX"],
  },
};
const PROJECT_ORDER = ["blends-website", "traffic-ai", "meteor-madness", "blends-app"];

(function initCase() {
  const box = document.getElementById("case");
  const inner = document.getElementById("caseInner");
  const scroll = document.getElementById("caseScroll");
  const backdrop = document.getElementById("caseBackdrop");
  const closeBtn = document.getElementById("caseClose");
  if (!box || !inner) return;
  let open = false, lastFocus = null;

  function render(id) {
    const p = PROJECTS[id];
    if (!p) return;
    const nextId = PROJECT_ORDER[(PROJECT_ORDER.indexOf(id) + 1) % PROJECT_ORDER.length];
    const stats = p.stats.map(([n, l]) => `<div class="case__stat"><b>${n}</b><span>${l}</span></div>`).join("");
    const caps = p.caps.map(([h, d]) => `<div class="case__cap"><h4>${h}</h4><p>${d}</p></div>`).join("");
    const tags = p.tags.map((t) => `<span>${t}</span>`).join("");
    inner.innerHTML = `
      <div class="case__eyebrow">
        <span class="mono">${p.eyebrow}</span>
        ${p.badge ? `<span class="case__badge">★ ${p.badge}</span>` : ""}
      </div>
      <h2 class="case__title">${p.title}<span class="case__kind">${p.kind}</span></h2>
      <p class="case__lead">${p.lead}</p>
      <div class="case__hero"><img src="${p.image}" alt="${p.title} — ${p.kind}" loading="eager"/></div>
      <div class="case__stats">${stats}</div>
      <div class="case__label">Core capabilities</div>
      <div class="case__caps">${caps}</div>
      <div class="case__foot">
        <div class="case__tags">${tags}</div>
        <button class="case__next" data-hover>Next project <b>→ ${PROJECTS[nextId].title}</b></button>
      </div>`;
    inner.querySelector(".case__next").addEventListener("click", () => show(nextId));
    if (window.__bindHover) window.__bindHover(inner);
  }

  function show(id) {
    if (!open) lastFocus = document.activeElement;
    render(id);
    open = true;
    box.classList.add("is-open");
    box.setAttribute("aria-hidden", "false");
    if (lenis) lenis.stop();
    document.documentElement.style.cursor = "auto";
    scroll.scrollTop = 0;
    gsap.killTweensOf([backdrop, scroll]);
    gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" });
    gsap.fromTo(scroll, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, ease: EASE });
    closeBtn.focus({ preventScroll: true });
  }

  function hide() {
    // Derive state from the DOM (not the closure) so a desync can never
    // strand the overlay, and finish on a wall clock so a throttled rAF
    // (background tab) can't leave it stuck open — same hardening pattern
    // as the preloader failsafe.
    if (!box.classList.contains("is-open")) return;
    open = false;
    const finish = () => {
      if (!box.classList.contains("is-open")) return;
      box.classList.remove("is-open");
      box.setAttribute("aria-hidden", "true");
      if (lenis) lenis.start();
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    };
    gsap.killTweensOf([backdrop, scroll]);
    gsap.to(scroll, { opacity: 0, y: 20, duration: 0.35, ease: "power2.in" });
    gsap.to(backdrop, { opacity: 0, duration: 0.4, delay: 0.05, onComplete: finish });
    setTimeout(finish, 650);
  }

  document.querySelectorAll(".work-card[data-project]").forEach((card) => {
    const id = card.dataset.project;
    card.addEventListener("click", () => show(id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(id); }
    });
  });
  closeBtn.addEventListener("click", hide);
  backdrop.addEventListener("click", hide);
  window.addEventListener("keydown", (e) => { if (open && e.key === "Escape") hide(); });
})();

/* ------------------------------------------------------------
   Custom cursor + magnetic button
------------------------------------------------------------ */
if (!TOUCH) {
  const cursor = document.getElementById("cursor");
  const label = document.getElementById("cursorLabel");
  if (cursor) {
    const c = { x: -100, y: -100, tx: -100, ty: -100 };
    window.addEventListener("mousemove", (e) => { c.tx = e.clientX; c.ty = e.clientY; });
    gsap.ticker.add(() => {
      c.x += (c.tx - c.x) * 0.22; c.y += (c.ty - c.y) * 0.22;
      cursor.style.transform = `translate3d(${c.x}px,${c.y}px,0)`;
    });
    const bind = (root) => {
      root.querySelectorAll("[data-hover]").forEach((el) => {
        el.addEventListener("mouseenter", () => cursor.classList.add("is-link"));
        el.addEventListener("mouseleave", () => cursor.classList.remove("is-link"));
      });
      root.querySelectorAll("[data-hover-label]").forEach((el) => {
        el.addEventListener("mouseenter", () => { label.textContent = el.dataset.hoverLabel; cursor.classList.add("is-label"); });
        el.addEventListener("mouseleave", () => cursor.classList.remove("is-label"));
      });
    };
    bind(document);
    window.__bindHover = bind; // rebind for content injected later (case study)
  }

  const btn = document.getElementById("magnetBtn");
  if (btn) {
    btn.addEventListener("mousemove", (e) => {
      const r = btn.getBoundingClientRect();
      gsap.to(btn, { x: (e.clientX - (r.left + r.width / 2)) * 0.25, y: (e.clientY - (r.top + r.height / 2)) * 0.35, duration: 0.4, ease: "power2.out" });
    });
    btn.addEventListener("mouseleave", () => gsap.to(btn, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.4)" }));
  }

  /* Work-card image tilt — subtle 3D response to the cursor */
  if (!REDUCED) {
    document.querySelectorAll(".work-card").forEach((card) => {
      const img = card.querySelector(".work-card__img");
      if (!img) return;
      gsap.set(img, { transformPerspective: 700 });
      const rx = gsap.quickTo(img, "rotationX", { duration: 0.5, ease: "power2.out" });
      const ry = gsap.quickTo(img, "rotationY", { duration: 0.5, ease: "power2.out" });
      card.addEventListener("mousemove", (e) => {
        const r = img.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        ry(px * 7);
        rx(-py * 7);
      });
      card.addEventListener("mouseleave", () => { rx(0); ry(0); });
    });
  }
}

/* ------------------------------------------------------------
   Navigation — active-state linking, scroll hide/show, overlay menu
------------------------------------------------------------ */
(function initNav() {
  const header = document.getElementById("header");
  if (!header) return;
  const toggle = document.getElementById("navToggle");
  const menu = document.getElementById("menu");
  const bg = menu && menu.querySelector(".menu__bg");
  const inner = menu && menu.querySelector(".menu__inner");
  const items = menu ? gsap.utils.toArray(".menu__item > a", menu) : [];
  const foot = menu && menu.querySelector(".menu__foot");
  let open = false, tl = null;

  /* --- Dynamic active state: highlight the section currently in view --- */
  const links = gsap.utils.toArray("[data-nav], [data-menu]");
  const setActive = (id) => links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === id));
  const sections = ["#about", "#work", "#archive", "#contact"].map((s) => document.querySelector(s)).filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) setActive("#" + en.target.id); });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    sections.forEach((s) => io.observe(s));
  }

  /* --- Sticky header: always visible; condenses to glass after 40px --- */
  const onScroll = (y) => header.classList.toggle("is-scrolled", y > 40);
  if (lenis) {
    lenis.on("scroll", (l) => onScroll(l.scroll || 0));
  } else {
    window.addEventListener("scroll", () => onScroll(window.scrollY), { passive: true });
  }

  /* --- Mobile overlay menu --- */
  function openMenu() {
    if (open || !menu) return;
    open = true;
    document.documentElement.classList.add("is-menu-open");
    menu.classList.add("is-open"); menu.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true"); toggle.setAttribute("aria-label", "Close menu");
    if (lenis) lenis.stop();
    if (tl) tl.kill();
    if (REDUCED) { gsap.set(bg, { scaleY: 1 }); gsap.set(inner, { opacity: 1 }); gsap.set(items, { y: "0%" }); gsap.set(foot, { opacity: 1 }); return; }
    tl = gsap.timeline({ defaults: { ease: EASE } });
    tl.set(inner, { opacity: 1 })
      .set(items, { y: "115%" })
      .set(bg, { transformOrigin: "top" })
      .to(bg, { scaleY: 1, duration: 0.7, ease: "expo.inOut" })
      .to(items, { y: "0%", duration: 0.85, stagger: 0.07 }, "-=0.25")
      .fromTo(foot, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, "-=0.45");
  }
  function finishClose() {
    menu.classList.remove("is-open"); menu.setAttribute("aria-hidden", "true");
    if (lenis) lenis.start();
  }
  function closeMenu() {
    if (!open || !menu) return;
    open = false;
    document.documentElement.classList.remove("is-menu-open");
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", "Open menu");
    if (tl) tl.kill();
    if (REDUCED) { gsap.set([bg, inner, foot], { clearProps: "all" }); gsap.set(bg, { scaleY: 0 }); finishClose(); return; }
    tl = gsap.timeline({ onComplete: finishClose });
    tl.to(items, { y: "-115%", duration: 0.5, stagger: 0.03, ease: "expo.in" })
      .to(foot, { opacity: 0, duration: 0.3 }, 0)
      .set(bg, { transformOrigin: "bottom" })
      .to(bg, { scaleY: 0, duration: 0.6, ease: "expo.inOut" }, "-=0.15")
      .set(inner, { opacity: 0 });
    /* Wall-clock failsafe: a throttled rAF must never wedge the menu shut-
       animation halfway. Skips itself if the menu was reopened meanwhile. */
    setTimeout(() => { if (!open) finishClose(); }, 1300);
  }
  if (toggle) toggle.addEventListener("click", () => (open ? closeMenu() : openMenu()));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) closeMenu(); });
  window.addEventListener("resize", () => { if (open && window.innerWidth > 720) closeMenu(); });

  // Overlay links: close, then smooth-scroll to the target.
  if (menu) menu.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const t = document.querySelector(a.getAttribute("href"));
      closeMenu();
      setTimeout(() => { if (t) { if (lenis) lenis.scrollTo(t, { duration: 1.4 }); else t.scrollIntoView({ behavior: "smooth" }); } }, 420);
    });
  });
})();

/* ------------------------------------------------------------
   IST clock
------------------------------------------------------------ */
(function clock() {
  const els = [document.getElementById("clock"), document.getElementById("menuClock"), document.getElementById("clockGrid")].filter(Boolean);
  const headerClock = document.getElementById("headerClock");
  if (!els.length && !headerClock) return;
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const headerFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
  const update = () => {
    const now = new Date();
    const t = `${fmt.format(now)} IST`;
    els.forEach((e) => (e.textContent = t));
    if (headerClock) headerClock.textContent = headerFmt.format(now);
  };
  update(); setInterval(update, 1000);
})();

/* ------------------------------------------------------------
   Resize: refit headlines + re-split about lines, then refresh ST
------------------------------------------------------------ */
let resizeT;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    fitHeadlines();
    const aboutEl = document.querySelector("[data-lines]");
    if (aboutEl && !REDUCED) {
      if (aboutReveal && aboutReveal.scrollTrigger) aboutReveal.scrollTrigger.kill();
      if (aboutReveal) aboutReveal.kill();
      const lines = splitLines(aboutEl);
      gsap.set(lines, { y: "0%" }); // keep visible after a resize
    }
    ScrollTrigger.refresh();
  }, 250);
});

window.addEventListener("load", () => { fitHeadlines(); ScrollTrigger.refresh(); });
