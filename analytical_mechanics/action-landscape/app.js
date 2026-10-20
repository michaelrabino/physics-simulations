/*
 * app.js — drawing and interaction for the action landscape.
 * All physics lives in action.js (window.Action).
 */
(function () {
  "use strict";
  const A = window.Action;
  const $ = (id) => document.getElementById(id);
  const N = 7; // number of sine modes = number of draggable handles

  // ---------- Model ----------

  const SYSTEMS = {
    osc: {
      phys: { type: "oscillator", m: 1, omega: 2 * Math.PI },
      T: { min: 0.11, max: 1.69, step: 0.02 },
      q: { min: -1.5, max: 1.5, step: 0.1 },
      R: 0.8, // half-width of the landscape axes (m)
    },
    fall: {
      phys: { type: "freefall", m: 1, g: 9.81 },
      T: { min: 0.3, max: 2, step: 0.05 },
      q: { min: 0, max: 3, step: 0.1 },
      R: 1.0,
    },
  };

  const state = {
    sys: "osc",
    params: {
      osc: { T: 0.37, qA: 1, qB: 0.4, a: [0.22, -0.12, 0.06, 0, 0.03, 0, 0] },
      fall: { T: 1, qA: 0, qB: 0, a: [0.35, 0.12, -0.08, 0, 0, 0.02, 0] },
    },
    view: null,
    freeze: false,
    drag: null, // { kind: "handle" | "land" | "mode", index }
    hoverHandle: -1,
    barScale: 0.3, // vertical scale of the mode bars (m); frozen while a bar is dragged
    descending: false,
    lastFrame: 0,
  };

  const P = () => state.params[state.sys];
  const S = () => SYSTEMS[state.sys];

  function derived() {
    const p = P();
    const sys = S().phys;
    const base = A.truePath(sys, p.qA, p.qB, p.T);
    const c = A.modeCoeffs(sys, p.T, N);
    const sTrue = A.trueAction(sys, p.qA, p.qB, p.T);
    const dS = A.deltaAction(sys, p.T, p.a);
    return { sys, base, c, sTrue, dS, morse: A.morseIndex(sys, p.T, N), trial: A.trialPath(base, p.T, p.a) };
  }

  // ---------- Theme ----------

  let col = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    col = {
      panel: v("--panel"),
      ink: v("--ink"),
      muted: v("--muted"),
      rule: v("--rule"),
      grid: v("--grid"),
      gridStrong: v("--grid-strong"),
      accent: v("--accent"),
      tru: v("--c-true"),
      trial: v("--c-trial"),
      neg: v("--div-neg"),
      pos: v("--div-pos"),
      mid: v("--div-mid"),
      mono: v("--font-mono") || "monospace",
      body: v("--font-body") || "sans-serif",
    };
    col.negRGB = hexToRgb(col.neg);
    col.posRGB = hexToRgb(col.pos);
    col.midRGB = hexToRgb(col.mid);
    col.inkRGB = hexToRgb(col.ink);
    $("ramp-bar").style.background = `linear-gradient(to left, ${col.neg}, ${col.mid} 50%, ${col.pos})`;
  }
  function hexToRgb(h) {
    const s = h.replace("#", "");
    const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ---------- Canvases ----------

  const cvPath = $("path");
  const cvLand = $("land");
  const cvModes = $("modes");
  const ctxPath = cvPath.getContext("2d");
  const ctxLand = cvLand.getContext("2d");
  const ctxModes = cvModes.getContext("2d");
  const size = { path: [0, 0], land: [0, 0], modes: [0, 0] };

  function fitCanvas(cv, ctx, key) {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    size[key] = [r.width, r.height, dpr];
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    fitCanvas(cvPath, ctxPath, "path");
    fitCanvas(cvLand, ctxLand, "land");
    fitCanvas(cvModes, ctxModes, "modes");
    landCache = null;
    if (!state.freeze) fitView();
    render();
  }

  // ---------- Formatting ----------

  const f3 = (x) => (Math.abs(x) < 5e-4 ? "0.000" : x.toFixed(3).replace("-", "−"));
  const signed = (x) => (Math.abs(x) < 5e-4 ? "0.000" : (x > 0 ? "+" : "−") + Math.abs(x).toFixed(3));
  function niceTick(span, count) {
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
    return 10 * mag;
  }
  const trim = (n) => String(Math.round(n * 1000) / 1000).replace("-", "−");

  // ---------- Path plot ----------

  const PAD = { l: 52, r: 18, t: 14, b: 38 };

  function fitView(margin) {
    const p = P();
    const d = derived();
    let lo = 0;
    let hi = 0;
    for (let k = 0; k <= 200; k++) {
      const t = (k / 200) * p.T;
      const y1 = d.base.q(t);
      const y2 = d.trial.q(t);
      lo = Math.min(lo, y1, y2);
      hi = Math.max(hi, y1, y2);
    }
    let span = Math.max(hi - lo, 0.6);
    const m = margin || 0.14;
    const mid = (hi + lo) / 2;
    span *= 1 + 2 * m;
    state.view = { lo: mid - span / 2, hi: mid + span / 2 };
  }

  function px(t) {
    const [W] = size.path;
    return PAD.l + (t / P().T) * (W - PAD.l - PAD.r);
  }
  function py(q) {
    const [, H] = size.path;
    const v = state.view;
    return PAD.t + ((v.hi - q) / (v.hi - v.lo)) * (H - PAD.t - PAD.b);
  }
  function qFromPy(y) {
    const [, H] = size.path;
    const v = state.view;
    return v.hi - ((y - PAD.t) / (H - PAD.t - PAD.b)) * (v.hi - v.lo);
  }

  function drawPath(d) {
    const ctx = ctxPath;
    const [W, H] = size.path;
    const p = P();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = col.panel;
    ctx.fillRect(0, 0, W, H);
    if (!state.view) return;

    // grid and ticks
    ctx.save();
    ctx.font = `11px ${col.mono}`;
    ctx.direction = "ltr";
    const tStep = niceTick(p.T, 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let t = 0; t <= p.T + 1e-9; t += tStep) {
      ctx.strokeStyle = col.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(px(t)) + 0.5, PAD.t);
      ctx.lineTo(Math.round(px(t)) + 0.5, H - PAD.b);
      ctx.stroke();
      ctx.fillStyle = col.muted;
      ctx.fillText(trim(t), px(t), H - PAD.b + 6);
    }
    const v = state.view;
    const qStep = niceTick(v.hi - v.lo, 6);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let q = Math.ceil(v.lo / qStep) * qStep; q <= v.hi + 1e-9; q += qStep) {
      ctx.strokeStyle = Math.abs(q) < 1e-9 ? col.gridStrong : col.grid;
      ctx.beginPath();
      ctx.moveTo(PAD.l, Math.round(py(q)) + 0.5);
      ctx.lineTo(W - PAD.r, Math.round(py(q)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = col.muted;
      ctx.fillText(trim(q), PAD.l - 8, py(q));
    }
    ctx.strokeStyle = col.rule;
    ctx.beginPath();
    ctx.moveTo(PAD.l + 0.5, PAD.t);
    ctx.lineTo(PAD.l + 0.5, H - PAD.b + 0.5);
    ctx.lineTo(W - PAD.r, H - PAD.b + 0.5);
    ctx.stroke();
    // axis titles
    ctx.fillStyle = col.muted;
    ctx.font = `12px ${col.body}`;
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("זמן t (ש')", PAD.l + (W - PAD.l - PAD.r) / 2, H - 2);
    ctx.save();
    ctx.translate(13, PAD.t + (H - PAD.t - PAD.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(state.sys === "fall" ? "גובה q (מ')" : "מקום q (מ')", 0, 0);
    ctx.restore();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t - 6, W - PAD.l - PAD.r, H - PAD.t - PAD.b + 12);
    ctx.clip();

    // offsets from the true path at the handles
    const times = A.handleTimes(p.T, N);
    ctx.strokeStyle = col.muted;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (const t of times) {
      ctx.beginPath();
      ctx.moveTo(px(t), py(d.base.q(t)));
      ctx.lineTo(px(t), py(d.trial.q(t)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // true path
    ctx.strokeStyle = col.tru;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    strokeFn(ctx, d.base.q, p.T);
    ctx.setLineDash([]);

    // trial path
    ctx.strokeStyle = col.trial;
    ctx.lineWidth = 2.5;
    strokeFn(ctx, d.trial.q, p.T);
    ctx.restore();

    // fixed ends
    ctx.fillStyle = col.ink;
    for (const [t, q] of [[0, p.qA], [p.T, p.qB]]) {
      ctx.fillRect(px(t) - 5, py(q) - 5, 10, 10);
    }

    // handles
    times.forEach((t, i) => {
      const x = px(t);
      const y = py(d.trial.q(t));
      const active = (state.drag && state.drag.kind === "handle" && state.drag.index === i) || state.hoverHandle === i;
      ctx.beginPath();
      ctx.arc(x, y, active ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = col.panel;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = active ? col.accent : col.trial;
      ctx.stroke();
    });
  }

  function strokeFn(ctx, fn, T) {
    ctx.beginPath();
    const n = 240;
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * T;
      const x = px(t);
      const y = py(fn(t));
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ---------- Landscape ----------

  let landCache = null; // { key, image }

  function landRange() {
    return S().R;
  }

  function drawLand(d) {
    const ctx = ctxLand;
    const [W, H, dpr] = size.land;
    if (!W) return;
    const R = landRange();
    const c1 = d.c[0];
    const c2 = d.c[1];
    const fmax = Math.max(Math.abs(c1), Math.abs(c2)) * R * R;
    const LEVELS = 8;
    const step = fmax / LEVELS;

    // Heat map with contour lines, rendered once per (system, T, theme, size).
    const key = [state.sys, P().T, W, H, col.neg, col.pos, col.mid].join("|");
    if (!landCache || landCache.key !== key) {
      const w = Math.round(W * dpr);
      const h = Math.round(H * dpr);
      const img = ctx.createImageData(w, h);
      const band = new Int16Array(w * h);
      for (let j = 0; j < h; j++) {
        const a2 = R - (2 * R * (j + 0.5)) / h;
        for (let i = 0; i < w; i++) {
          const a1 = -R + (2 * R * (i + 0.5)) / w;
          const f = c1 * a1 * a1 + c2 * a2 * a2;
          band[j * w + i] = Math.max(-LEVELS, Math.min(LEVELS, Math.round(f / step)));
        }
      }
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const k = band[j * w + i];
          const t = Math.min(1, Math.abs(k) / LEVELS);
          let rgb = mix(col.midRGB, k < 0 ? col.negRGB : col.posRGB, Math.pow(t, 0.85));
          const edge = (i + 1 < w && band[j * w + i + 1] !== k) || (j + 1 < h && band[(j + 1) * w + i] !== k);
          if (edge) rgb = mix(rgb, col.inkRGB, 0.28);
          const o = 4 * (j * w + i);
          img.data[o] = rgb[0];
          img.data[o + 1] = rgb[1];
          img.data[o + 2] = rgb[2];
          img.data[o + 3] = 255;
        }
      }
      landCache = { key, img };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(landCache.img, 0, 0);
    ctx.restore();

    const X = (a1) => ((a1 + R) / (2 * R)) * W;
    const Y = (a2) => ((R - a2) / (2 * R)) * H;

    // axes through the true path
    ctx.save();
    ctx.strokeStyle = col.ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Y(0) + 0.5);
    ctx.lineTo(W, Y(0) + 0.5);
    ctx.moveTo(X(0) + 0.5, 0);
    ctx.lineTo(X(0) + 0.5, H);
    ctx.stroke();
    ctx.restore();

    // labels
    ctx.save();
    ctx.font = `12px ${col.mono}`;
    ctx.direction = "ltr";
    ctx.fillStyle = col.ink;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "right";
    ctx.fillText("a₁ →", W - 8, Y(0) - 6);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("↑ a₂", X(0) + 6, 8);
    ctx.font = `11px ${col.mono}`;
    ctx.fillStyle = col.muted;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(trim(-R), 6, Y(0) + 5);
    ctx.textAlign = "right";
    ctx.fillText(trim(R), W - 6, Y(0) + 5);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(trim(-R), X(0) + 6, H - 6);
    ctx.restore();

    // the true path (origin)
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = col.tru;
    ctx.fillStyle = col.panel;
    ctx.beginPath();
    ctx.arc(X(0), Y(0), 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // the current trial path, projected on (a1, a2)
    const a = P().a;
    const cx = Math.max(6, Math.min(W - 6, X(a[0])));
    const cy = Math.max(6, Math.min(H - 6, Y(a[1])));
    const outside = Math.abs(a[0]) > R || Math.abs(a[1]) > R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = outside ? col.panel : col.trial;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = outside ? col.trial : col.panel;
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Modes ----------

  const MP = { t: 16, b: 74, l: 10, r: 10 };

  function modeLayout() {
    const [W, H] = size.modes;
    const colW = (W - MP.l - MP.r) / N;
    const top = MP.t;
    const bottom = H - MP.b;
    const zero = (top + bottom) / 2;
    const half = (bottom - top) / 2;
    return { W, H, colW, top, bottom, zero, half };
  }
  // Columns run left to right n = 1 … 7, like the frequency axis of a spectrum.
  const colX = (L, i) => MP.l + L.colW * i;

  function drawModes(d) {
    const ctx = ctxModes;
    const L = modeLayout();
    if (!L.W) return;
    const R = state.barScale;
    const a = P().a;
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.fillStyle = col.panel;
    ctx.fillRect(0, 0, L.W, L.H);

    for (let i = 0; i < N; i++) {
      const x0 = colX(L, i);
      const cn = d.c[i];
      const lowers = cn < 0;
      // faint column background for modes that lower the action
      if (lowers) {
        ctx.save();
        ctx.fillStyle = col.neg;
        ctx.globalAlpha = 0.09;
        ctx.fillRect(x0 + 2, L.top - 8, L.colW - 4, L.bottom - L.top + 16);
        ctx.restore();
      }
      // bar
      const bw = Math.min(28, L.colW * 0.46);
      const bx = x0 + (L.colW - bw) / 2;
      const val = Math.max(-R, Math.min(R, a[i]));
      const y = L.zero - (val / R) * L.half;
      const h = Math.abs(y - L.zero);
      ctx.fillStyle = lowers ? col.neg : col.pos;
      roundBar(ctx, bx, Math.min(y, L.zero), bw, Math.max(h, 1.5), val >= 0);
      if (Math.abs(a[i]) > R) {
        // clipped: small chevron at the end
        ctx.fillStyle = col.ink;
        const yy = val > 0 ? L.top - 4 : L.bottom + 4;
        ctx.beginPath();
        ctx.moveTo(bx + bw / 2 - 5, yy + (val > 0 ? 5 : -5));
        ctx.lineTo(bx + bw / 2, yy);
        ctx.lineTo(bx + bw / 2 + 5, yy + (val > 0 ? 5 : -5));
        ctx.fill();
      }
      // mode shape sketch
      const sx0 = x0 + L.colW * 0.18;
      const sw = L.colW * 0.64;
      const sy = L.bottom + 18;
      ctx.save();
      ctx.strokeStyle = col.muted;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const u = k / 40;
        const yy = sy - 7 * Math.sin((i + 1) * Math.PI * u);
        if (k === 0) ctx.moveTo(sx0 + u * sw, yy);
        else ctx.lineTo(sx0 + u * sw, yy);
      }
      ctx.stroke();
      ctx.restore();
      // labels
      ctx.save();
      ctx.direction = "ltr";
      ctx.textAlign = "center";
      ctx.fillStyle = col.ink;
      ctx.font = `500 12px ${col.mono}`;
      ctx.textBaseline = "top";
      ctx.fillText(`n=${i + 1}`, x0 + L.colW / 2, L.bottom + 32);
      ctx.fillStyle = col.muted;
      ctx.font = `11px ${col.mono}`;
      ctx.fillText(signed(cn * a[i] * a[i]), x0 + L.colW / 2, L.bottom + 50);
      ctx.restore();
    }
    // zero line
    ctx.strokeStyle = col.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MP.l, Math.round(L.zero) + 0.5);
    ctx.lineTo(L.W - MP.r, Math.round(L.zero) + 0.5);
    ctx.stroke();
  }

  // Rounded data end (4px), square at the baseline.
  function roundBar(ctx, x, y, w, h, up) {
    const r = Math.min(4, h, w / 2);
    ctx.beginPath();
    if (up) {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h - r);
      ctx.quadraticCurveTo(x, y + h, x + r, y + h);
      ctx.lineTo(x + w - r, y + h);
      ctx.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
      ctx.lineTo(x + w, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---------- Readout ----------

  function renderReadout(d) {
    $("s-trial").textContent = f3(d.sTrue + d.dS);
    $("s-true").textContent = f3(d.sTrue);
    $("s-delta").textContent = signed(d.dS);
    const st = $("status");
    st.className = "status " + (d.morse === 0 ? "min" : "saddle");
    st.textContent =
      d.morse === 0
        ? "המסלול האמיתי: מינימום"
        : d.morse === 1
        ? "המסלול האמיתי: נקודת אוכף, כיוון יורד אחד"
        : `המסלול האמיתי: נקודת אוכף, ${d.morse} כיוונים יורדים`;
  }

  function updateBarScale() {
    if (state.drag && state.drag.kind === "mode") return;
    const R = landRange();
    const m = Math.max(...P().a.map(Math.abs));
    state.barScale = Math.min(R, Math.max(0.2 * R, 1.3 * m));
  }

  function render() {
    updateBarScale();
    const d = derived();
    drawPath(d);
    drawLand(d);
    drawModes(d);
    renderReadout(d);
  }

  // ---------- Hint line ----------

  const DEFAULT_HINT = "גררו את הנקודות העגולות על המסלול. הפעולה מתעדכנת בזמן אמת.";
  function setHint(text, alert) {
    const h = $("hint");
    h.textContent = text || DEFAULT_HINT;
    h.classList.toggle("alert", !!alert);
  }

  // ---------- Controls ----------

  function syncControls() {
    const p = P();
    const s = S();
    const t = $("t");
    t.min = s.T.min;
    t.max = s.T.max;
    t.step = s.T.step;
    t.value = p.T;
    for (const id of ["qa", "qb"]) {
      const el = $(id);
      el.min = s.q.min;
      el.max = s.q.max;
      el.step = s.q.step;
    }
    $("qa").value = p.qA;
    $("qb").value = p.qB;
    updateLabels();
    renderTicks();
  }

  function updateLabels() {
    const p = P();
    const osc = state.sys === "osc";
    $("t-out").innerHTML = osc
      ? `<span class="num">${p.T.toFixed(2)}τ</span>`
      : `<span class="num">${p.T.toFixed(2)}</span> ש'`;
    $("qa-out").innerHTML = `<span class="num">${trim(p.qA)}</span> מ'`;
    $("qb-out").innerHTML = `<span class="num">${trim(p.qB)}</span> מ'`;
    let note;
    if (osc) {
      const halves = (2 * p.T) % 1;
      const near = Math.min(halves, 1 - halves) < 0.05 && p.T > 0.4;
      note = "τ = 1 ש' הוא מחזור המתנד. בכל חצי מחזור נוסף מצב אחד שמוריד את הפעולה.";
      if (near) note += " T קרוב לנקודה צמודה, ולכן המסלול האמיתי מתנפח.";
      $("sys-note").textContent = "מסה 1 ק\"ג, ω = 2π רדיאן לשנייה.";
      $("t-caption").textContent = "משך התנועה, ביחידות של מחזור";
    } else {
      note = "בזריקה אנכית אין נקודות צמודות: המסלול האמיתי הוא מינימום לכל T.";
      $("sys-note").textContent = "מסה 1 ק\"ג, g = 9.81 מ'/ש². q הוא הגובה.";
      $("t-caption").textContent = "משך התנועה";
    }
    $("t-note").textContent = note;
  }

  function renderTicks() {
    const box = $("ticks");
    box.innerHTML = "";
    if (state.sys !== "osc") return;
    const s = S().T;
    for (const [v, label] of [[0.5, "τ/2"], [1, "τ"], [1.5, "3τ/2"]]) {
      const el = document.createElement("span");
      el.style.left = `${((v - s.min) / (s.max - s.min)) * 100}%`;
      el.textContent = label;
      box.appendChild(el);
    }
  }

  function setSystem(key) {
    stopDescent();
    state.sys = key;
    $("tab-osc").setAttribute("aria-selected", String(key === "osc"));
    $("tab-fall").setAttribute("aria-selected", String(key === "fall"));
    syncControls();
    landCache = null;
    setHint();
    fitView();
    render();
  }

  // ---------- Descent ("let the action go down") ----------

  function startDescent() {
    state.descending = true;
    state.freeze = true;
    fitView(0.6);
    $("descend").setAttribute("aria-pressed", "true");
    $("descend").textContent = "עצור";
    setHint("כל מצב זז בכיוון שמוריד את הפעולה…");
    state.lastFrame = performance.now();
    requestAnimationFrame(descentFrame);
  }

  function stopDescent(message, alert) {
    if (!state.descending) return;
    state.descending = false;
    state.freeze = false;
    $("descend").setAttribute("aria-pressed", "false");
    $("descend").textContent = "תן לפעולה לרדת";
    setHint(message, alert);
    fitView();
    render();
  }

  function descentFrame(now) {
    if (!state.descending) return;
    const dt = Math.min(0.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    const d = derived();
    const a = P().a;
    const rate = 1.5;
    let settled = true;
    for (let i = 0; i < N; i++) {
      if (d.c[i] > 0) {
        a[i] *= Math.exp(-rate * dt);
        if (Math.abs(a[i]) > 3e-4) settled = false;
        else a[i] = 0;
      } else if (d.c[i] < 0) {
        if (Math.abs(a[i]) < 0.02) a[i] = a[i] < 0 ? -0.02 : 0.02;
        a[i] *= Math.exp(rate * dt);
        settled = false;
      }
    }
    // Has the path left the frozen view?
    const p = P();
    const tr = A.trialPath(d.base, p.T, a);
    let out = false;
    for (let k = 1; k < 60; k++) {
      const q = tr.q((k / 60) * p.T);
      if (q < state.view.lo || q > state.view.hi) {
        out = true;
        break;
      }
    }
    render();
    if (settled) {
      stopDescent("הפעולה ירדה עד המסלול האמיתי ונעצרה שם: כאן המסלול האמיתי הוא מינימום.", true);
      return;
    }
    if (out) {
      const dS = A.deltaAction(d.sys, p.T, a);
      stopDescent(
        `הפעולה ממשיכה לרדת בלי גבול (כרגע ΔS = ${signed(dS)} J·s). המסלול האמיתי הוא נקודת אוכף, לא מינימום.`,
        true
      );
      return;
    }
    requestAnimationFrame(descentFrame);
  }

  // ---------- Pointer: path handles ----------

  function hitHandle(e) {
    const r = cvPath.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const d = derived();
    const times = A.handleTimes(P().T, N);
    let best = -1;
    let bestD = 18;
    times.forEach((t, i) => {
      const dd = Math.hypot(x - px(t), y - py(d.trial.q(t)));
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return { index: best, x, y };
  }

  cvPath.addEventListener("pointerdown", (e) => {
    const h = hitHandle(e);
    if (h.index < 0) return;
    stopDescent();
    state.drag = { kind: "handle", index: h.index };
    state.freeze = true;
    cvPath.setPointerCapture(e.pointerId);
    cvPath.classList.add("grabbing");
    hideTip("tip-path");
    render();
  });

  cvPath.addEventListener("pointermove", (e) => {
    const h = hitHandle(e);
    if (state.drag && state.drag.kind === "handle") {
      const p = P();
      const d = derived();
      const times = A.handleTimes(p.T, N);
      const offsets = A.modesToOffsets(p.a);
      const i = state.drag.index;
      const q = Math.max(state.view.lo, Math.min(state.view.hi, qFromPy(h.y)));
      offsets[i] = q - d.base.q(times[i]);
      p.a = A.offsetsToModes(offsets);
      render();
      return;
    }
    const prev = state.hoverHandle;
    state.hoverHandle = h.index;
    cvPath.classList.toggle("grab", h.index >= 0);
    if (prev !== h.index) render();
    pathTip(h);
  });

  function endHandleDrag() {
    if (!state.drag || state.drag.kind !== "handle") return;
    state.drag = null;
    state.freeze = false;
    cvPath.classList.remove("grabbing");
    fitView();
    render();
  }
  cvPath.addEventListener("pointerup", endHandleDrag);
  cvPath.addEventListener("pointercancel", endHandleDrag);
  cvPath.addEventListener("pointerleave", () => {
    hideTip("tip-path");
    if (state.hoverHandle !== -1 && !state.drag) {
      state.hoverHandle = -1;
      render();
    }
  });

  function pathTip(h) {
    const [W, H] = size.path;
    if (h.x < PAD.l || h.x > W - PAD.r || h.y < PAD.t || h.y > H - PAD.b) {
      hideTip("tip-path");
      return;
    }
    const p = P();
    const d = derived();
    const t = Math.max(0, Math.min(p.T, ((h.x - PAD.l) / (W - PAD.l - PAD.r)) * p.T));
    const L = A.lagrangian(d.sys, d.trial.q(t), d.trial.qd(t));
    showTip(
      "tip-path",
      px(t),
      Math.min(py(d.trial.q(t)), py(d.base.q(t))),
      h.index >= 0
        ? "גררו למעלה או למטה"
        : `<span class="num">t = ${t.toFixed(2)} s</span><br>שלך: <span class="num">q = ${trim(d.trial.q(t))} m</span><br>אמיתי: <span class="num">q = ${trim(d.base.q(t))} m</span><br><span class="num">L = ${trim(L)} J</span>`
    );
  }

  // ---------- Pointer: landscape ----------

  function landPoint(e) {
    const r = cvLand.getBoundingClientRect();
    const R = landRange();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { a1: -R + (2 * R * x) / r.width, a2: R - (2 * R * y) / r.height, x, y, w: r.width, h: r.height };
  }
  cvLand.addEventListener("pointerdown", (e) => {
    stopDescent();
    state.drag = { kind: "land" };
    cvLand.setPointerCapture(e.pointerId);
    const pt = landPoint(e);
    P().a[0] = pt.a1;
    P().a[1] = pt.a2;
    hideTip("tip-land");
    render();
  });
  cvLand.addEventListener("pointermove", (e) => {
    const pt = landPoint(e);
    if (state.drag && state.drag.kind === "land") {
      const R = landRange();
      P().a[0] = Math.max(-R, Math.min(R, pt.a1));
      P().a[1] = Math.max(-R, Math.min(R, pt.a2));
      render();
      return;
    }
    const d = derived();
    const dS = d.c[0] * pt.a1 * pt.a1 + d.c[1] * pt.a2 * pt.a2;
    showTip(
      "tip-land",
      pt.x,
      pt.y,
      `<span class="num">a₁ = ${trim(pt.a1)} m, a₂ = ${trim(pt.a2)} m</span><br><span class="num">ΔS = ${signed(dS)} J·s</span><br>שאר המצבים באפס`
    );
  });
  const endLand = () => {
    if (state.drag && state.drag.kind === "land") {
      state.drag = null;
      fitView();
      render();
    }
  };
  cvLand.addEventListener("pointerup", endLand);
  cvLand.addEventListener("pointercancel", endLand);
  cvLand.addEventListener("pointerleave", () => hideTip("tip-land"));

  // ---------- Pointer: mode bars ----------

  function modePoint(e) {
    const r = cvModes.getBoundingClientRect();
    const L = modeLayout();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const i = Math.max(0, Math.min(N - 1, Math.floor((x - MP.l) / L.colW)));
    const R = state.barScale;
    const val = Math.max(-R, Math.min(R, ((L.zero - y) / L.half) * R));
    return { i, val, x, y };
  }
  cvModes.addEventListener("pointerdown", (e) => {
    stopDescent();
    const m = modePoint(e);
    state.drag = { kind: "mode", index: m.i };
    state.freeze = true;
    cvModes.setPointerCapture(e.pointerId);
    P().a[m.i] = m.val;
    hideTip("tip-modes");
    render();
  });
  cvModes.addEventListener("pointermove", (e) => {
    const m = modePoint(e);
    if (state.drag && state.drag.kind === "mode") {
      P().a[state.drag.index] = m.val;
      render();
      return;
    }
    const d = derived();
    const a = P().a[m.i];
    const L = modeLayout();
    showTip(
      "tip-modes",
      colX(L, m.i) + L.colW / 2,
      Math.max(28, m.y),
      `מצב <span class="num">n = ${m.i + 1}</span><br><span class="num">a = ${trim(a)} m</span><br><span class="num">c = ${trim(d.c[m.i])} J·s/m²</span><br><span class="num">ΔS = ${signed(d.c[m.i] * a * a)} J·s</span>`
    );
  });
  const endMode = () => {
    if (state.drag && state.drag.kind === "mode") {
      state.drag = null;
      state.freeze = false;
      fitView();
      render();
    }
  };
  cvModes.addEventListener("pointerup", endMode);
  cvModes.addEventListener("pointercancel", endMode);
  cvModes.addEventListener("pointerleave", () => hideTip("tip-modes"));

  // ---------- Tooltips ----------

  function showTip(id, x, y, html) {
    const el = $(id);
    el.innerHTML = html;
    el.hidden = false;
    const parent = el.parentElement.getBoundingClientRect();
    const w = el.offsetWidth;
    const cx = Math.max(w / 2 + 4, Math.min(parent.width - w / 2 - 4, x));
    el.style.left = `${cx}px`;
    el.style.top = `${Math.max(el.offsetHeight + 14, y)}px`;
  }
  function hideTip(id) {
    $(id).hidden = true;
  }

  // ---------- Buttons and sliders ----------

  $("descend").addEventListener("click", () => {
    if (state.descending) stopDescent();
    else startDescent();
  });
  $("to-true").addEventListener("click", () => {
    stopDescent();
    P().a = new Array(N).fill(0);
    setHint("זה המסלול האמיתי: ΔS = 0. כל שינוי קטן בו משנה את הפעולה רק בסדר שני.");
    fitView();
    render();
  });
  $("shake").addEventListener("click", () => {
    stopDescent();
    const R = landRange();
    P().a = Array.from({ length: N }, (_, i) => ((Math.random() * 2 - 1) * R * 0.45) / (i + 1));
    setHint();
    fitView();
    render();
  });

  $("t").addEventListener("input", (e) => {
    stopDescent();
    P().T = parseFloat(e.target.value);
    updateLabels();
    landCache = null;
    fitView();
    render();
  });
  for (const [id, key] of [["qa", "qA"], ["qb", "qB"]]) {
    $(id).addEventListener("input", (e) => {
      stopDescent();
      P()[key] = parseFloat(e.target.value);
      updateLabels();
      fitView();
      render();
    });
  }

  $("tab-osc").addEventListener("click", () => setSystem("osc"));
  $("tab-fall").addEventListener("click", () => setSystem("fall"));
  for (const id of ["tab-osc", "tab-fall"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const next = id === "tab-osc" ? "tab-fall" : "tab-osc";
        $(next).focus();
        setSystem(next === "tab-osc" ? "osc" : "fall");
      }
    });
  }

  // Theme changes: re-read the tokens and repaint.
  const onTheme = () => {
    readColors();
    landCache = null;
    render();
  };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // ---------- Boot ----------

  readColors();
  syncControls();
  setHint();
  const ro = new ResizeObserver(resize);
  ro.observe(cvPath);
  ro.observe(cvLand);
  ro.observe(cvModes);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onTheme);
})();
