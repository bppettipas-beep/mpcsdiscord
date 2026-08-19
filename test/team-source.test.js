import test from "node:test";
import assert from "node:assert/strict";
import { discordTeamAssignments, websiteTeams } from "../src/team-source.js";

test("website team source includes every synced approved and queued team without mutation",()=>{
  const settings={teamSnapshot:{teams:[{id:"synced",name:"Synced"}]},approvedSignupMessages:{old:{status:"approved",at:1,preview:{id:"approved",name:"Approved"}}},teamActions:[{type:"create",id:"queued",name:"Queued"}]},before=structuredClone(settings);
  assert.deepEqual(websiteTeams(settings).map(team=>team.id),["synced","approved","queued"]);assert.deepEqual(settings,before);
});

test("website team source excludes explicitly deleted teams and deduplicates synced teams",()=>{
  const settings={teamSnapshot:{teams:[{id:"same",name:"Current"},{id:"gone",name:"Gone"}]},approvedSignupMessages:{one:{status:"approved",preview:{id:"same",name:"Old"}}},teamActions:[{type:"delete",id:"gone"}]};
  assert.deepEqual(websiteTeams(settings).map(team=>team.name),["Current"]);
});

test("builds one complete Discord assignment for every linked roster member",()=>{
  const settings={links:{uuid1:"discord1",uuid2:"discord2",uuid3:"discord1"},teamSnapshot:{teams:[{id:"alpha",members:["uuid1","uuid2"]}]},approvedSignupMessages:{beta:{status:"approved",preview:{id:"beta",members:["uuid3"]}}},teamActions:[]},assignments=discordTeamAssignments(settings);
  assert.equal(assignments.size,2);assert.equal(assignments.get("discord1").team.id,"alpha");assert.equal(assignments.get("discord2").uuid,"uuid2");
});
