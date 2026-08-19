import test from "node:test";
import assert from "node:assert/strict";
import { websiteTeams } from "../src/team-source.js";

test("website team source includes every synced approved and queued team without mutation",()=>{
  const settings={teamSnapshot:{teams:[{id:"synced",name:"Synced"}]},approvedSignupMessages:{old:{status:"approved",at:1,preview:{id:"approved",name:"Approved"}}},teamActions:[{type:"create",id:"queued",name:"Queued"}]},before=structuredClone(settings);
  assert.deepEqual(websiteTeams(settings).map(team=>team.id),["synced","approved","queued"]);assert.deepEqual(settings,before);
});

test("website team source excludes explicitly deleted teams and deduplicates synced teams",()=>{
  const settings={teamSnapshot:{teams:[{id:"same",name:"Current"},{id:"gone",name:"Gone"}]},approvedSignupMessages:{one:{status:"approved",preview:{id:"same",name:"Old"}}},teamActions:[{type:"delete",id:"gone"}]};
  assert.deepEqual(websiteTeams(settings).map(team=>team.name),["Current"]);
});
