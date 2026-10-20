/*
 * app.js — drawing and interaction for the effective potential lab.
 * All physics lives in central.js (window.Central).
 */
(function () {
  "use strict";
  const C = window.Central;
  const $ = (id) => document.getElementById(id);

  // ---------- Model ----------

  const PRESETS = C.PRESETS;
  const RATE = { kepler: 6, hooke: 1.2, inv4: 2.5, yukawa: 5, gr: 6 }; // simulated time units per second at 1×
  const PARAM_LABEL = { a: "טווח יוקאווה a", eps: "עוצמת התיקון ε" };

  const state = {
    preset: "kepler",
    params: { yukawa: { a: PRESETS.yukawa.param.value }, gr: { eps: PRESETS.gr.param.value } },
    settings: {},
    view: null,
    info: null,
    speed: 1,
    run: null,
    running: false,
    drag: null,
    unstable: false, // the user picked the unstable circular orbit at a maximum of V'
  };
  for (const k of Object.keys(PRESETS)) {
    state.settings[k] = { l: PRESETS[k].start.l, E: PRESETS[k].start.E, r0: null, inward: true };
  }

  const pre = () => PRESETS[state.preset];
  const prm = () => state.params[state.preset] || {};
  const cfg = () => state.settings[state.preset];
  const veff = (r) => C.Veff(pre(), prm(), cfg().l, r);
  const vpot = (r) => pre().V(r, cfg().l, prm());

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
      energy: v("--c-energy"),
      veff: v("--c-veff"),
      v: v("--c-v"),
      cent: v("--c-cent"),
      forbid: v("--c-forbid"),
      mono: v("--font-mono") || "monospace",
      body: v("--font-body") || "sans-serif",
    };
  }

  // ---------- Analysis of the current settings ----------

  function rLo() {
    return pre().view.rmax / 300;
  }

  /** Vertical range of the V′ plot. Depends on the preset, l and the parameter, not on E. */
  function computeView() {
    const v = pre().view;
    let vmin = Infinity;
    for (let i = 0; i <= 600; i++) {
      const r = rLo() + ((v.rmax - rLo()) * i) / 600;
      vmin = Math.min(vmin, veff(r));
    }
    const bottom = Math.max(v.floor, vmin);
    const span = v.top - bottom;
    state.view = { rmax: v.rmax, lo: bottom - 0.12 * span, hi: v.top };
    const e = $("e");
    e.min = state.view.lo.toFixed(3);
    e.max = state.view.hi.toFixed(3);
    e.step = ((state.view.hi - state.view.lo) / 1000).toFixed(4);
  }

  /** Keep E inside the plot and the start radius inside an allowed region. */
  function settle() {
    const s = cfg();
    s.E = Math.max(state.view.lo, Math.min(state.view.hi, s.E));
    if (s.r0 == null) {
      // Start near the stable circular orbit if V′ has a local minimum; otherwise far out, heading in.
      const st = stationary();
      const m = st.find((x) => x.kind === "min");
      if (m) s.r0 = m.r;
      else {
        s.r0 = state.view.rmax * 0.85;
        s.inward = true;
      }
    }
    const r = C.nearestAllowed(pre(), prm(), s.l, s.E, s.r0, rLo() * 2, state.view.rmax);
    if (r != null) s.r0 = r;
    analyse();
  }

  /** Local minima and maxima of V′ inside the plot, from small r outward. */
  function stationary() {
    const out = [];
    const n = 3000;
    let prevD = null;
    for (let i = 1; i <= n; i++) {
      const r = rLo() * Math.pow(state.view.rmax / rLo(), i / n);
      const d = veff(r * 1.0005) - veff(r * 0.9995);
      if (prevD != null && prevD < 0 && d >= 0) out.push({ r, kind: "min" });
      if (prevD != null && prevD > 0 && d <= 0) out.push({ r, kind: "max" });
      prevD = d;
    }
    return out;
  }

  function analyse() {
    const s = cfg();
    const rFar = state.view.rmax * 40;
    const ok = s.E - veff(s.r0) >= -1e-9;
    const iv = ok ? C.allowedInterval(pre(), prm(), s.l, s.E, s.r0, rFar) : null;
    const info = { possible: !!iv };
    if (iv) {
      info.r1 = iv.r1;
      info.r2 = iv.r2;
      info.bounded = iv.r1 > 0 && isFinite(iv.r2);
      info.circular = state.unstable || (info.bounded && iv.r2 - iv.r1 < 2e-3 * iv.r2);
      if (info.bounded && !info.circular) info.swing = C.swing(pre(), prm(), s.l, s.E, iv.r1, iv.r2);
    }
    state.info = info;
  }

  function orbitRadius() {
    const i = state.info;
    const rmax = state.view.rmax;
    if (i && i.possible && isFinite(i.r2) && !state.unstable) return Math.max(i.r2 * 1.12, 0.5);
    if (state.unstable) return Math.min(rmax, cfg().r0 * 2.2);
    return rmax;
  }

  // ---------- Running the orbit ----------

  function resetRun() {
    const s = cfg();
    state.running = false;
    const Rv = orbitRadius();
    state.run = {
      st: C.initState(s.r0, s.E, s.l, pre(), prm(), s.inward),
      trail: [[s.r0, 0]],
      apsides: [],
      event: null,
      Rv,
      lastR: [s.r0, s.r0],
    };
    updatePlay();
  }

  let lastFrame = 0;
  function play() {
    if (!state.info || !state.info.possible) return;
    if (state.run.event) resetRun();
    state.running = true;
    lastFrame = performance.now();
    updatePlay();
    requestAnimationFrame(frame);
  }
  function pause() {
    state.running = false;
    updatePlay();
  }

  function frame(now) {
    if (!state.running) return;
    const dtReal = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const run = state.run;
    const s = cfg();
    const simDt = RATE[state.preset] * state.speed * dtReal;
    const minStep = run.Rv / 500;
    const res = C.advance(pre(), prm(), s.l, run.st, simDt, {
      rCenter: Math.max(0.02, run.Rv * 0.004),
      rEscape: run.Rv * 2.2,
      onPoint: (x, y) => {
        const last = run.trail[run.trail.length - 1];
        if (Math.hypot(x - last[0], y - last[1]) > minStep) {
          run.trail.push([x, y]);
          if (run.trail.length > 24000) run.trail.splice(0, 4000);
        }
        // turning points: local extrema of r along the path
        const r = Math.hypot(x, y);
        const [r2, r1] = run.lastR;
        if ((r1 - r2) * (r - r1) < 0 && Math.abs(r - r1) > 1e-12) {
          run.apsides.push([x, y]);
          if (run.apsides.length > 400) run.apsides.shift();
        }
        run.lastR = [r1, r];
      },
    });
    run.st = res.state;
    if (res.event) {
      run.event = res.event;
      state.running = false;
      updatePlay();
      renderReadout();
    }
    drawAll();
    updateLive();
    if (state.running) requestAnimationFrame(frame);
  }

  function updatePlay() {
    const b = $("play");
    b.textContent = state.running ? "עצור" : state.run && state.run.event ? "שחרר שוב" : state.run && state.run.st.t > 0 ? "המשך" : "שחרר";
    b.disabled = !state.info || !state.info.possible;
  }

  // ---------- Canvases ----------

  const cvV = $("veff");
  const cvO = $("orbit");
  const ctxV = cvV.getContext("2d");
  const ctxO = cvO.getContext("2d");
  const size = { v: [0, 0], o: [0, 0] };

  function fit(cv, ctx, key) {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    size[key] = [r.width, r.height];
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function resize() {
    fit(cvV, ctxV, "v");
    fit(cvO, ctxO, "o");
    drawAll();
  }

  // ---------- Formatting ----------

  const fmt = (x, d = 3) => (Math.abs(x) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : x.toFixed(d).replace("-", "−"));
  function niceTick(span, count) {
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
    return 10 * mag;
  }
  const trim = (n) => String(Math.round(n * 1000) / 1000).replace("-", "−");

  // ---------- V′ plot ----------

  const VP = { l: 46, r: 14, t: 12, b: 36 };
  const vx = (r) => VP.l + (r / state.view.rmax) * (size.v[0] - VP.l - VP.r);
  const vy = (v) => VP.t + ((state.view.hi - v) / (state.view.hi - state.view.lo)) * (size.v[1] - VP.t - VP.b);
  const rFromX = (x) => ((x - VP.l) / (size.v[0] - VP.l - VP.r)) * state.view.rmax;
  const eFromY = (y) => state.view.hi - ((y - VP.t) / (size.v[1] - VP.t - VP.b)) * (state.view.hi - state.view.lo);

  function currentR() {
    if (!state.run) return cfg().r0;
    return Math.hypot(state.run.st.x, state.run.st.y);
  }

  function drawV() {
    const ctx = ctxV;
    const [W, H] = size.v;
    if (!W || !state.view) return;
    const s = cfg();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = col.panel;
    ctx.fillRect(0, 0, W, H);

    const x0 = VP.l;
    const x1 = W - VP.r;
    const yTop = VP.t;
    const yBot = H - VP.b;

    // grid + ticks
    ctx.save();
    ctx.font = `11px ${col.mono}`;
    ctx.direction = "ltr";
    const rs = niceTick(state.view.rmax, 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let r = 0; r <= state.view.rmax + 1e-9; r += rs) {
      ctx.strokeStyle = col.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(vx(r)) + 0.5, yTop);
      ctx.lineTo(Math.round(vx(r)) + 0.5, yBot);
      ctx.stroke();
      ctx.fillStyle = col.muted;
      ctx.fillText(trim(r), vx(r), yBot + 6);
    }
    const es = niceTick(state.view.hi - state.view.lo, 6);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let e = Math.ceil(state.view.lo / es) * es; e <= state.view.hi + 1e-9; e += es) {
      ctx.strokeStyle = Math.abs(e) < 1e-9 ? col.gridStrong : col.grid;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(vy(e)) + 0.5);
      ctx.lineTo(x1, Math.round(vy(e)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = col.muted;
      ctx.fillText(trim(e), x0 - 6, vy(e));
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, yTop, x1 - x0, yBot - yTop);
    ctx.clip();

    // forbidden columns (E < V′) and the allowed area between V′ and E
    const yE = vy(s.E);
    for (let x = Math.ceil(x0); x < x1; x++) {
      const r = rFromX(x + 0.5);
      if (r <= 0) continue;
      const v = veff(r);
      if (v > s.E) {
        ctx.fillStyle = col.forbid;
        ctx.fillRect(x, yTop, 1, yBot - yTop);
      } else {
        ctx.fillStyle = col.energy;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(x, yE, 1, Math.max(0, vy(v) - yE));
        ctx.globalAlpha = 1;
      }
    }

    // curves
    curve(ctx, vpot, col.v, 1.6, [6, 5]);
    curve(ctx, (r) => (s.l * s.l) / (2 * r * r), col.cent, 1.6, [2, 4]);
    curve(ctx, veff, col.veff, 2.6, null);

    // energy line
    ctx.strokeStyle = col.energy;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, yE);
    ctx.lineTo(x1, yE);
    ctx.stroke();

    // turning points
    const info = state.info;
    if (info && info.possible && !state.unstable) {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = col.energy;
      for (const [r, lab] of [[info.r1, "r₁"], [info.r2, "r₂"]]) {
        if (!(r > 0) || !isFinite(r) || r > state.view.rmax) continue;
        ctx.beginPath();
        ctx.moveTo(vx(r), yE);
        ctx.lineTo(vx(r), yBot);
        ctx.stroke();
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = col.ink;
        ctx.font = `500 12px ${col.mono}`;
        ctx.direction = "ltr";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(lab, vx(r), yBot - 4);
        ctx.restore();
      }
      ctx.setLineDash([]);
    }
    ctx.restore();

    // E label
    ctx.save();
    ctx.font = `500 12px ${col.mono}`;
    ctx.direction = "ltr";
    ctx.fillStyle = col.ink;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`E = ${fmt(s.E)}`, x1 - 4, yE - 5);
    ctx.restore();

    // particle and its radial kinetic energy
    if (info && info.possible) {
      const r = currentR();
      if (r <= state.view.rmax) {
        const x = vx(r);
        const v = veff(r);
        ctx.save();
        ctx.strokeStyle = col.energy;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, Math.min(yBot, vy(v)));
        ctx.lineTo(x, yE);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, yE, state.drag === "r0" ? 9 : 7, 0, Math.PI * 2);
        ctx.fillStyle = col.ink;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = col.panel;
        ctx.stroke();
        ctx.restore();
      }
    }

    // axes and titles
    ctx.save();
    ctx.strokeStyle = col.rule;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, yTop);
    ctx.lineTo(x0 + 0.5, yBot + 0.5);
    ctx.lineTo(x1, yBot + 0.5);
    ctx.stroke();
    ctx.fillStyle = col.muted;
    ctx.font = `12px ${col.mono}`;
    ctx.direction = "ltr";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("r", x0 + (x1 - x0) / 2, H - 2);
    ctx.save();
    ctx.translate(12, yTop + (yBot - yTop) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.direction = "rtl";
    ctx.font = `12px ${col.body}`;
    ctx.fillText("אנרגיה", 0, 0);
    ctx.restore();
    ctx.restore();
  }

  function curve(ctx, fn, color, width, dash) {
    const [W] = size.v;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    const lo = state.view.lo - (state.view.hi - state.view.lo);
    const hi = state.view.hi + (state.view.hi - state.view.lo);
    for (let x = VP.l; x <= W - VP.r; x += 1) {
      const r = rFromX(x);
      if (r <= 0) continue;
      const v = Math.max(lo, Math.min(hi, fn(r)));
      const y = vy(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Orbit plot ----------

  function drawO() {
    const ctx = ctxO;
    const [W, H] = size.o;
    if (!W || !state.run) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = col.panel;
    ctx.fillRect(0, 0, W, H);
    const run = state.run;
    const Rv = run.Rv;
    const cx = W / 2;
    const cy = H / 2;
    const sc = (Math.min(W, H) / 2 - 14) / Rv;
    const X = (x) => cx + x * sc;
    const Y = (y) => cy - y * sc;

    // grid: rings and axes
    const step = niceTick(Rv, 4);
    ctx.save();
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    for (let r = step; r <= Rv * 1.5; r += step) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * sc, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, cy + 0.5);
    ctx.lineTo(W, cy + 0.5);
    ctx.moveTo(cx + 0.5, 0);
    ctx.lineTo(cx + 0.5, H);
    ctx.stroke();
    // ring scale label
    ctx.fillStyle = col.muted;
    ctx.font = `11px ${col.mono}`;
    ctx.direction = "ltr";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`r = ${trim(step)}`, cx + step * sc + 4, cy - 4);
    ctx.restore();

    // allowed annulus
    const info = state.info;
    if (info && info.possible && !state.unstable) {
      ctx.save();
      ctx.fillStyle = col.energy;
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      const outer = isFinite(info.r2) ? info.r2 * sc : Math.hypot(W, H);
      ctx.arc(cx, cy, outer, 0, Math.PI * 2);
      if (info.r1 > 0) ctx.arc(cx, cy, info.r1 * sc, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col.energy;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.4;
      for (const r of [info.r1, info.r2]) {
        if (!(r > 0) || !isFinite(r)) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, r * sc, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // trail
    const tr = run.trail;
    if (tr.length > 1) {
      ctx.save();
      ctx.strokeStyle = col.ink;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(X(tr[0][0]), Y(tr[0][1]));
      for (let i = 1; i < tr.length; i++) ctx.lineTo(X(tr[i][0]), Y(tr[i][1]));
      ctx.lineTo(X(run.st.x), Y(run.st.y));
      ctx.stroke();
      ctx.restore();
    }

    // turning points passed so far
    ctx.save();
    ctx.fillStyle = col.energy;
    for (const [x, y] of run.apsides) {
      ctx.beginPath();
      ctx.arc(X(x), Y(y), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // center of force
    ctx.save();
    ctx.fillStyle = col.muted;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // particle and (when paused at the start) its velocity
    const st = run.st;
    if (info && info.possible) {
      if (!state.running && st.t === 0) {
        const v = Math.hypot(st.vx, st.vy);
        if (v > 0) {
          const len = Math.min(70, 26 + v * 18);
          const ux = st.vx / v;
          const uy = st.vy / v;
          const ax = X(st.x);
          const ay = Y(st.y);
          const bx = ax + ux * len;
          const by = ay - uy * len;
          ctx.save();
          ctx.strokeStyle = col.accent;
          ctx.fillStyle = col.accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          const ang = Math.atan2(by - ay, bx - ax);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - 9 * Math.cos(ang - 0.4), by - 9 * Math.sin(ang - 0.4));
          ctx.lineTo(bx - 9 * Math.cos(ang + 0.4), by - 9 * Math.sin(ang + 0.4));
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(X(st.x), Y(st.y), 6.5, 0, Math.PI * 2);
      ctx.fillStyle = col.ink;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = col.panel;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAll() {
    drawV();
    drawO();
  }

  // ---------- Readout ----------

  function closure(dTheta) {
    const q = dTheta / Math.PI;
    for (let den = 1; den <= 6; den++) {
      const num = Math.round(q * den);
      if (num > 0 && Math.abs(q - num / den) < 3e-4) return { num, den };
    }
    return null;
  }
  function piFrac(c) {
    if (c.den === 1) return c.num === 1 ? "π" : `${c.num}π`;
    return `${c.num === 1 ? "" : c.num}π/${c.den}`;
  }

  function renderReadout() {
    const i = state.info;
    const s = cfg();
    const kind = $("kind");
    const text = $("kind-text");
    kind.className = "badge";
    let msg = "";
    if (!i || !i.possible) {
      kind.textContent = "אין תנועה";
      kind.classList.add("fall");
      msg = "האנרגיה נמוכה מ־V′ בכל מקום, ולכן אין מקום שבו החלקיק יכול להיות. העלו את E.";
    } else if (state.unstable) {
      kind.textContent = "מסלול מעגלי לא יציב";
      kind.classList.add("open");
      msg = `האנרגיה בדיוק במקסימום של V′, ברדיוס ${fmt(s.r0)}. החלקיק יכול להקיף שם במעגל, אבל כל הפרעה קטנה מפילה אותו למרכז או משלחת אותו החוצה. גם אי־הדיוק של החישוב מספיק.`;
    } else if (i.circular) {
      kind.textContent = "מסלול מעגלי";
      msg = `האנרגיה בדיוק במינימום של V′, ולכן הטבעת מתכווצת למעגל ברדיוס ${fmt(0.5 * (i.r1 + i.r2))}.`;
    } else if (i.bounded) {
      kind.textContent = "מסלול חסום";
      const sw = i.swing;
      const c = sw ? closure(sw.dTheta) : null;
      msg = "החלקיק נע הלוך ושוב בין r₁ ל־r₂ ולא יוצא מהטבעת. ";
      if (sw && c) {
        msg += `הזווית בין שתי נקודות החזרה היא בדיוק ${piFrac(c)}, ולכן המסלול נסגר.`;
      } else if (sw) {
        const adv = (2 * sw.dTheta - 2 * Math.PI) * (180 / Math.PI);
        msg += `הזווית בין שתי נקודות החזרה אינה שבר פשוט של π, ולכן המסלול לא נסגר: הפריהליון ${adv > 0 ? "מתקדם" : "נסוג"} ב־${fmt(Math.abs(adv), 1)}° בכל הקפה.`;
      }
    } else if (i.r1 > 0) {
      kind.textContent = "לא חסום";
      kind.classList.add("open");
      msg = "החלקיק מגיע הכי קרוב עד r₁ וחוזר לאינסוף. זה מסלול פיזור.";
    } else if (isFinite(i.r2)) {
      kind.textContent = "נפילה למרכז";
      kind.classList.add("fall");
      msg = "החלקיק כלוא בתוך r₂, והמחסום הצנטריפוגלי לא חזק מספיק כדי לעצור אותו לפני המרכז.";
    } else {
      kind.textContent = s.inward ? "נפילה למרכז" : "בריחה";
      kind.classList.add(s.inward ? "fall" : "open");
      msg = "באנרגיה הזו אין נקודות החזרה בכלל. מה שקורה תלוי בכיוון ההתחלתי: פנימה החלקיק נופל למרכז, החוצה הוא בורח.";
    }
    const ev = state.run && state.run.event;
    if (ev === "center") msg += ` החלקיק הגיע למרכז אחרי t = ${fmt(state.run.st.t, 2)}.`;
    if (ev === "escape") msg += ` החלקיק יצא מהתמונה אחרי t = ${fmt(state.run.st.t, 2)}.`;
    text.textContent = msg;

    const num = (x) => `<span class="num">${x}</span>`;
    $("f-r1").innerHTML = i && i.possible && !state.unstable ? (i.r1 > 0 ? num(fmt(i.r1)) : `${num("0")}<small>מגיע למרכז</small>`) : "–";
    $("f-r2").innerHTML = i && i.possible && !state.unstable ? (isFinite(i.r2) ? num(fmt(i.r2)) : `${num("∞")}<small>בורח</small>`) : "–";
    if (i && i.swing) {
      const deg = (i.swing.dTheta * 180) / Math.PI;
      const c = closure(i.swing.dTheta);
      $("f-dtheta").innerHTML = `${num(fmt(deg, 2) + "°")}<small>${c ? "שבר של π: " + piFrac(c) : "לא שבר פשוט של π"}</small>`;
      $("f-period").innerHTML = `${num(fmt(i.swing.radialPeriod, 2))}<small>יחידות זמן</small>`;
    } else {
      $("f-dtheta").textContent = "–";
      $("f-period").textContent = "–";
    }
    updateLive();
    updatePlay();
  }

  function updateLive() {
    const r = state.run ? Math.hypot(state.run.st.x, state.run.st.y) : cfg().r0;
    $("f-r").innerHTML = `<span class="num">${fmt(r)}</span>`;
    $("clock").textContent = fmt(state.run ? state.run.st.t : 0, 1);
  }

  // ---------- Controls ----------

  function syncControls() {
    const s = cfg();
    $("l").value = s.l;
    $("l-out").innerHTML = `<span class="num">${fmt(s.l, 2)}</span>`;
    $("e").value = s.E;
    $("e-out").innerHTML = `<span class="num">${fmt(s.E)}</span>`;
    $(s.inward ? "dir-in" : "dir-out").checked = true;
    const p = pre().param;
    $("param-wrap").hidden = !p;
    if (p) {
      const el = $("param");
      el.min = p.min;
      el.max = p.max;
      el.step = p.step;
      el.value = prm()[p.key];
      $("param-label").textContent = PARAM_LABEL[p.key];
      $("param-out").innerHTML = `<span class="num">${fmt(prm()[p.key], p.step < 0.01 ? 3 : 2)}</span>`;
    }
  }

  /** Apply a change: re-analyse, reset the orbit, redraw. `viewToo` when V′ itself changed. */
  function changed(viewToo) {
    const wasRunning = state.running;
    if (viewToo) computeView();
    settle();
    resetRun();
    syncControls();
    renderReadout();
    drawAll();
    if (wasRunning) play();
  }

  function setPreset(key) {
    state.preset = key;
    state.unstable = false;
    for (const k of Object.keys(PRESETS)) $("tab-" + k).setAttribute("aria-selected", String(k === key));
    state.running = false;
    changed(true);
  }

  // V′ plot: drag E (anywhere) or the particle (to move the start radius)
  function veffPoint(e) {
    const r = cvV.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function nearParticle(pt) {
    if (!state.info || !state.info.possible) return false;
    const r = currentR();
    return Math.hypot(pt.x - vx(r), pt.y - vy(cfg().E)) < 16;
  }
  cvV.addEventListener("pointerdown", (e) => {
    const pt = veffPoint(e);
    state.unstable = false;
    cvV.setPointerCapture(e.pointerId);
    if (nearParticle(pt)) {
      state.drag = "r0";
      cvV.classList.add("grabbing");
      moveR0(pt);
    } else {
      state.drag = "E";
      moveE(pt);
    }
    hideTip();
  });
  cvV.addEventListener("pointermove", (e) => {
    const pt = veffPoint(e);
    if (state.drag === "r0") return moveR0(pt);
    if (state.drag === "E") return moveE(pt);
    cvV.classList.toggle("grab", nearParticle(pt));
    showVeffTip(pt);
  });
  const endDrag = () => {
    state.drag = null;
    cvV.classList.remove("grabbing");
    drawAll();
  };
  cvV.addEventListener("pointerup", endDrag);
  cvV.addEventListener("pointercancel", endDrag);
  cvV.addEventListener("pointerleave", hideTip);

  function moveE(pt) {
    cfg().E = Math.max(state.view.lo, Math.min(state.view.hi, eFromY(pt.y)));
    state.running = false;
    changed(false);
  }
  function moveR0(pt) {
    const s = cfg();
    const r = Math.max(rLo() * 2, Math.min(state.view.rmax, rFromX(pt.x)));
    const ok = C.nearestAllowed(pre(), prm(), s.l, s.E, r, rLo() * 2, state.view.rmax);
    if (ok != null) s.r0 = ok;
    state.running = false;
    changed(false);
  }

  function showVeffTip(pt) {
    const [W, H] = size.v;
    const tip = $("tip-veff");
    if (pt.x < VP.l || pt.x > W - VP.r || pt.y < VP.t || pt.y > H - VP.b) return hideTip();
    const r = rFromX(pt.x);
    if (r <= 0) return hideTip();
    const v = veff(r);
    const ok = cfg().E >= v;
    tip.innerHTML = `<span class="num">r = ${fmt(r, 2)}</span><br><span class="num">V′ = ${fmt(v)}</span><br>${ok ? "אזור מותר" : "אזור אסור"}`;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, pt.x))}px`;
    tip.style.top = `${Math.max(tip.offsetHeight + 14, Math.min(vy(v), H - VP.b))}px`;
  }
  function hideTip() {
    $("tip-veff").hidden = true;
  }

  $("play").addEventListener("click", () => (state.running ? pause() : play()));
  $("reset").addEventListener("click", () => {
    resetRun();
    renderReadout();
    drawAll();
  });
  $("circular").addEventListener("click", () => {
    // Prefer a minimum of V′ (stable orbit); otherwise use a maximum (unstable orbit).
    const s = cfg();
    const st = stationary();
    const best = st.find((x) => x.kind === "min") || st.find((x) => x.kind === "max");
    if (!best) return;
    s.r0 = best.r;
    s.E = veff(best.r) + (best.kind === "min" ? 1e-7 : 0);
    state.unstable = best.kind === "max";
    state.running = false;
    changed(false);
  });

  $("l").addEventListener("input", (e) => {
    cfg().l = parseFloat(e.target.value);
    state.unstable = false;
    changed(true);
  });
  $("e").addEventListener("input", (e) => {
    cfg().E = parseFloat(e.target.value);
    state.unstable = false;
    changed(false);
  });
  $("param").addEventListener("input", (e) => {
    const p = pre().param;
    prm()[p.key] = parseFloat(e.target.value);
    state.unstable = false;
    changed(true);
  });
  for (const el of document.querySelectorAll("input[name='dir']")) {
    el.addEventListener("change", (e) => {
      cfg().inward = e.target.value === "in";
      changed(false);
    });
  }
  for (const el of document.querySelectorAll("input[name='speed']")) {
    el.addEventListener("change", (e) => (state.speed = parseFloat(e.target.value)));
  }

  const keys = Object.keys(PRESETS);
  for (const k of keys) {
    const tab = $("tab-" + k);
    tab.addEventListener("click", () => setPreset(k));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // RTL: the left arrow moves to the next tab
      const idx = keys.indexOf(k) + (e.key === "ArrowLeft" ? 1 : -1);
      const next = keys[(idx + keys.length) % keys.length];
      $("tab-" + next).focus();
      setPreset(next);
    });
  }

  // Theme changes
  const onTheme = () => {
    readColors();
    drawAll();
  };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // ---------- Boot ----------

  readColors();
  computeView();
  // Start the Kepler preset from its pericenter, heading outward: the ellipse traces nicely.
  {
    const s = cfg();
    const iv = C.allowedInterval(pre(), prm(), s.l, s.E, 1, state.view.rmax * 40);
    if (iv && iv.r1 > 0) {
      s.r0 = iv.r1 * 1.0005;
      s.inward = false;
    }
  }
  changed(false);
  const ro = new ResizeObserver(resize);
  ro.observe(cvV);
  ro.observe(cvO);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onTheme);
})();
