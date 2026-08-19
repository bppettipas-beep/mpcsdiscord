import test from "node:test";
import assert from "node:assert/strict";
import { minecraftProfile, signupPanel, validIgn } from "../src/team-signup-ui.js";
import { parseSignup, removeApprovedSignups } from "../src/signup-approval-service.js";

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

test("parses a numbered staff-approved signup message",()=>{
  const signup=parseSignup(`Team Name: Sky Kings\nTeam Leader: <@12345678901234567> LeaderIGN\n\nPlayer 2: <@22345678901234567> Player_Two\nPlayer 3: <@32345678901234567> ThirdIGN\nPlayer 4: <@42345678901234567> FourthIGN\nPlayer 5: <@52345678901234567> FifthIGN\nPlayer 6: <@62345678901234567> SixthIGN\nPlayer 7: <@72345678901234567> SeventhIGN\nSubstitute: <@82345678901234567> SubIGN`);
  assert.equal(signup.id,"skykings");
  assert.equal(signup.leader.discordId,"12345678901234567");
  assert.equal(signup.roster.length,8);
  assert.deepEqual(signup.roster.slice(0,3).map(member=>member.ign),["LeaderIGN","Player_Two","ThirdIGN"]);
});

test("requires every signup roster slot",()=>{
  assert.throws(()=>parseSignup(`Team Name: Short\nTeam Leader: <@12345678901234567> LeaderIGN\nPlayer 2: <@22345678901234567> PlayerTwo`),/Missing required slots/);
});

test("rejects duplicate Discord members in approved signup messages",()=>{
  assert.throws(()=>parseSignup(`Team Name: Dupes\nTeam Leader: <@12345678901234567> LeaderIGN\nPlayer 2: <@12345678901234567> OtherIGN\nPlayer 3: <@32345678901234567> ThirdIGN\nPlayer 4: <@42345678901234567> FourthIGN\nPlayer 5: <@52345678901234567> FifthIGN\nPlayer 6: <@62345678901234567> SixthIGN\nPlayer 7: <@72345678901234567> SeventhIGN\nSubstitute: <@82345678901234567> SubIGN`),/only appear once/);
});

test("deletes one approved signup without touching other approved teams",()=>{
  const settings={approvedSignupMessages:{one:{status:"approved",teamId:"alpha"},two:{status:"approved",teamId:"beta"}},teamActions:[{type:"create",id:"alpha"},{type:"create",id:"beta"}],schedules:[{teamOne:"alpha",teamTwo:"beta"},{teamOne:"beta",teamTwo:"gamma"}]};
  assert.deepEqual(removeApprovedSignups(settings,"alpha"),["alpha"]);
  assert.equal(settings.approvedSignupMessages.one,undefined);assert.ok(settings.approvedSignupMessages.two);
  assert.deepEqual(settings.teamActions,[{type:"create",id:"beta"},{type:"delete",id:"alpha"}]);
  assert.deepEqual(settings.schedules,[{teamOne:"beta",teamTwo:"gamma"}]);
});
