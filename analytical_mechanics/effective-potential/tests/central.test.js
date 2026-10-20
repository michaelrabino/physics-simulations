// Run with:  node --test tests/central.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../central.js");

const P = C.PRESETS;
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test("Kepler turning points solve the quadratic", () => {
  // E = −1/r + 1/(2r²)  with l = 1, E = −0.3  →  0.3 r² − r + 0.5 = 0
  const { r1, r2 } = C.allowedInterval(P.kepler, {}, 1, -0.3, 1, 100);
  const d = Math.sqrt(1 - 0.6);
  assert.ok(close(r1, (1 - d) / 0.6, 1e-9) && close(r2, (1 + d) / 0.6, 1e-9), `${r1} ${r2}`);
});

test("Kepler orbit closes: apsidal angle π, radial period 2π a^1.5", () => {
  for (const [l, E] of [[1, -0.3], [0.7, -0.6], [1.4, -0.2]]) {
    const { r1, r2 } = C.allowedInterval(P.kepler, {}, l, E, 0.9 * l * l + 0.1, 200);
    const sw = C.swing(P.kepler, {}, l, E, r1, r2);
    const a = -1 / (2 * E);
    assert.ok(close(sw.dTheta, Math.PI, 2e-4), `Δθ ${sw.dTheta}`);
    assert.ok(close(sw.radialPeriod, 2 * Math.PI * Math.pow(a, 1.5), 2e-4), `T ${sw.radialPeriod}`);
  }
});

test("isotropic oscillator: apsidal angle π/2, radial period π", () => {
  const { r1, r2 } = C.allowedInterval(P.hooke, {}, 1, 1.6, 1, 50);
  const sw = C.swing(P.hooke, {}, 1, 1.6, r1, r2);
  assert.ok(close(sw.dTheta, Math.PI / 2, 2e-4), `${sw.dTheta}`);
  assert.ok(close(sw.radialPeriod, Math.PI, 2e-4), `${sw.radialPeriod}`);
});

test("Yukawa and the relativistic term make the perihelion advance", () => {
  for (const [pre, p] of [[P.yukawa, { a: 3 }], [P.gr, { eps: 0.04 }]]) {
    const E = pre === P.yukawa ? -0.15 : -0.3;
    const { r1, r2 } = C.allowedInterval(pre, p, 1, E, 1.5, 200);
    const sw = C.swing(pre, p, 1, E, r1, r2);
    assert.ok(r1 > 0.1 && r2 < 50 && sw.dTheta > Math.PI, `${r1} ${r2} ${sw.dTheta}`);
  }
});

test("inverse-fourth force: inside the barrier the particle reaches the center", () => {
  const { r1, r2 } = C.allowedInterval(P.inv4, {}, 1, 0.1, 0.3, 100);
  assert.equal(r1, 0);
  assert.ok(r2 > 0.3 && r2 < 1);
  const out = C.allowedInterval(P.inv4, {}, 1, 0.1, 3, 100);
  assert.ok(out.r1 > 1 && out.r2 === Infinity);
});

test("integrator conserves energy and angular momentum over ten Kepler orbits", () => {
  const l = 1;
  const E = -0.3;
  let st = C.initState(0.6130, E, l, P.kepler, {}, false);
  const E0 = C.energy(P.kepler, {}, l, st);
  const L0 = C.angularMomentum(st);
  const T = 2 * Math.PI * Math.pow(1 / 0.6, 1.5);
  for (let k = 0; k < 100; k++) st = C.advance(P.kepler, {}, l, st, T / 10).state;
  assert.ok(Math.abs(C.energy(P.kepler, {}, l, st) - E0) < 1e-7);
  assert.ok(Math.abs(C.angularMomentum(st) - L0) < 1e-7);
  // after 10 whole periods it is back near the start (closed orbit)
  assert.ok(Math.hypot(st.x - 0.6130, st.y) < 1e-3, `${st.x} ${st.y}`);
});

test("falling in and escaping are reported", () => {
  const fall = C.advance(P.inv4, {}, 1, C.initState(0.5, 0.1, 1, P.inv4, {}, true), 50);
  assert.equal(fall.event, "center");
  const esc = C.advance(P.kepler, {}, 1, C.initState(3, 0.2, 1, P.kepler, {}, false), 1e4, { rEscape: 50 });
  assert.equal(esc.event, "escape");
});

test("a forbidden starting radius is reported, not misclassified", () => {
  assert.equal(C.allowedInterval(P.yukawa, { a: 3 }, 1, -0.15, 2.5, 200), null);
});

test("circular orbit sits at the minimum of V'", () => {
  const m = C.veffMin(P.kepler, {}, 1, 0.05, 20);
  assert.ok(close(m.r, 1, 1e-2) && close(m.v, -0.5, 1e-5));
});
