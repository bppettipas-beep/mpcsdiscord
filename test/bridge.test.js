import test from "node:test";
import assert from "node:assert/strict";

import { secretsMatch, validateChatPayload } from "../src/bridge-utils.js";

test("compares bridge secrets", () => {
  assert.equal(secretsMatch("correct-secret", "correct-secret"), true);
  assert.equal(secretsMatch("wrong", "correct-secret"), false);
});

test("validates an accepted Minecraft chat payload", () => {
  assert.deepEqual(validateChatPayload({ player: "GooseWithAK", message: "hello", server: "MPCS" }), {
    player: "GooseWithAK", message: "hello", server: "MPCS", type: "chat"
  });
});

test("validates Minecraft join and leave events", () => {
  assert.deepEqual(validateChatPayload({ player: "GooseWithAK", message: "+", type: "join" }), { player: "GooseWithAK", message: "+", server: "MPCS", type: "join" });
  assert.deepEqual(validateChatPayload({ player: "GooseWithAK", message: "-", type: "leave" }), { player: "GooseWithAK", message: "-", server: "MPCS", type: "leave" });
  assert.equal(validateChatPayload({ player: "GooseWithAK", message: "?", type: "unknown" }), null);
});

test("rejects missing and oversized payload fields", () => {
  assert.equal(validateChatPayload({ player: "", message: "hello" }), null);
  assert.equal(validateChatPayload({ player: "Goose", message: "x".repeat(513) }), null);
});
