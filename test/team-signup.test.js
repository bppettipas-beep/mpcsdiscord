import test from "node:test";
import assert from "node:assert/strict";
import { minecraftProfile, signupPanel, validIgn } from "../src/team-signup-ui.js";
import { parseSignup } from "../src/signup-approval-service.js";

test("public panel explains private verified invitations without a minimum roster claim",()=>{
  const description=signupPanel().embeds[0].data.description;
  assert.match(description,/private invitation/);
  assert.match(description,/verify their own Minecraft username/);
  assert.doesNotMatch(description,/exactly 8|minimum|no fewer/i);
});

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

test("parses a gamemode-based staff-approved signup message",()=>{
  const signup=parseSignup(`Team name: Sky Kings\nTeam Leader: <@12345678901234567>\n\nVanilla: <@12345678901234567> LeaderIGN\nSpear Mace: <@22345678901234567> Player_Two\nSub: <@32345678901234567> ThirdIGN`);
  assert.equal(signup.id,"skykings");
  assert.equal(signup.leader.discordId,"12345678901234567");
  assert.deepEqual(signup.roster.map(member=>member.ign),["LeaderIGN","Player_Two","ThirdIGN"]);
  assert.deepEqual(signup.roster.map(member=>member.role),["Vanilla","Spear Mace","Sub"]);
});

test("rejects duplicate Discord members in approved signup messages",()=>{
  assert.throws(()=>parseSignup(`Team name: Dupes\nTeam Leader: <@12345678901234567>\nVanilla: <@12345678901234567> LeaderIGN\nSub: <@12345678901234567> OtherIGN`),/only appear once/);
});
