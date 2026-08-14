import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.channelId = null;
    this.pending = {};
    this.links = {};
    this.radioChannelId = null;
    this.teamSnapshot = { teams: [], players: [] };
    this.teamActions = [];
    this.teamDrafts = {};
    this.originalNicknames = {};
    this.schedules = [];
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8"));
      this.channelId = typeof value.channelId === "string" ? value.channelId : null;
      this.pending = value.pending && typeof value.pending === "object" ? value.pending : {};
      this.links = value.links && typeof value.links === "object" ? value.links : {};
      this.radioChannelId = typeof value.radioChannelId === "string" ? value.radioChannelId : null;
      this.teamSnapshot = value.teamSnapshot || { teams: [], players: [] };
      this.teamActions = Array.isArray(value.teamActions) ? value.teamActions : [];
      this.teamDrafts = value.teamDrafts && typeof value.teamDrafts === "object" ? value.teamDrafts : {};
      this.originalNicknames = value.originalNicknames && typeof value.originalNicknames === "object" ? value.originalNicknames : {};
      this.schedules = Array.isArray(value.schedules) ? value.schedules : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this.channelId;
  }

  async saveChannel(channelId) {
    this.channelId = channelId;
    await this.save();
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify({ channelId: this.channelId, radioChannelId: this.radioChannelId, pending: this.pending, links: this.links, teamSnapshot: this.teamSnapshot, teamActions: this.teamActions, teamDrafts: this.teamDrafts, originalNicknames: this.originalNicknames, schedules: this.schedules }, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }
}
