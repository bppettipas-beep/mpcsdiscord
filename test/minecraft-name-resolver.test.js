import test from "node:test";
import assert from "node:assert/strict";
import { MinecraftNameResolver } from "../src/minecraft-name-resolver.js";

test("resolves missing Minecraft names without mutating source team data",async()=>{
  const team={members:["a501ecbc-7cf8-4989-991c-4d5140d0a256"]},before=structuredClone(team),resolver=new MinecraftNameResolver(async()=>({ok:true,json:async()=>({name:"6II7"})})),known=new Map();
  await resolver.fill(known,team.members);
  assert.equal(known.get(team.members[0]),"6II7");assert.deepEqual(team,before);
});

test("leaves a missing name unresolved when Mojang is unavailable",async()=>{
  const resolver=new MinecraftNameResolver(async()=>{throw new Error("offline")}),known=new Map(),uuid="a501ecbc-7cf8-4989-991c-4d5140d0a256";
  await resolver.fill(known,[uuid]);assert.equal(known.has(uuid),false);
});
