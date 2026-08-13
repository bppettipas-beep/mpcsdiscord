import test from "node:test";
import assert from "node:assert/strict";

import { secretsMatch, validateChatPayload } from "../src/bridge-utils.js";

test("compares bridge secrets", () => {
  assert.equal(secretsMatch("correct-secret", "correct-secret"), true);
  assert.equal(secretsMatch("wrong", "correct-secret"), false);
});

test("validates an accepted Minecraft chat payload", () => {
  assert.deepEqual(validateChatPayload({ player: "GooseWithAK", message: "hello", server: "MPCS" }), {
    player: "GooseWithAK", message: "hello", server: "MPCS"
  });
});

test("rejects missing and oversized payload fields", () => {
  assert.equal(validateChatPayload({ player: "", message: "hello" }), null);
  assert.equal(validateChatPayload({ player: "Goose", message: "x".repeat(513) }), null);
});
