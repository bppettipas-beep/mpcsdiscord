import test from "node:test";
import assert from "node:assert/strict";
import { formatWelcome, welcomeMember } from "../src/welcome-service.js";

test("formats every welcome placeholder", () => {
  const member={id:"123",displayName:"Display",user:{globalName:"Global",username:"user",tag:"user#0001"},guild:{name:"MPCS",memberCount:42}};
  assert.equal(formatWelcome("Hi {member mention} ({member name}/{member tag}/{member id}) — welcome to {guild name}, member #{member count}!",member),"Hi <@123> (Display/user#0001/123) — welcome to MPCS, member #42!");
});

test("welcome delivery retries transient send failures", async () => {
  let sends=0;
  const channel={isTextBased:()=>true,isSendable:()=>true,send:async()=>{sends++;if(sends<3)throw new Error("temporary");}};
  const member={id:"123",displayName:"Display",user:{globalName:"Global",username:"user",tag:"user#0001"},guild:{id:"guild",name:"MPCS",memberCount:42,channels:{fetch:async()=>channel}}};
  await welcomeMember(member,{welcomeMessages:{guild:{channelId:"channel",message:"Welcome {member mention}"}}},{attempts:3,sleep:async()=>{}});
  assert.equal(sends,3);
});
