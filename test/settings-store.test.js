import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsStore } from "../src/settings-store.js";

test("persists and reloads the selected channel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mpcs-discord-"));
  const path = join(directory, "config.json");
  const writer = new SettingsStore(path);
  await writer.saveChannel("123456789012345678");
  const reader = new SettingsStore(path);
  assert.equal(await reader.load(), "123456789012345678");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { channelId: "123456789012345678" });
});
