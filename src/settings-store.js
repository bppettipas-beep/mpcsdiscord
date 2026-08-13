import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.channelId = null;
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8"));
      this.channelId = typeof value.channelId === "string" ? value.channelId : null;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this.channelId;
  }

  async saveChannel(channelId) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify({ channelId }, null, 2), "utf8");
    await rename(temporary, this.filePath);
    this.channelId = channelId;
  }
}
