/*
 * physics.js — the physics behind the brachistochrone race.
 *
 * Coordinate system: x to the right, y DOWNWARD (y is the depth below the
 * start point). Start A = (0, 0), finish B = (X, Y) with Y > 0.
 *
 * A bead slides without friction from rest. Energy conservation gives the
 * speed at depth h below its starting point: v = sqrt(2 g h).
 *
 * Every curve is represented as a fine polyline. On each straight segment the
 * acceleration is constant, so the time to cross a segment of length L is
 * exactly  dt = 2L / (v_start + v_end).  This handles the start from rest
 * (v = 0) without any singular integral, and it converges to the exact
 * curve time as the number of points grows (checked in tests/physics.test.js
 * against the closed-form times for the straight line and the cycloid).
 *
 * The file works both as a browser script (defines window.Brach) and as a
 * Node module (module.exports), so the same code is tested and displayed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Brach = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_N = 1500;

  // ---------- Curves from A = (0,0) to B = (X, Y) ----------

  /** Straight line (the shortest path, but not the fastest). */
  function line(X, Y, n = DEFAULT_N) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      pts.push({ x: u * X, y: u * Y });
    }
    return pts;
  }

  /**
   * Circular arc with a vertical tangent at A (Galileo's guess).
   * Center at (r, 0) with r chosen so the circle passes through B.
   */
  function arc(X, Y, n = DEFAULT_N) {
    const r = (X * X + Y * Y) / (2 * X);
    const phiEnd = Math.atan2(Y, r - X);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const phi = (i / n) * phiEnd;
      pts.push({ x: r - r * Math.cos(phi), y: r * Math.sin(phi) });
    }
    pts[n] = { x: X, y: Y };
    return pts;
  }

  /** Parabola with its vertex at B: y = Y (1 - (1 - x/X)^2). */
  function parabola(X, Y, n = DEFAULT_N) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      pts.push({ x: u * X, y: Y * (1 - (1 - u) * (1 - u)) });
    }
    return pts;
  }

  /**
   * Cycloid parameters through A and B:
   *   x = R (θ - sin θ),  y = R (1 - cos θ)   (y downward)
   * θ_end solves (θ - sin θ) / (1 - cos θ) = X / Y on (0, 2π).
   */
  function cycloidParams(X, Y) {
    const target = X / Y;
    const f = (t) => (t - Math.sin(t)) / (1 - Math.cos(t));
    let lo = 1e-9;
    let hi = 2 * Math.PI - 1e-9;
    for (let k = 0; k < 200; k++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) < target) lo = mid;
      else hi = mid;
    }
    const thetaEnd = 0.5 * (lo + hi);
    const R = Y / (1 - Math.cos(thetaEnd));
    return { R, thetaEnd };
  }

  /** The cycloid: the brachistochrone itself. */
  function cycloid(X, Y, n = DEFAULT_N) {
    const { R, thetaEnd } = cycloidParams(X, Y);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * thetaEnd;
      pts.push({ x: R * (t - Math.sin(t)), y: R * (1 - Math.cos(t)) });
    }
    pts[n] = { x: X, y: Y };
    return pts;
  }

  // ---------- Closed-form times (for comparison) ----------

  function lineTime(X, Y, g) {
    return Math.sqrt((2 * (X * X + Y * Y)) / (g * Y));
  }

  function cycloidTime(X, Y, g) {
    const { R, thetaEnd } = cycloidParams(X, Y);
    return thetaEnd * Math.sqrt(R / g);
  }

  // ---------- Motion along any polyline ----------

  /**
   * Precompute the motion of a bead released from rest at pts[0].
   * Returns cumulative arc length s[], time t[] and speed v[] at each vertex.
   * If the path rises back to the starting height, the bead stops there and
   * slides back: `reaches` is false and `total` is the time to that turning
   * point (the motion is then periodic with period 2 * total).
   */
  function buildRunner(pts, g) {
    const y0 = pts[0].y;
    const P = [{ x: pts[0].x, y: pts[0].y }];
    const s = [0];
    const t = [0];
    const v = [0];
    let reaches = true;

    for (let i = 1; i < pts.length; i++) {
      const a = P[P.length - 1];
      const b = pts[i];
      const h = b.y - y0;
      const vPrev = v[v.length - 1];

      if (h <= 1e-12) {
        // The bead cannot get here: it turns around where h = 0 on this segment.
        const hPrev = a.y - y0;
        const frac = hPrev > 0 ? hPrev / (hPrev - h) : 0;
        const tp = { x: a.x + frac * (b.x - a.x), y: a.y + frac * (b.y - a.y) };
        const L = Math.hypot(tp.x - a.x, tp.y - a.y);
        P.push(tp);
        s.push(s[s.length - 1] + L);
        t.push(t[t.length - 1] + (vPrev > 0 ? (2 * L) / vPrev : 0));
        v.push(0);
        reaches = false;
        break;
      }

      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-15) continue;
      const vi = Math.sqrt(2 * g * h);
      P.push({ x: b.x, y: b.y });
      s.push(s[s.length - 1] + L);
      t.push(t[t.length - 1] + (2 * L) / (vPrev + vi));
      v.push(vi);
    }

    return { pts: P, s, t, v, total: t[t.length - 1], reaches, length: s[s.length - 1] };
  }

  /**
   * State of the bead at time tau (seconds since release).
   * Inside a segment the acceleration is constant, so the position is exact.
   */
  function stateAt(runner, tau) {
    const { pts, t, v, total, reaches } = runner;
    const n = t.length;
    if (n < 2 || total <= 0) return { x: pts[0].x, y: pts[0].y, v: 0, done: !reaches ? false : true };

    let time = tau;
    let done = false;
    if (reaches) {
      if (time >= total) {
        const last = pts[n - 1];
        return { x: last.x, y: last.y, v: v[n - 1], done: true };
      }
    } else {
      const period = 2 * total;
      time = ((time % period) + period) % period;
      if (time > total) time = period - time;
    }
    if (time <= 0) return { x: pts[0].x, y: pts[0].y, v: 0, done };

    // Binary search for the segment that contains `time`.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= time) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = time - t[lo];
    const acc = L > 0 ? (v[hi] * v[hi] - v[lo] * v[lo]) / (2 * L) : 0;
    const ds = Math.min(L, v[lo] * dt + 0.5 * acc * dt * dt);
    const f = L > 0 ? ds / L : 0;
    return {
      x: a.x + f * (b.x - a.x),
      y: a.y + f * (b.y - a.y),
      v: v[lo] + acc * dt,
      done,
    };
  }

  // ---------- Free-hand curves ----------

  /**
   * Turn a free-hand stroke into a usable track from A to B:
   * snap the ends to A and B, smooth the jitter, and resample at even spacing.
   */
  function cleanStroke(raw, X, Y, spacing) {
    if (!raw || raw.length < 2) return null;
    const pts = [{ x: 0, y: 0 }, ...raw, { x: X, y: Y }];

    // Remove points that are closer than a tiny distance (repeated pointer events).
    const dedup = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = dedup[dedup.length - 1];
      if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) > spacing * 0.25) dedup.push(pts[i]);
    }
    if (dedup.length < 2) return null;

    // Resample at even arc-length spacing.
    const res = resample(dedup, spacing);

    // Light moving-average smoothing (ends stay pinned to A and B).
    const out = res.map((p) => ({ x: p.x, y: p.y }));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < out.length - 1; i++) {
        out[i].x = (res[i - 1].x + 2 * res[i].x + res[i + 1].x) / 4;
        out[i].y = (res[i - 1].y + 2 * res[i].y + res[i + 1].y) / 4;
      }
      for (let i = 1; i < out.length - 1; i++) res[i] = { x: out[i].x, y: out[i].y };
    }
    return resample(res, spacing / 4);
  }

  function resample(pts, spacing) {
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      let d = spacing - carry;
      while (d <= L) {
        const f = d / L;
        out.push({ x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y) });
        d += spacing;
      }
      carry = L - (d - spacing);
    }
    const last = pts[pts.length - 1];
    const end = out[out.length - 1];
    if (Math.hypot(last.x - end.x, last.y - end.y) > 1e-9) out.push({ x: last.x, y: last.y });
    return out;
  }

  // ---------- Tautochrone ----------

  /**
   * Tautochrone set-up: a cycloid with its lowest point at θ = π.
   * Returns the track (θ from 0 to π) and, for each release point θ0,
   * the sub-track from θ0 down to the bottom.
   * Released from rest anywhere, every bead reaches the bottom after π sqrt(R/g).
   */
  function tautochroneCycloid(R, releaseThetas, n = DEFAULT_N) {
    const point = (t) => ({ x: R * (t - Math.sin(t)), y: R * (1 - Math.cos(t)) });
    const track = [];
    for (let i = 0; i <= n; i++) track.push(point((i / n) * Math.PI));
    const subs = releaseThetas.map((t0) => {
      const p = [];
      for (let i = 0; i <= n; i++) p.push(point(t0 + (i / n) * (Math.PI - t0)));
      return p;
    });
    return { track, subs, bottom: point(Math.PI), time: (g) => Math.PI * Math.sqrt(R / g) };
  }

  /**
   * For comparison: a circular track (a pendulum) with the same bottom point
   * and the same curvature there (radius 4R), released from the same heights.
   * Here the arrival time depends on the release height.
   */
  function tautochroneCircle(R, releaseHeights, n = DEFAULT_N) {
    const rho = 4 * R;
    const bottom = { x: R * Math.PI, y: 2 * R };
    const point = (a) => ({ x: bottom.x - rho * Math.sin(a), y: bottom.y - rho * (1 - Math.cos(a)) });
    const aMax = Math.acos(1 - (2 * R) / rho); // same top height as the cycloid
    const track = [];
    for (let i = 0; i <= n; i++) track.push(point(aMax - (i / n) * aMax));
    const subs = releaseHeights.map((h) => {
      // h = depth of the release point below the top of the track (y = 0)
      const a0 = Math.acos(1 - (2 * R - h) / rho);
      const p = [];
      for (let i = 0; i <= n; i++) p.push(point(a0 - (i / n) * a0));
      return p;
    });
    return { track, subs, bottom };
  }

  return {
    line,
    arc,
    parabola,
    cycloid,
    cycloidParams,
    lineTime,
    cycloidTime,
    buildRunner,
    stateAt,
    cleanStroke,
    resample,
    tautochroneCycloid,
    tautochroneCircle,
  };
});
