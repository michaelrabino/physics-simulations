// Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../physics.js");

const g = 9.81;
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

test("straight line time matches the closed form", () => {
  for (const [X, Y] of [[1, 1], [3, 1.5], [0.5, 2]]) {
    const r = B.buildRunner(B.line(X, Y), g);
    assert.ok(r.reaches);
    assert.ok(rel(r.total, B.lineTime(X, Y, g)) < 1e-9, `X=${X} Y=${Y}`);
  }
});

test("cycloid time matches θ_end·sqrt(R/g)", () => {
  for (const [X, Y] of [[1, 1], [3, 1.5], [0.5, 2], [5, 1]]) {
    const r = B.buildRunner(B.cycloid(X, Y, 4000), g);
    assert.ok(r.reaches);
    assert.ok(rel(r.total, B.cycloidTime(X, Y, g)) < 1e-4, `X=${X} Y=${Y}: ${r.total} vs ${B.cycloidTime(X, Y, g)}`);
  }
});

test("cycloid passes through B", () => {
  const { R, thetaEnd } = B.cycloidParams(3, 1.5);
  assert.ok(Math.abs(R * (thetaEnd - Math.sin(thetaEnd)) - 3) < 1e-9);
  assert.ok(Math.abs(R * (1 - Math.cos(thetaEnd)) - 1.5) < 1e-9);
});

test("the cycloid beats every other curve", () => {
  for (const [X, Y] of [[1, 1], [3, 1.5], [0.5, 2], [5, 1]]) {
    const tc = B.buildRunner(B.cycloid(X, Y), g).total;
    for (const make of [B.line, B.arc, B.parabola]) {
      const t = B.buildRunner(make(X, Y), g).total;
      assert.ok(tc < t, `${make.name} X=${X} Y=${Y}: ${t} <= ${tc}`);
    }
  }
});

test("quarter circle time agrees with the elliptic-integral value", () => {
  // Quarter circle of radius 1 from the top, vertical tangent at A:
  // T = sqrt(r/g) * K(1/sqrt2)/... known value ≈ 1.8541 * sqrt(r/g)
  const r = B.buildRunner(B.arc(1, 1, 6000), g);
  assert.ok(rel(r.total, 1.854075 * Math.sqrt(1 / g)) < 1e-3, `${r.total}`);
});

test("tautochrone: every release point arrives at π·sqrt(R/g)", () => {
  const R = 0.5;
  const thetas = [0.15, 0.8, 1.6, 2.4, 2.9];
  const set = B.tautochroneCycloid(R, thetas, 4000);
  const T = set.time(g);
  for (const sub of set.subs) {
    const r = B.buildRunner(sub, g);
    assert.ok(rel(r.total, T) < 2e-3, `${r.total} vs ${T}`);
  }
});

test("circle comparison: arrival time grows with release height", () => {
  const R = 0.5;
  const set = B.tautochroneCircle(R, [0.05, 0.5, 0.95], 4000);
  const times = set.subs.map((s) => B.buildRunner(s, g).total);
  assert.ok(times[0] > times[1] && times[1] > times[2], times.join(", "));
});

test("a track that climbs above the start makes the bead turn back", () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: -0.5 }, { x: 3, y: 1 }];
  const r = B.buildRunner(pts, g);
  assert.equal(r.reaches, false);
  const mid = B.stateAt(r, r.total * 2); // one full period: back at the start
  assert.ok(Math.hypot(mid.x, mid.y) < 1e-6);
});

test("stateAt is continuous and ends at B", () => {
  const r = B.buildRunner(B.parabola(2, 1), g);
  let prev = B.stateAt(r, 0);
  for (let k = 1; k <= 400; k++) {
    const s = B.stateAt(r, (k / 400) * r.total);
    assert.ok(Math.hypot(s.x - prev.x, s.y - prev.y) < 0.05);
    prev = s;
  }
  const end = B.stateAt(r, r.total + 1);
  assert.ok(end.done && Math.abs(end.x - 2) < 1e-9 && Math.abs(end.y - 1) < 1e-9);
});

test("free-hand stroke is snapped to A and B", () => {
  const raw = [];
  for (let i = 1; i < 50; i++) raw.push({ x: (i / 50) * 2 + 0.01 * Math.sin(i), y: Math.sqrt(i / 50) * 1.2 });
  const pts = B.cleanStroke(raw, 2, 1, 0.05);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.ok(Math.abs(pts[pts.length - 1].x - 2) < 1e-9 && Math.abs(pts[pts.length - 1].y - 1) < 1e-9);
});
