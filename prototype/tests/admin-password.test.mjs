import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, isHashed } from "../functions/api/_shared/password.js";

test("hashPassword produces pbkdf2-formatted hash and verifies the same password", async () => {
  const hash = await hashPassword("s3cret-pass");
  assert.match(hash, /^pbkdf2\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(isHashed(hash), true);
  assert.equal(await verifyPassword("s3cret-pass", hash), true);
});

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("correct-horse");
  assert.equal(await verifyPassword("wrong-horse", hash), false);
});

test("hashPassword uses a random salt so identical passwords yield different hashes", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password", a), true);
  assert.equal(await verifyPassword("same-password", b), true);
});

test("verifyPassword returns false for malformed stored values", async () => {
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "plaintext"), false);
  assert.equal(await verifyPassword("x", "pbkdf2$100000$onlythree"), false);
  assert.equal(isHashed("plaintext"), false);
});
