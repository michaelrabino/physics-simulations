/*
 * app.js — drawing, controls and the race clock.
 * All physics lives in physics.js (window.Brach).
 */
(function () {
  "use strict";
  const B = window.Brach;
  const $ = (id) => document.getElementById(id);

  // ---------- Model ----------

  const CURVES = [
    { id: "line", name: "קו ישר", sub: "הקצר ביותר", make: B.line, theory: B.lineTime },
    { id: "arc", name: "קשת מעגל", sub: "ההצעה של גלילאו", make: B.arc },
    { id: "parabola", name: "פרבולה", sub: "", make: B.parabola },
    { id: "cycloid", name: "ציקלואידה", sub: "הברכיסטוכרון", make: B.cycloid, theory: B.cycloidTime },
    { id: "drawn", name: "המסלול שלך", sub: "", make: null },
  ];
  const TAUT_COLORS = ["cycloid", "arc", "parabola", "drawn"];
  const TAUT_THETAS = [0.45, 1.1, 1.8, 2.5]; // release points on the cycloid (radians)
  const STROBE_DT = 0.05;

  const state = {
    mode: "race",
    X: 3,
    Y: 1.5,
    g: 9.81,
    speed: 1,
    strobe: true,
    enabled: { line: true, arc: true, parabola: true, cycloid: true, drawn: false },
    drawnN: null, // free-hand curve, normalized by X and Y so it follows B when B moves
    drawing: false,
    stroke: null,
    dragB: false,
    R: 0.6,
    tautTrack: "cycloid",
    runners: [],
    track: null, // tautochrone: the track drawn underneath
    reference: null, // tautochrone: faint cycloid when the circle is shown
    t: 0,
    tEnd: 1,
    running: false,
    finished: false,
    view: null,
    freezeView: false,
  };

  // ---------- Theme colors (read from CSS tokens) ----------

  let colors = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = {
      paper: v("--panel"),
      ink: v("--ink"),
      muted: v("--muted"),
      rule: v("--rule"),
      grid: v("--grid"),
      gridStrong: v("--grid-strong"),
      accent: v("--accent"),
      line: v("--c-line"),
      arc: v("--c-arc"),
      parabola: v("--c-parabola"),
      cycloid: v("--c-cycloid"),
      drawn: v("--c-drawn"),
      mono: v("--font-mono") || "monospace",
      body: v("--font-body") || "sans-serif",
    };
  }

  // ---------- Building the runners ----------

  function drawnPoints() {
    if (!state.drawnN) return null;
    return state.drawnN.map((p) => ({ x: p.x * state.X, y: p.y * state.Y }));
  }

  function build() {
    const g = state.g;
    const runners = [];
    state.track = null;
    state.reference = null;

    if (state.mode === "race") {
      for (const c of CURVES) {
        if (!state.enabled[c.id]) continue;
        const pts = c.id === "drawn" ? drawnPoints() : c.make(state.X, state.Y);
        if (!pts) continue;
        const runner = B.buildRunner(pts, g);
        runners.push({
          id: c.id,
          name: c.name,
          color: c.id,
          full: pts,
          runner,
          theory: c.theory ? c.theory(state.X, state.Y, g) : null,
          finishedAt: null,
        });
      }
    } else {
      const R = state.R;
      const cyc = B.tautochroneCycloid(R, TAUT_THETAS);
      if (state.tautTrack === "cycloid") {
        state.track = cyc.track;
        cyc.subs.forEach((sub, i) => {
          const th = TAUT_THETAS[i];
          runners.push(tautRunner(i, sub, R * (1 + Math.cos(th)), Math.PI * Math.sqrt(R / g)));
        });
      } else {
        const depths = TAUT_THETAS.map((th) => R * (1 - Math.cos(th)));
        const circ = B.tautochroneCircle(R, depths);
        state.track = circ.track;
        state.reference = cyc.track;
        circ.subs.forEach((sub, i) => {
          runners.push(tautRunner(i, sub, 2 * R - depths[i], null));
        });
      }
    }

    state.runners = runners;
    const reaching = runners.filter((r) => r.runner.reaches).map((r) => r.runner.total);
    if (reaching.length) state.tEnd = Math.max(...reaching);
    else state.tEnd = Math.max(2, ...runners.map((r) => 2 * r.runner.total)) * 2;

    // Samples for the speed chart.
    const N = 240;
    for (const r of runners) {
      const last = r.runner.reaches ? Math.min(r.runner.total, state.tEnd) : state.tEnd;
      r.samples = [];
      for (let k = 0; k <= N; k++) {
        const tt = (k / N) * last;
        r.samples.push({ t: tt, v: Math.abs(B.stateAt(r.runner, tt).v) });
      }
    }
    resetClock();
  }

  function tautRunner(i, pts, height, theory) {
    return {
      id: "ball" + i,
      name: "כדור " + (i + 1),
      color: TAUT_COLORS[i],
      full: pts,
      runner: B.buildRunner(pts, state.g),
      theory,
      height,
      finishedAt: null,
    };
  }

  // ---------- View (world <-> screen) ----------

  const canvas = $("track");
  const ctx = canvas.getContext("2d");
  const chart = $("chart");
  const cctx = chart.getContext("2d");
  let W = 0;
  let H = 0;
  let CW = 0;
  let CH = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rc = chart.getBoundingClientRect();
    CW = rc.width;
    CH = rc.height;
    chart.width = Math.round(CW * dpr);
    chart.height = Math.round(CH * dpr);
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!state.freezeView) fitView();
    draw();
    drawChart();
  }

  function fitView() {
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    const take = (pts) => {
      for (let i = 0; i < pts.length; i += 4) {
        const p = pts[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const p = pts[pts.length - 1];
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    };
    if (state.mode === "race") {
      maxX = state.X;
      maxY = state.Y;
      for (const r of state.runners) take(r.full);
      const d = drawnPoints();
      if (d && !state.enabled.drawn) take(d);
    } else {
      take(state.track);
      if (state.reference) take(state.reference);
    }
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 0.6);
    const padX = Math.max(36, W * 0.06);
    const padTop = 52;
    const padBottom = 36;
    const scale = Math.min((W - 2 * padX) / w, (H - padTop - padBottom) / h);
    const ox = (W - w * scale) / 2 - minX * scale;
    const oy = padTop + (H - padTop - padBottom - h * scale) / 2 - minY * scale;
    state.view = { scale, ox, oy };
  }

  const sx = (x) => state.view.ox + x * state.view.scale;
  const sy = (y) => state.view.oy + y * state.view.scale;
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { x: (px - state.view.ox) / state.view.scale, y: (py - state.view.oy) / state.view.scale, px, py };
  }

  // ---------- Drawing the board ----------

  function niceStep(pxPerUnit, minPx) {
    const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];
    for (const s of steps) if (s * pxPerUnit >= minPx) return s;
    return 10;
  }

  function fmt(n, d) {
    return n.toFixed(d);
  }
  // A number with a Hebrew unit: the number is isolated as LTR so the pair reads correctly in RTL.
  function nu(text, unit) {
    return `<span class="num">${text}</span>${unit ? " " + unit : ""}`;
  }

  function draw() {
    if (!state.view) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, W, H);

    drawGrid();

    // Start height reference.
    const yStart = state.mode === "race" ? 0 : 0;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = colors.muted;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, sy(yStart));
    ctx.lineTo(W, sy(yStart));
    ctx.stroke();
    ctx.restore();

    if (state.mode === "race") drawRaceTracks();
    else drawTautTracks();

    drawStrobes();
    drawBalls();

    if (state.mode === "race") drawEndpoints();

    if (state.stroke && state.stroke.length > 1) {
      ctx.save();
      ctx.strokeStyle = colors.drawn;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(sx(0), sy(0));
      for (const p of state.stroke) ctx.lineTo(sx(p.x), sy(p.y));
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawGrid() {
    const s = state.view.scale;
    const step = niceStep(s, 46);
    const x0 = Math.floor(-state.view.ox / s / step) * step;
    const x1 = (W - state.view.ox) / s;
    const y0 = Math.floor(-state.view.oy / s / step) * step;
    const y1 = (H - state.view.oy) / s;
    ctx.save();
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += step) {
      const major = Math.abs(x / (step * 2) - Math.round(x / (step * 2))) < 1e-6;
      ctx.strokeStyle = major ? colors.gridStrong : colors.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(sx(x)) + 0.5, 0);
      ctx.lineTo(Math.round(sx(x)) + 0.5, H);
      ctx.stroke();
    }
    for (let y = y0; y <= y1; y += step) {
      const major = Math.abs(y / (step * 2) - Math.round(y / (step * 2))) < 1e-6;
      ctx.strokeStyle = major ? colors.gridStrong : colors.grid;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(sy(y)) + 0.5);
      ctx.lineTo(W, Math.round(sy(y)) + 0.5);
      ctx.stroke();
    }
    // Scale bar (bottom-left): one grid step, labelled in meters.
    const bx = 14;
    const by = H - 14;
    const len = step * s;
    ctx.strokeStyle = colors.muted;
    ctx.fillStyle = colors.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx, by - 5);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + len, by);
    ctx.lineTo(bx + len, by - 5);
    ctx.stroke();
    ctx.font = `12px ${colors.mono}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.direction = "ltr";
    ctx.fillText(`${step} m`, bx + len + 6, by + 1);
    ctx.restore();
  }

  function strokePath(pts, color, width, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    const stepI = Math.max(1, Math.floor(pts.length / 600));
    ctx.moveTo(sx(pts[0].x), sy(pts[0].y));
    for (let i = stepI; i < pts.length; i += stepI) ctx.lineTo(sx(pts[i].x), sy(pts[i].y));
    const last = pts[pts.length - 1];
    ctx.lineTo(sx(last.x), sy(last.y));
    ctx.stroke();
    ctx.restore();
  }

  function drawRaceTracks() {
    // Draw the winner-to-be last so it sits on top.
    const order = [...state.runners].sort((a, b) => (a.id === "cycloid") - (b.id === "cycloid"));
    for (const r of order) {
      if (!r.runner.reaches) {
        strokePath(r.full, colors[r.color], 2, [4, 6]);
        strokePath(r.runner.pts, colors[r.color], 3);
      } else {
        strokePath(r.full, colors[r.color], 3);
      }
    }
  }

  function drawTautTracks() {
    if (state.reference) strokePath(state.reference, colors.muted, 1.5, [5, 6]);
    strokePath(state.track, colors.ink, 3);
    // Bottom marker
    const bottom = state.tautTrack === "cycloid" ? state.track[state.track.length - 1] : state.track[state.track.length - 1];
    ctx.save();
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx(bottom.x), sy(bottom.y) - 22);
    ctx.lineTo(sx(bottom.x), sy(bottom.y) + 10);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.font = `13px ${colors.body}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("תחתית", sx(bottom.x), sy(bottom.y) + 12);
    ctx.restore();
    // Release-height ticks
    for (const r of state.runners) {
      const p = r.full[0];
      ctx.save();
      ctx.fillStyle = colors[r.color];
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawStrobes() {
    if (!state.strobe || state.t <= 0) return;
    for (const r of state.runners) {
      const lim = r.runner.reaches ? Math.min(state.t, r.runner.total) : state.t;
      const n = Math.floor(lim / STROBE_DT);
      ctx.save();
      ctx.fillStyle = colors[r.color];
      ctx.globalAlpha = 0.55;
      for (let k = 1; k <= n && k < 400; k++) {
        const p = B.stateAt(r.runner, k * STROBE_DT);
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.y), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBalls() {
    for (const r of state.runners) {
      const p = B.stateAt(r.runner, state.t);
      const x = sx(p.x);
      const y = sy(p.y);
      ctx.save();
      ctx.fillStyle = colors[r.color];
      ctx.strokeStyle = colors.paper;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEndpoints() {
    const ax = sx(0);
    const ay = sy(0);
    const bx = sx(state.X);
    const by = sy(state.Y);
    ctx.save();
    ctx.font = `600 15px ${colors.body}`;
    ctx.textBaseline = "middle";
    ctx.direction = "ltr";
    // A
    ctx.fillStyle = colors.ink;
    ctx.beginPath();
    ctx.arc(ax, ay, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillText("A", ax - 14, ay - 12);
    // B (draggable)
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = state.dragB ? 0.25 : 0.1;
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(bx, by, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.ink;
    ctx.textAlign = "left";
    ctx.fillText("B", bx + 18, by - 14);
    ctx.restore();
  }

  // ---------- Speed chart ----------

  function drawChart() {
    if (!CW) return;
    const c = cctx;
    c.clearRect(0, 0, CW, CH);
    c.fillStyle = colors.paper;
    c.fillRect(0, 0, CW, CH);

    const padL = 48;
    const padR = 16;
    const padT = 16;
    const padB = 36;
    const pw = CW - padL - padR;
    const ph = CH - padT - padB;

    const tMax = state.tEnd || 1;
    let vMax = 0.1;
    for (const r of state.runners) for (const s of r.samples || []) vMax = Math.max(vMax, s.v);
    vMax *= 1.08;

    const X = (t) => padL + (t / tMax) * pw;
    const Y = (v) => padT + ph - (v / vMax) * ph;

    c.save();
    c.direction = "ltr";
    c.font = `11px ${colors.mono}`;
    c.lineWidth = 1;
    // grid + ticks
    const tStep = niceTick(tMax, 6);
    const vStep = niceTick(vMax, 5);
    c.textBaseline = "top";
    c.textAlign = "center";
    for (let t = 0; t <= tMax + 1e-9; t += tStep) {
      c.strokeStyle = colors.grid;
      c.beginPath();
      c.moveTo(Math.round(X(t)) + 0.5, padT);
      c.lineTo(Math.round(X(t)) + 0.5, padT + ph);
      c.stroke();
      c.fillStyle = colors.muted;
      c.fillText(trimNum(t), X(t), padT + ph + 6);
    }
    c.textAlign = "right";
    c.textBaseline = "middle";
    for (let v = 0; v <= vMax + 1e-9; v += vStep) {
      c.strokeStyle = colors.grid;
      c.beginPath();
      c.moveTo(padL, Math.round(Y(v)) + 0.5);
      c.lineTo(padL + pw, Math.round(Y(v)) + 0.5);
      c.stroke();
      c.fillStyle = colors.muted;
      c.fillText(trimNum(v), padL - 6, Y(v));
    }
    c.strokeStyle = colors.rule;
    c.beginPath();
    c.moveTo(padL + 0.5, padT);
    c.lineTo(padL + 0.5, padT + ph + 0.5);
    c.lineTo(padL + pw, padT + ph + 0.5);
    c.stroke();

    // axis titles
    c.fillStyle = colors.muted;
    c.font = `12px ${colors.body}`;
    c.textAlign = "center";
    c.textBaseline = "bottom";
    c.direction = "rtl";
    c.fillText("זמן (ש')", padL + pw / 2, CH - 2);
    c.save();
    c.translate(12, padT + ph / 2);
    c.rotate(-Math.PI / 2);
    c.textBaseline = "middle";
    c.fillText("מהירות (מ'/ש')", 0, 0);
    c.restore();

    // curves up to the current time
    const now = state.finished ? tMax : state.t;
    if (now <= 0) {
      c.fillStyle = colors.muted;
      c.font = `13px ${colors.body}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("הגרף יתמלא בזמן המרוץ", padL + pw / 2, padT + ph / 2);
    } else {
      for (const r of state.runners) {
        c.strokeStyle = colors[r.color];
        c.lineWidth = 2;
        c.lineJoin = "round";
        c.beginPath();
        let started = false;
        for (const s of r.samples) {
          if (s.t > now) break;
          if (!started) {
            c.moveTo(X(s.t), Y(s.v));
            started = true;
          } else c.lineTo(X(s.t), Y(s.v));
        }
        const cur = Math.min(now, r.samples[r.samples.length - 1].t);
        const st = B.stateAt(r.runner, cur);
        c.lineTo(X(cur), Y(Math.abs(st.v)));
        c.stroke();
        c.fillStyle = colors[r.color];
        c.beginPath();
        c.arc(X(cur), Y(Math.abs(st.v)), 3, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }

  function niceTick(max, count) {
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
    return 10 * mag;
  }
  function trimNum(n) {
    return String(Math.round(n * 1000) / 1000);
  }

  // ---------- Results table ----------

  function renderHead() {
    const head = $("results-head");
    head.innerHTML =
      state.mode === "race"
        ? "<tr><th>מקום</th><th>מסלול</th><th>זמן הגעה</th><th>לפי נוסחה</th><th>פער מהציקלואידה</th></tr>"
        : "<tr><th>כדור</th><th>גובה שחרור מעל התחתית</th><th>זמן הגעה לתחתית</th><th>לפי נוסחה <bdi dir='ltr'>π√(R/g)</bdi></th></tr>";
  }

  function renderTable() {
    const body = $("results-body");
    const rows = [];
    const done = state.finished;
    const cyc = state.runners.find((r) => r.id === "cycloid");

    if (state.mode === "race") {
      const ranked = state.runners
        .map((r, i) => ({ r, i }))
        .sort((a, b) => rankTime(a.r, a.i) - rankTime(b.r, b.i))
        .map((o) => o.r);
      let place = 0;
      for (const r of ranked) {
        const known = r.finishedAt != null;
        if (known) place++;
        const time = known ? nu(fmt(r.finishedAt, 3), "ש'") : r.runner.reaches ? "…" : "לא מגיע";
        const theory = r.theory != null ? nu(fmt(r.theory, 3), "ש'") : "–";
        let gap = "–";
        if (known && cyc && cyc.finishedAt != null && r.id !== "cycloid") {
          const d = r.finishedAt - cyc.finishedAt;
          gap = nu(`${d >= 0 ? "+" : "−"}${fmt(Math.abs(d), 3)}`, "ש'") + " " + nu(`(${fmt((100 * d) / cyc.finishedAt, 1)}%)`);
        }
        const tag = r.id === "line" ? "<span class='tag'>הקצר ביותר</span>" : "";
        rows.push(
          `<tr class="${known && place === 1 ? "winner" : ""}">` +
            `<td class="place">${known ? place : "·"}</td>` +
            `<td><span class="dot" style="--sw: var(--c-${r.color})"></span>${r.name}${tag}</td>` +
            `<td class="${known ? "" : "pending"}">${time}</td>` +
            `<td>${theory}</td>` +
            `<td>${gap}</td>` +
            `</tr>`
        );
      }
    } else {
      for (const r of state.runners) {
        const known = r.finishedAt != null;
        rows.push(
          `<tr>` +
            `<td><span class="dot" style="--sw: var(--c-${r.color})"></span>${r.name}</td>` +
            `<td>${nu(fmt(r.height * 100, 0), 'ס"מ')}</td>` +
            `<td class="${known ? "" : "pending"}">${known ? nu(fmt(r.finishedAt, 3), "ש'") : "…"}</td>` +
            `<td>${r.theory != null ? nu(fmt(r.theory, 3), "ש'") : "–"}</td>` +
            `</tr>`
        );
      }
    }
    body.innerHTML = rows.join("");
    $("verdict").textContent = done ? verdict() : "";
  }

  // Finished runners first, by time. The rest keep their list order, so the
  // table does not give away the result before the race ends.
  function rankTime(r, i) {
    if (r.finishedAt != null) return r.finishedAt;
    return (r.runner.reaches ? 1e6 : 1e9) + i;
  }

  function verdict() {
    if (state.mode === "race") {
      const fin = state.runners.filter((r) => r.finishedAt != null).sort((a, b) => a.finishedAt - b.finishedAt);
      if (!fin.length) return "אף כדור לא הגיע ל־B: המסלול עולה מעל גובה ההתחלה, והכדור חוזר אחורה.";
      const first = fin[0];
      const lineR = fin.find((r) => r.id === "line");
      let s = `הכדור על ה${first.name} הגיע ראשון, אחרי ${fmt(first.finishedAt, 3)} ש'.`;
      if (first.id === "drawn") s = `הכדור על המסלול שלך הגיע ראשון, אחרי ${fmt(first.finishedAt, 3)} ש'.`;
      if (lineR && first.id !== "line") {
        s += ` הקו הישר, הקצר מכולם, הגיע אחרי ${fmt(lineR.finishedAt, 3)} ש'.`;
      }
      const dipped = state.runners.find((r) => r.id === "cycloid" && r.full.some((p) => p.y > state.Y + 1e-6));
      if (dipped) s += " שימו לב שהציקלואידה יורדת מתחת ל־B ועולה אליה בסוף.";
      const stuck = state.runners.find((r) => !r.runner.reaches);
      if (stuck) s += " המסלול שלך עולה מעל גובה ההתחלה, ולכן הכדור עליו נעצר וחוזר.";
      return s;
    }
    const ts = state.runners.map((r) => r.finishedAt).filter((x) => x != null);
    if (!ts.length) return "";
    const spread = Math.max(...ts) - Math.min(...ts);
    if (state.tautTrack === "cycloid") {
      return `כל ארבעת הכדורים הגיעו לתחתית אחרי ${fmt(ts[0], 3)} ש', אף שיצאו מגבהים שונים. ההפרש ביניהם: ${fmt(spread * 1000, 1)} אלפיות שנייה.`;
    }
    return `במסילה המעגלית זמני ההגעה שונים: הפרש של ${fmt(spread, 3)} ש' בין הכדור המהיר לאיטי. הכדור שיצא מהגובה הרב ביותר הגיע אחרון.`;
  }

  // ---------- Clock ----------

  let lastFrame = 0;

  function resetClock() {
    state.t = 0;
    state.running = false;
    state.finished = false;
    for (const r of state.runners) r.finishedAt = null;
    updateClock();
    updateButtons();
    renderTable();
  }

  function start() {
    if (state.finished || state.t > 0) resetClock();
    if (!state.runners.length) return;
    state.running = true;
    lastFrame = performance.now();
    updateButtons();
    requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!state.running) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    state.t += dt * state.speed;
    let changed = false;
    for (const r of state.runners) {
      if (r.runner.reaches && r.finishedAt == null && state.t >= r.runner.total) {
        r.finishedAt = r.runner.total;
        changed = true;
      }
    }
    if (state.t >= state.tEnd) {
      state.t = state.tEnd;
      state.running = false;
      state.finished = true;
      changed = true;
      updateButtons();
    }
    if (changed) renderTable();
    updateClock();
    draw();
    drawChart();
    if (state.running) requestAnimationFrame(tick);
  }

  function updateClock() {
    $("clock").textContent = fmt(state.t, 3);
  }

  function updateButtons() {
    const go = $("go");
    go.textContent = state.running ? "רץ…" : state.finished ? "שחרר שוב" : "שחרר את הכדורים";
    go.disabled = state.running || state.drawing;
  }

  // ---------- Controls ----------

  function renderCurveList() {
    const ul = $("curve-list");
    ul.innerHTML = "";
    for (const c of CURVES) {
      const li = document.createElement("li");
      const disabled = c.id === "drawn" && !state.drawnN;
      if (disabled) li.className = "disabled";
      li.innerHTML =
        `<label for="cv-${c.id}">` +
        `<input type="checkbox" id="cv-${c.id}" ${state.enabled[c.id] ? "checked" : ""} ${disabled ? "disabled" : ""}>` +
        `<span class="swatch" style="--sw: var(--c-${c.id})"></span>` +
        `<span class="name">${c.name}${c.sub ? `<span class="sub">${c.sub}</span>` : ""}${disabled ? `<span class="sub">צייר כדי להוסיף</span>` : ""}</span>` +
        `</label>`;
      li.querySelector("input").addEventListener("change", (e) => {
        state.enabled[c.id] = e.target.checked;
        rebuild();
      });
      ul.appendChild(li);
    }
    $("clear-draw").hidden = !state.drawnN;
  }

  function rebuild(keepView) {
    build();
    if (!keepView && !state.freezeView) fitView();
    draw();
    drawChart();
  }

  function setMode(mode) {
    if (state.drawing) stopDrawing(false);
    state.mode = mode;
    $("tab-race").setAttribute("aria-selected", String(mode === "race"));
    $("tab-taut").setAttribute("aria-selected", String(mode === "taut"));
    $("race-controls").hidden = mode !== "race";
    $("taut-controls").hidden = mode !== "taut";
    $("results-title").textContent = mode === "race" ? "תוצאות המרוץ" : "זמני הגעה לתחתית";
    $("track").setAttribute(
      "aria-label",
      mode === "race" ? "המסלולים והכדורים. אפשר לגרור את נקודה B." : "מסילת הטאוטוכרון וארבעה כדורים בגבהים שונים."
    );
    renderHead();
    rebuild();
  }

  function setX(v) {
    state.X = v;
    $("x").value = String(v);
    $("x-out").innerHTML = nu(fmt(v, 1), "מ'");
  }
  function setY(v) {
    state.Y = v;
    $("y").value = String(v);
    $("y-out").innerHTML = nu(fmt(v, 1), "מ'");
  }

  // Free-hand drawing
  function startDrawing() {
    resetClock();
    state.drawing = true;
    state.freezeView = true;
    canvas.classList.add("drawing");
    $("draw").setAttribute("aria-pressed", "true");
    $("draw").textContent = "בטל ציור";
    showHint("גררו מסלול מ־A אל B. הקצוות יתחברו ל־A ול־B אוטומטית.");
    updateButtons();
    draw();
  }
  function stopDrawing(commit) {
    state.drawing = false;
    canvas.classList.remove("drawing");
    $("draw").setAttribute("aria-pressed", "false");
    $("draw").textContent = state.drawnN ? "צייר מסלול אחר" : "צייר מסלול משלך";
    if (commit && state.stroke && state.stroke.length > 3) {
      const spacing = Math.max(state.X, state.Y) / 120;
      const pts = B.cleanStroke(state.stroke, state.X, state.Y, spacing);
      if (pts) {
        state.drawnN = pts.map((p) => ({ x: p.x / state.X, y: p.y / state.Y }));
        state.enabled.drawn = true;
      }
    }
    state.stroke = null;
    state.freezeView = false;
    hideHint();
    renderCurveList();
    rebuild();
    updateButtons();
  }

  function showHint(text) {
    const h = $("hint");
    h.textContent = text;
    h.hidden = false;
  }
  function hideHint() {
    $("hint").hidden = true;
  }

  function nearB(w) {
    if (state.mode !== "race") return false;
    return Math.hypot(w.px - sx(state.X), w.py - sy(state.Y)) < 26;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.view) return;
    const w = toWorld(e);
    if (state.drawing) {
      state.stroke = [{ x: w.x, y: w.y }];
      canvas.setPointerCapture(e.pointerId);
      draw();
      return;
    }
    if (nearB(w) && !state.running) {
      state.dragB = true;
      state.freezeView = true;
      canvas.classList.add("grabbing");
      canvas.setPointerCapture(e.pointerId);
      resetClock();
      draw();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.view) return;
    const w = toWorld(e);
    if (state.drawing && state.stroke) {
      state.stroke.push({ x: w.x, y: w.y });
      draw();
      return;
    }
    if (state.dragB) {
      setX(Math.round(Math.min(8, Math.max(0.3, w.x)) * 20) / 20);
      setY(Math.round(Math.min(4, Math.max(0.2, w.y)) * 20) / 20);
      rebuild(true);
      return;
    }
    canvas.classList.toggle("grab", !state.drawing && nearB(w) && !state.running);
  });

  function endPointer() {
    if (state.drawing && state.stroke) {
      stopDrawing(true);
      return;
    }
    if (state.dragB) {
      state.dragB = false;
      state.freezeView = false;
      canvas.classList.remove("grabbing");
      // Snap the sliders to their own step after a drag.
      setX(Math.round(state.X * 10) / 10);
      setY(Math.round(state.Y * 10) / 10);
      rebuild();
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  $("go").addEventListener("click", start);
  $("reset").addEventListener("click", () => {
    resetClock();
    draw();
    drawChart();
  });
  $("draw").addEventListener("click", () => {
    if (state.drawing) stopDrawing(false);
    else startDrawing();
  });
  $("clear-draw").addEventListener("click", () => {
    state.drawnN = null;
    state.enabled.drawn = false;
    $("draw").textContent = "צייר מסלול משלך";
    renderCurveList();
    rebuild();
  });

  $("tab-race").addEventListener("click", () => setMode("race"));
  $("tab-taut").addEventListener("click", () => setMode("taut"));
  for (const id of ["tab-race", "tab-taut"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const next = id === "tab-race" ? "tab-taut" : "tab-race";
        $(next).focus();
        setMode(next === "tab-race" ? "race" : "taut");
      }
    });
  }

  $("x").addEventListener("input", (e) => {
    setX(parseFloat(e.target.value));
    rebuild();
  });
  $("y").addEventListener("input", (e) => {
    setY(parseFloat(e.target.value));
    rebuild();
  });
  $("r").addEventListener("input", (e) => {
    state.R = parseFloat(e.target.value);
    $("r-out").innerHTML = nu(fmt(state.R, 2), "מ'");
    rebuild();
  });
  for (const el of document.querySelectorAll("input[name='taut-track']")) {
    el.addEventListener("change", (e) => {
      state.tautTrack = e.target.value;
      rebuild();
    });
  }
  $("g").addEventListener("change", (e) => {
    state.g = parseFloat(e.target.value);
    rebuild(true);
  });
  for (const el of document.querySelectorAll("input[name='speed']")) {
    el.addEventListener("change", (e) => {
      state.speed = parseFloat(e.target.value);
    });
  }
  $("strobe").addEventListener("change", (e) => {
    state.strobe = e.target.checked;
    draw();
  });

  // Keyboard: space releases the beads (when focus is not in a form field).
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (["INPUT", "SELECT", "BUTTON", "TEXTAREA"].includes(tag)) return;
    e.preventDefault();
    if (!state.running) start();
  });

  // Theme changes: re-read the tokens and repaint.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onTheme = () => {
    readColors();
    draw();
    drawChart();
  };
  if (mq.addEventListener) mq.addEventListener("change", onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // ---------- Boot ----------

  readColors();
  renderCurveList();
  renderHead();
  build();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  ro.observe(chart);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onTheme);
})();
