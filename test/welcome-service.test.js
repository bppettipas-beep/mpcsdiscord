import test from "node:test";
import assert from "node:assert/strict";
import { formatWelcome } from "../src/welcome-service.js";

test("formats every welcome placeholder", () => {
  const member={id:"123",displayName:"Display",user:{globalName:"Global",username:"user",tag:"user#0001"},guild:{name:"MPCS",memberCount:42}};
  assert.equal(formatWelcome("Hi {member mention} ({member name}/{member tag}/{member id}) — welcome to {guild name}, member #{member count}!",member),"Hi <@123> (Display/user#0001/123) — welcome to MPCS, member #42!");
});
