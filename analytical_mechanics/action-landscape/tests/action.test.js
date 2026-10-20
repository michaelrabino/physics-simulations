// Run with:  node --test tests/action.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../action.js");

const osc = { type: "oscillator", m: 1, omega: 2 * Math.PI };
const fall = { type: "freefall", m: 1, g: 9.81 };
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test("true paths hit both fixed ends", () => {
  for (const [sys, qA, qB, T] of [[fall, 0, 0, 1], [fall, 0.5, 2, 1.3], [osc, 1, 0.5, 0.37], [osc, -0.3, 0.8, 0.83]]) {
    const p = A.truePath(sys, qA, qB, T);
    assert.ok(close(p.q(0), qA, 1e-12) && close(p.q(T), qB, 1e-12));
  }
});

test("true paths satisfy the equation of motion", () => {
  const h = 1e-4;
  for (const [sys, qA, qB, T] of [[fall, 0.2, 1, 1.1], [osc, 1, 0.5, 0.37], [osc, 1, 0.5, 0.71]]) {
    const p = A.truePath(sys, qA, qB, T);
    for (const t of [0.1 * T, 0.5 * T, 0.8 * T]) {
      const acc = (p.q(t + h) - 2 * p.q(t) + p.q(t - h)) / (h * h);
      const want = sys.type === "freefall" ? -sys.g : -sys.omega * sys.omega * p.q(t);
      assert.ok(close(acc, want, 1e-4), `${acc} vs ${want}`);
    }
  }
});

test("closed-form true action matches numerical integration", () => {
  for (const [sys, qA, qB, T] of [[fall, 0, 0, 1], [fall, 0.5, 2, 1.3], [osc, 1, 0.5, 0.37], [osc, -0.3, 0.8, 0.83], [osc, 1, 0.5, 1.21]]) {
    const num = A.actionNumeric(sys, A.truePath(sys, qA, qB, T), T, 4000);
    assert.ok(close(num, A.trueAction(sys, qA, qB, T), 1e-8), `${num}`);
  }
});

test("ΔS = Σ c_n a_n² for random sine perturbations", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [sys, qA, qB, T] of [[fall, 0, 1, 1], [osc, 1, 0.5, 0.37], [osc, 1, 0.5, 0.73], [osc, 0.2, -0.4, 1.33]]) {
    const base = A.truePath(sys, qA, qB, T);
    for (let k = 0; k < 5; k++) {
      const a = Array.from({ length: 7 }, () => 0.3 * rnd());
      const num = A.actionNumeric(sys, A.trialPath(base, T, a), T, 6000) - A.trueAction(sys, qA, qB, T);
      assert.ok(close(num, A.deltaAction(sys, T, a), 1e-7), `${num} vs ${A.deltaAction(sys, T, a)}`);
    }
  }
});

test("Morse index counts the half-periods passed", () => {
  // τ = 1 s for ω = 2π: one lowering mode per half-period.
  assert.equal(A.morseIndex(osc, 0.37, 7), 0);
  assert.equal(A.morseIndex(osc, 0.73, 7), 1);
  assert.equal(A.morseIndex(osc, 1.21, 7), 2);
  assert.equal(A.morseIndex(osc, 1.61, 7), 3);
  assert.equal(A.morseIndex(fall, 5, 7), 0);
});

test("no classical path at a conjugate point", () => {
  assert.equal(A.truePath(osc, 1, 0.5, 0.5), null);
});

test("handles and modes convert back and forth exactly", () => {
  const a = [0.3, -0.2, 0.1, 0.05, -0.07, 0.02, 0.01];
  const back = A.offsetsToModes(A.modesToOffsets(a));
  a.forEach((v, i) => assert.ok(Math.abs(v - back[i]) < 1e-12));
  // handle offsets equal the trial path minus the true path at the handle times
  const base = A.truePath(osc, 1, 0.5, 0.73);
  const path = A.trialPath(base, 0.73, a);
  const d = A.modesToOffsets(a);
  A.handleTimes(0.73, 7).forEach((t, i) => assert.ok(Math.abs(path.q(t) - base.q(t) - d[i]) < 1e-12));
});
