import test from "node:test";
import assert from "node:assert/strict";
import { minecraftProfile, validIgn } from "../src/team-signup-ui.js";

test("validates Minecraft IGN syntax",()=>{
  assert.equal(validIgn("Valid_Name12"),true);
  assert.equal(validIgn("ab"),false);
  assert.equal(validIgn("spaces fail"),false);
  assert.equal(validIgn("way_too_long_name_1"),false);
});

test("canonicalizes a Mojang profile and UUID",async()=>{
  const profile=await minecraftProfile("typedname",async()=>({ok:true,status:200,json:async()=>({id:"12345678123456781234567812345678",name:"TypedName"})}));
  assert.deepEqual(profile,{uuid:"12345678-1234-5678-1234-567812345678",name:"TypedName"});
});

test("rejects Minecraft names Mojang cannot find",async()=>{
  await assert.rejects(()=>minecraftProfile("MissingName",async()=>({ok:false,status:404})),/could not find/);
});
