/*
 * action.js — the physics behind the action landscape.
 *
 * One degree of freedom q(t) on 0 <= t <= T with fixed ends q(0) = qA, q(T) = qB.
 * Two systems, both with a Lagrangian that is quadratic in q and q̇:
 *
 *   free fall (vertical throw):  L = ½ m q̇² − m g q
 *   harmonic oscillator:          L = ½ m q̇² − ½ m ω² q²
 *
 * A trial path is the true path plus a sum of sine modes that vanish at both ends:
 *
 *   q(t) = q_true(t) + Σ a_n sin(nπ t / T),   n = 1 … N
 *
 * Because the true path satisfies the Euler–Lagrange equation, every term linear
 * in a_n drops out, and the modes are orthogonal, so the action is exactly
 *
 *   S = S_true + Σ c_n a_n²,   c_n = (m T / 4) · [ (nπ/T)² − ω² ]
 *
 * (ω = 0 for free fall). A mode with c_n < 0 lowers the action: this happens for
 * every n with nπ/T < ω, i.e. once T passes n half-periods of the oscillator.
 * Their count is the Morse index of the true path.
 *
 * The file works as a browser script (window.Action) and as a Node module.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Action = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PI = Math.PI;

  /** ω of the system (0 for free fall). */
  function omegaOf(sys) {
    return sys.type === "oscillator" ? sys.omega : 0;
  }

  /** Lagrangian L(q, q̇). */
  function lagrangian(sys, q, qd) {
    const T = 0.5 * sys.m * qd * qd;
    const V = sys.type === "oscillator" ? 0.5 * sys.m * sys.omega * sys.omega * q * q : sys.m * sys.g * q;
    return T - V;
  }

  /**
   * The true (classical) path between the fixed ends, as { q(t), qd(t) }.
   * Returns null when no classical path exists: for the oscillator when T is a
   * whole number of half-periods (sin ωT = 0) — the conjugate points.
   */
  function truePath(sys, qA, qB, T) {
    if (sys.type === "freefall") {
      const g = sys.g;
      return {
        q: (t) => qA + ((qB - qA) * t) / T + 0.5 * g * t * (T - t),
        qd: (t) => (qB - qA) / T + 0.5 * g * (T - 2 * t),
      };
    }
    const w = sys.omega;
    const s = Math.sin(w * T);
    if (Math.abs(s) < 1e-9) return null;
    return {
      q: (t) => (qA * Math.sin(w * (T - t)) + qB * Math.sin(w * t)) / s,
      qd: (t) => (w * (-qA * Math.cos(w * (T - t)) + qB * Math.cos(w * t))) / s,
    };
  }

  /** Closed-form action of the true path. */
  function trueAction(sys, qA, qB, T) {
    const m = sys.m;
    if (sys.type === "freefall") {
      const g = sys.g;
      return (m * (qB - qA) * (qB - qA)) / (2 * T) - (m * g * T * (qA + qB)) / 2 - (m * g * g * T * T * T) / 24;
    }
    const w = sys.omega;
    const s = Math.sin(w * T);
    if (Math.abs(s) < 1e-9) return NaN;
    return ((m * w) / (2 * s)) * ((qA * qA + qB * qB) * Math.cos(w * T) - 2 * qA * qB);
  }

  /** Coefficient c_n of a_n² in the action. */
  function modeCoeff(sys, T, n) {
    const w = omegaOf(sys);
    const k = (n * PI) / T;
    return ((sys.m * T) / 4) * (k * k - w * w);
  }

  function modeCoeffs(sys, T, N) {
    const c = [];
    for (let n = 1; n <= N; n++) c.push(modeCoeff(sys, T, n));
    return c;
  }

  /** Number of modes that lower the action (the Morse index), among the first N. */
  function morseIndex(sys, T, N) {
    let k = 0;
    for (let n = 1; n <= N; n++) if (modeCoeff(sys, T, n) < -1e-12) k++;
    return k;
  }

  /** ΔS = Σ c_n a_n² for amplitudes a = [a_1, …, a_N]. */
  function deltaAction(sys, T, a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += modeCoeff(sys, T, i + 1) * a[i] * a[i];
    return s;
  }

  /** Trial path q(t) = base + Σ a_n sin(nπt/T), with its derivative. */
  function trialPath(base, T, a) {
    return {
      q: (t) => {
        let v = base.q(t);
        for (let i = 0; i < a.length; i++) v += a[i] * Math.sin(((i + 1) * PI * t) / T);
        return v;
      },
      qd: (t) => {
        let v = base.qd(t);
        for (let i = 0; i < a.length; i++) v += a[i] * (((i + 1) * PI) / T) * Math.cos(((i + 1) * PI * t) / T);
        return v;
      },
    };
  }

  /** Action of any path by Simpson's rule (used to check the closed form). */
  function actionNumeric(sys, path, T, steps = 2000) {
    const n = steps % 2 ? steps + 1 : steps;
    const h = T / n;
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const t = i * h;
      const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
      s += w * lagrangian(sys, path.q(t), path.qd(t));
    }
    return (s * h) / 3;
  }

  /**
   * Handles: the path is edited through its values at the N interior times
   * t_i = i T / (N + 1). Mode amplitudes and handle offsets are related by the
   * type-I discrete sine transform, which is its own inverse up to 2/(N+1).
   */
  function handleTimes(T, N) {
    const out = [];
    for (let i = 1; i <= N; i++) out.push((i * T) / (N + 1));
    return out;
  }

  /** Offsets of the handles from the true path, from mode amplitudes. */
  function modesToOffsets(a) {
    const N = a.length;
    const d = new Array(N).fill(0);
    for (let i = 1; i <= N; i++) {
      let v = 0;
      for (let n = 1; n <= N; n++) v += a[n - 1] * Math.sin((PI * n * i) / (N + 1));
      d[i - 1] = v;
    }
    return d;
  }

  /** Mode amplitudes from handle offsets (inverse of modesToOffsets). */
  function offsetsToModes(d) {
    const N = d.length;
    const a = new Array(N).fill(0);
    for (let n = 1; n <= N; n++) {
      let v = 0;
      for (let i = 1; i <= N; i++) v += d[i - 1] * Math.sin((PI * n * i) / (N + 1));
      a[n - 1] = (2 / (N + 1)) * v;
    }
    return a;
  }

  return {
    omegaOf,
    lagrangian,
    truePath,
    trueAction,
    modeCoeff,
    modeCoeffs,
    morseIndex,
    deltaAction,
    trialPath,
    actionNumeric,
    handleTimes,
    modesToOffsets,
    offsetsToModes,
  };
});
