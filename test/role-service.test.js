import test from "node:test";
import assert from "node:assert/strict";
import { addRoleReliable, assignJoinRole, reconcileAutoRole, retry } from "../src/role-service.js";

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
  let additions = 0,fetches=0;
  const current = { roles: { cache: new Map(), add: async role=>{additions++;current.roles.cache.set(role,{})} } };
  const member = { id: "member", roles: { cache: new Map(), add: async () => { additions++; throw new Error("temporary"); } }, guild: { members: { fetch: async () => {fetches++;return current;} } } };
  assert.equal(await addRoleReliable(member, "role", "test", { attempts: 2, sleep: async () => {} }), true);
  assert.equal(additions, 2);
  assert.equal(fetches,1);
});

test("join autorole assigns immediately before verification", async()=>{const events=[],cache=new Map(),member={id:"member",roles:{cache,add:async role=>{events.push("add");cache.set(role,{})}},guild:{members:{fetch:async()=>{events.push("verify");return member;}}}};await assignJoinRole(member,"role",{verifyDelay:0,sleep:async()=>events.push("sleep")});assert.equal(events[0],"add");assert.deepEqual(events,["add","sleep","verify"]);});

test("bulk reconciliation verifies repeated passes until nobody is missing", async () => {
  const members=new Map();
  const guild={roles:{fetch:async()=>({id:"role",managed:false,position:1})},members:{me:{permissions:{has:()=>true},roles:{highest:{position:10}}},fetch:async id=>id?members.get(id):members}};
  for(let index=0;index<30;index++){const id=String(index),cache=new Map(),member={id,user:{tag:`user${index}`},guild,roles:{cache,add:async roleId=>cache.set(roleId,{})}};members.set(id,member);}
  const result=await reconcileAutoRole(guild,"role",{error:()=>{}},{passes:2,concurrency:12,roleOptions:{attempts:1}});
  assert.equal(result.failed,0);
  assert.equal(result.added,30);
  assert.ok([...members.values()].every(member=>member.roles.cache.has("role")));
});
