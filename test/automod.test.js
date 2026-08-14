import test from "node:test";
import assert from "node:assert/strict";
import { defaultAutomodConfig, evaluateMessage } from "../src/automod-service.js";

test("automod detects spam and repeated messages", () => {
  const config=defaultAutomodConfig(),now=10_000;
  assert.equal(evaluateMessage("new",0,config,Array.from({length:6},(_,i)=>({at:now-i,text:String(i)})),now),"message spam");
  assert.equal(evaluateMessage("same",0,config,[{at:now,text:"same"},{at:now-1,text:"same"}],now),"repeated messages");
});

test("automod detects mentions invites links and blocked phrases", () => {
  const config={...defaultAutomodConfig(),blockLinks:true,blockedWords:["bad phrase"]};
  assert.equal(evaluateMessage("hello",6,config,[]),"excessive mentions");
  assert.equal(evaluateMessage("discord.gg/example",0,config,[]),"Discord invite link");
  assert.equal(evaluateMessage("https://example.com",0,config,[]),"blocked link");
  assert.equal(evaluateMessage("a BAD PHRASE here",0,config,[]),"blocked word or phrase");
});
