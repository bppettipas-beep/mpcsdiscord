import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { canEditTeams, teamAdminCommand } from "../src/team-admin-ui.js";

const interaction=(permissions,roles=[])=>({guildId:"guild",memberPermissions:{has:permission=>(permissions&permission)===permission},member:{roles:{cache:{has:role=>roles.includes(role)}}}});

test("editteam is visible without Discord's Manage Server command gate",()=>{
  assert.equal(teamAdminCommand.toJSON().default_member_permissions,undefined);
});

test("Manage Server and the configured role can edit teams",()=>{
  const settings={teamEditorRoles:{guild:"editor"}};
  assert.equal(canEditTeams(interaction(PermissionFlagsBits.ManageGuild),settings),true);
  assert.equal(canEditTeams(interaction(0n,["editor"]),settings),true);
  assert.equal(canEditTeams(interaction(0n,["other"]),settings),false);
});
