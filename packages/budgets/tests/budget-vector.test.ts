import assert from "node:assert/strict";
import test from "node:test";
import {
  addVectors, fitsWithin, normalizeVector, parseQuantity, subtractVectors, vectorsEqual
} from "../src/index.js";

test("integer strings are exact at arbitrary precision", () => {
  const large = "123456789012345678901234567890";
  assert.equal(parseQuantity(large), 123456789012345678901234567890n);
  assert.equal(addVectors({ "money:EUR:minor": large }, { "money:EUR:minor": "10" })
    ["money:EUR:minor"], "123456789012345678901234567900");
  assert.equal(subtractVectors({ api_calls: "100" }, { api_calls: "1" }).api_calls, "99");
});

test("floating, decimal, negative and number quantities are rejected", () => {
  for (const value of ["12.34", "1e3", "NaN", 12.34, 12, "-1", "-0"]) {
    assert.throws(() => parseQuantity(value));
  }
  assert.throws(() => normalizeVector({ "money:EUR:minor": "-1" }), /NEGATIVE_BUDGET_QUANTITY/);
  assert.throws(() => normalizeVector({ "money:EUR:minor": "12.34" }), /INVALID_BUDGET_QUANTITY/);
});

test("dimensions remain independent; currencies never convert", () => {
  const ceiling = { "money:EUR:minor": "1000", "money:USD:minor": "0" };
  assert.equal(fitsWithin({ "money:EUR:minor": "999" }, ceiling), true);
  assert.equal(fitsWithin({ "money:USD:minor": "1" }, ceiling), false);
  assert.equal(fitsWithin({ gpu_ms: "1" }, ceiling), false);
  assert.equal(vectorsEqual({ api_calls: "0" }, {}), true);
});
