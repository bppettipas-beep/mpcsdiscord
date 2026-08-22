import test from "node:test";
import assert from "node:assert/strict";
import { MentionProtectionService, mentionProtectCommand } from "../src/mention-protection-service.js";

test("mention protection command is administrator-only", () => {
  const command = mentionProtectCommand.toJSON();
  assert.equal(command.name, "mentionprotect");
  assert.ok(command.default_member_permissions);
  assert.deepEqual(command.options.map(option => option.name), ["add", "remove", "list"]);
});

test("directly mentioning a protected user deletes the message and applies a one-minute timeout", async () => {
  const service = new MentionProtectionService({ protectedMentions: { guild: ["protected"] } });
  let deleted = false;
  let timeoutDuration = null;
  const message = {
    inGuild: () => true,
    guildId: "guild",
    author: { bot: false, id: "offender", tag: "Offender" },
    member: {
      moderatable: true,
      timeout: async duration => { timeoutDuration = duration; }
    },
    mentions: { users: { has: id => id === "protected" } },
    content: "hello <@protected>",
    delete: async () => { deleted = true; },
    channel: { send: async () => null }
  };

  assert.equal(await service.message(message), true);
  assert.equal(deleted, true);
  assert.equal(timeoutDuration, 60_000);
});

test("messages without a protected direct mention are untouched", async () => {
  const service = new MentionProtectionService({ protectedMentions: { guild: ["protected"] } });
  const message = {
    inGuild: () => true,
    guildId: "guild",
    author: { bot: false },
    member: {},
    mentions: { users: { has: () => false } }
  };
  assert.equal(await service.message(message), false);
});
