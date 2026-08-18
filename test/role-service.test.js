import test from "node:test";
import assert from "node:assert/strict";
import { addRoleReliable, retry } from "../src/role-service.js";

test("retry recovers from transient failures", async () => {
  let calls = 0;
  const result = await retry(async () => { calls++; if (calls < 3) throw new Error("temporary"); return "ok"; }, { attempts: 4, sleep: async () => {} });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("reliable role assignment skips an existing role", async () => {
  let fetches = 0;
  const member = { roles: { cache: new Map([["role", {}]]) }, guild: { members: { fetch: async () => { fetches++; } } } };
  assert.equal(await addRoleReliable(member, "role", "test"), false);
  assert.equal(fetches, 0);
});

test("reliable role assignment refetches and retries", async () => {
  let additions = 0;
  const current = { roles: { cache: new Map(), add: async () => { additions++; if (additions === 1) throw new Error("temporary"); } } };
  const member = { id: "member", roles: { cache: new Map() }, guild: { members: { fetch: async () => current } } };
  assert.equal(await addRoleReliable(member, "role", "test", { attempts: 2, sleep: async () => {} }), true);
  assert.equal(additions, 2);
});
