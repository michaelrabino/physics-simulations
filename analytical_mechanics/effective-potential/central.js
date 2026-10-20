/*
 * central.js — the physics behind the effective potential lab.
 *
 * A particle of reduced mass μ = 1 moves in a central potential V(r).
 * Angular momentum l is conserved, and the radial motion is a 1-D problem in
 *
 *   V'(r) = V(r) + l² / (2 r²)          (Goldstein §3.3)
 *
 * with energy E = ½ ṙ² + V'(r). Wherever E ≥ V'(r) the motion is allowed; the
 * roots of E = V'(r) are the turning points. Units: μ = k = 1.
 *
 * The orbit itself is integrated in Cartesian coordinates with an adaptive
 * Dormand–Prince (RK45) step, so the picture does not rely on the
 * 1-D analysis it is meant to illustrate.
 *
 * Works as a browser script (window.Central) and as a Node module.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Central = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- Potentials ----------
  // Each has V(r, l, p) and dV(r, l, p) = dV/dr. `p` holds the preset parameter.
  const PRESETS = {
    kepler: {
      V: (r) => -1 / r,
      dV: (r) => 1 / (r * r),
      view: { rmax: 8, top: 0.8, floor: -2.5 },
      start: { l: 1, E: -0.3 },
    },
    hooke: {
      V: (r) => 0.5 * r * r,
      dV: (r) => r,
      view: { rmax: 3, top: 4.5, floor: 0 },
      start: { l: 1, E: 1.6 },
    },
    inv4: {
      // attractive force ∝ 1/r⁴  (Goldstein fig. 3.9)
      V: (r) => -1 / (3 * r * r * r),
      dV: (r) => 1 / (r * r * r * r),
      view: { rmax: 5, top: 0.5, floor: -0.6 },
      start: { l: 1, E: 0.1 },
    },
    yukawa: {
      V: (r, l, p) => -Math.exp(-r / p.a) / r,
      dV: (r, l, p) => Math.exp(-r / p.a) * (1 / (r * r) + 1 / (p.a * r)),
      param: { key: "a", min: 0.5, max: 10, step: 0.1, value: 3 },
      view: { rmax: 8, top: 0.8, floor: -2.5 },
      start: { l: 1, E: -0.15 },
    },
    gr: {
      // Kepler plus the relativistic term of the Schwarzschild orbit equation:
      // V = −1/r − ε l² / r³   (ε plays the role of GM/c² in these units)
      V: (r, l, p) => -1 / r - (p.eps * l * l) / (r * r * r),
      dV: (r, l, p) => 1 / (r * r) + (3 * p.eps * l * l) / (r * r * r * r),
      param: { key: "eps", min: 0, max: 0.15, step: 0.005, value: 0.04 },
      view: { rmax: 8, top: 0.8, floor: -1.2 },
      start: { l: 1, E: -0.3 },
    },
  };

  function Veff(pre, p, l, r) {
    return pre.V(r, l, p) + (l * l) / (2 * r * r);
  }

  // ---------- Turning points ----------

  const R_MIN = 1e-3;

  /** Roots of E = V'(r) on (R_MIN, rFar), found on a log grid and refined by bisection. */
  function turningPoints(pre, p, l, E, rFar) {
    const f = (r) => E - Veff(pre, p, l, r);
    const roots = [];
    const n = 4000;
    const a = Math.log(R_MIN);
    const b = Math.log(rFar);
    let r0 = R_MIN;
    let f0 = f(r0);
    for (let i = 1; i <= n; i++) {
      const r1 = Math.exp(a + ((b - a) * i) / n);
      const f1 = f(r1);
      if ((f0 < 0) !== (f1 < 0)) {
        let lo = r0;
        let hi = r1;
        let flo = f0;
        for (let k = 0; k < 80; k++) {
          const mid = 0.5 * (lo + hi);
          const fm = f(mid);
          if ((fm < 0) === (flo < 0)) {
            lo = mid;
            flo = fm;
          } else hi = mid;
        }
        roots.push(0.5 * (lo + hi));
      }
      r0 = r1;
      f0 = f1;
    }
    return roots;
  }

  /**
   * The allowed interval [r1, r2] that contains r0 (E ≥ V' inside it).
   * r1 = 0 means the particle can reach the center; r2 = Infinity means it escapes.
   * Returns null when r0 itself is a forbidden radius.
   */
  function allowedInterval(pre, p, l, E, r0, rFar) {
    if (E - Veff(pre, p, l, r0) < -1e-12) return null; // r0 itself is forbidden
    const roots = turningPoints(pre, p, l, E, rFar);
    let r1 = 0;
    let r2 = Infinity;
    for (const r of roots) {
      if (r <= r0) r1 = r;
      else if (r2 === Infinity) r2 = r;
    }
    // A root found right at the edge of the search range does not count as a turning point.
    if (r1 > 0 && r1 <= R_MIN * 1.01) r1 = 0;
    return { r1, r2, roots };
  }

  /** Closest radius to `r` where motion at energy E is allowed, or null if none. */
  function nearestAllowed(pre, p, l, E, r, rmin, rmax) {
    if (E - Veff(pre, p, l, r) >= 0) return r;
    let best = null;
    let bestD = Infinity;
    const n = 1200;
    for (let i = 0; i <= n; i++) {
      const rr = rmin + ((rmax - rmin) * i) / n;
      if (E - Veff(pre, p, l, rr) >= 0 && Math.abs(rr - r) < bestD) {
        bestD = Math.abs(rr - r);
        best = rr;
      }
    }
    return best;
  }

  /** Minimum of V' on [rmin, rmax] (radius and value): the circular orbit when it is a local minimum. */
  function veffMin(pre, p, l, rmin, rmax) {
    let best = { r: NaN, v: Infinity };
    const n = 3000;
    for (let i = 0; i <= n; i++) {
      const r = rmin * Math.pow(rmax / rmin, i / n);
      const v = Veff(pre, p, l, r);
      if (v < best.v) best = { r, v };
    }
    return best;
  }

  // ---------- Integrals over one radial swing ----------

  /**
   * For bounded motion between r1 and r2:
   *   Δθ  = ∫ l / r² · dr / ṙ        (angle from pericenter to apocenter)
   *   T_r = 2 ∫ dr / ṙ               (radial period)
   * with ṙ = sqrt(2 (E − V')). The substitution r = c + h·sin φ removes the
   * square-root singularities at the turning points.
   */
  function swing(pre, p, l, E, r1, r2) {
    const c = 0.5 * (r1 + r2);
    const h = 0.5 * (r2 - r1);
    if (h <= 1e-9) return null;
    const n = 4000; // even
    let sTheta = 0;
    let sTime = 0;
    for (let i = 0; i <= n; i++) {
      const phi = -Math.PI / 2 + (Math.PI * i) / n;
      let g;
      // At the end points use the limit: E − V' ≈ V''-like slope × (distance), cos φ cancels.
      const phiE = Math.abs(Math.abs(phi) - Math.PI / 2) < 1e-12 ? phi - Math.sign(phi) * 1e-6 : phi;
      const r = c + h * Math.sin(phiE);
      const kin = 2 * (E - Veff(pre, p, l, r));
      g = kin > 0 ? (h * Math.cos(phiE)) / Math.sqrt(kin) : 0;
      const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
      sTheta += (w * g * l) / (r * r);
      sTime += w * g;
    }
    const d = Math.PI / n / 3;
    return { dTheta: sTheta * d, radialPeriod: 2 * sTime * d };
  }

  // ---------- Orbit integration (adaptive Dormand–Prince RK45) ----------

  function initState(r0, E, l, pre, p, inward) {
    const kin = Math.max(0, 2 * (E - Veff(pre, p, l, r0)));
    const vr = Math.sqrt(kin) * (inward ? -1 : 1);
    return { x: r0, y: 0, vx: vr, vy: l / r0, t: 0, h: 1e-3 };
  }

  function deriv(pre, p, l, s) {
    const r = Math.hypot(s[0], s[1]);
    const a = -pre.dV(r, l, p) / r;
    return [s[2], s[3], a * s[0], a * s[1]];
  }

  const DP = {
    c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
    a: [
      [],
      [1 / 5],
      [3 / 40, 9 / 40],
      [44 / 45, -56 / 15, 32 / 9],
      [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
      [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
      [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
    ],
    b5: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
    b4: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40],
  };

  /**
   * Advance the state by `dt` of simulated time (many adaptive sub-steps).
   * Returns the new state and an event: "center" (r fell below rCenter),
   * "escape" (r grew beyond rEscape) or null. `onPoint` is called with each
   * accepted sub-step position (used to draw a smooth trail).
   */
  function advance(pre, p, l, st, dt, opts = {}) {
    const tol = opts.tol || 1e-9;
    const rCenter = opts.rCenter || 0.02;
    const rEscape = opts.rEscape || 1e3;
    let s = [st.x, st.y, st.vx, st.vy];
    let t = 0;
    let h = Math.min(st.h || 1e-3, dt);
    let event = null;
    let guard = 0;
    while (t < dt - 1e-15 && guard++ < 200000) {
      if (t + h > dt) h = dt - t;
      const k = [];
      for (let i = 0; i < 7; i++) {
        const si = s.slice();
        for (let j = 0; j < i; j++) for (let m = 0; m < 4; m++) si[m] += h * DP.a[i][j] * k[j][m];
        k.push(deriv(pre, p, l, si));
      }
      const y5 = s.slice();
      const y4 = s.slice();
      for (let i = 0; i < 7; i++) {
        for (let m = 0; m < 4; m++) {
          y5[m] += h * DP.b5[i] * k[i][m];
          y4[m] += h * DP.b4[i] * k[i][m];
        }
      }
      const scale = Math.max(1, Math.hypot(s[0], s[1]), Math.hypot(s[2], s[3]));
      let err = 0;
      for (let m = 0; m < 4; m++) err = Math.max(err, Math.abs(y5[m] - y4[m]) / scale);
      if (err <= tol || h < 1e-12) {
        s = y5;
        t += h;
        if (opts.onPoint) opts.onPoint(s[0], s[1]);
        const r = Math.hypot(s[0], s[1]);
        if (r < rCenter) {
          event = "center";
          break;
        }
        if (r > rEscape) {
          event = "escape";
          break;
        }
      }
      const fac = err === 0 ? 4 : Math.min(4, Math.max(0.2, 0.9 * Math.pow(tol / err, 0.2)));
      h *= fac;
    }
    return { state: { x: s[0], y: s[1], vx: s[2], vy: s[3], t: st.t + t, h }, event };
  }

  function energy(pre, p, l, st) {
    const r = Math.hypot(st.x, st.y);
    return 0.5 * (st.vx * st.vx + st.vy * st.vy) + pre.V(r, l, p);
  }
  function angularMomentum(st) {
    return st.x * st.vy - st.y * st.vx;
  }

  return {
    PRESETS,
    Veff,
    turningPoints,
    allowedInterval,
    nearestAllowed,
    veffMin,
    swing,
    initState,
    advance,
    energy,
    angularMomentum,
  };
});
