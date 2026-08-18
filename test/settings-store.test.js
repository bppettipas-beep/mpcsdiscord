import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsStore } from "../src/settings-store.js";

test("persists and reloads channels and ticket state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mpcs-discord-"));
  const path = join(directory, "config.json");
  const writer = new SettingsStore(path);
  writer.ticketConfig.guild = { panelChannelId: "panel", categoryId: "category", supportRoleId: "support" };
  writer.tickets["guild:user"] = { channelId: "ticket", userId: "user", openedAt: "2026-08-14T00:00:00.000Z" };
  writer.automod.guild = { enabled: true };
  writer.auditLogs.guild = { text: "text", member: "member", mod: "mod" };
  writer.autoRoles.guild = "role";
  writer.welcomeMessages.guild = { channelId: "welcome", message: "Welcome {member name} to {guild name}!" };
  await writer.saveChannel("123456789012345678");
  const reader = new SettingsStore(path);
  assert.equal(await reader.load(), "123456789012345678");
  assert.deepEqual(reader.ticketConfig.guild, { panelChannelId: "panel", categoryId: "category", supportRoleId: "support" });
  assert.deepEqual(reader.tickets["guild:user"], { channelId: "ticket", userId: "user", openedAt: "2026-08-14T00:00:00.000Z" });
  assert.deepEqual(reader.automod.guild, { enabled: true });
  assert.deepEqual(reader.auditLogs.guild, { text: "text", member: "member", mod: "mod" });
  assert.equal(reader.autoRoles.guild, "role");
  assert.deepEqual(reader.welcomeMessages.guild, { channelId: "welcome", message: "Welcome {member name} to {guild name}!" });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { channelId: "123456789012345678", radioChannelId: null, radioVolume: 80, pending: {}, links: {}, teamSnapshot: { teams: [], players: [] }, teamActions: [], teamDrafts: {}, teamSignupDrafts: {}, originalNicknames: {}, teamNicknameOptOut: {}, schedules: [], ticketConfig: { guild: { panelChannelId: "panel", categoryId: "category", supportRoleId: "support" } }, tickets: { "guild:user": { channelId: "ticket", userId: "user", openedAt: "2026-08-14T00:00:00.000Z" } }, automod: { guild: { enabled: true } }, auditLogs: { guild: { text: "text", member: "member", mod: "mod" } }, autoRoles: { guild: "role" }, welcomeMessages: { guild: { channelId: "welcome", message: "Welcome {member name} to {guild name}!" } } });
});

test("recovers ticket configuration from the last known-good backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mpcs-discord-recovery-"));
  const path = join(directory, "config.json");
  const writer = new SettingsStore(path);
  writer.ticketConfig.guild = { panelChannelId: "panel", categoryId: "category", supportRoleId: "support" };
  await writer.save();
  writer.ticketConfig.guild.panelChannelId = "new-panel";
  await writer.save();
  await writeFile(path, "{ truncated", "utf8");
  const reader = new SettingsStore(path);
  await reader.load();
  assert.equal(reader.ticketConfig.guild.panelChannelId, "panel");
});
