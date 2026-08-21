import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.channelId = null;
    this.pending = {};
    this.links = {};
    this.radioChannelId = null;
    this.radioVolume = 80;
    this.teamSnapshot = { teams: [], players: [] };
    this.teamActions = [];
    this.teamDrafts = {};
    this.teamSignupDrafts = {};
    this.teamLeaderDrafts = {};
    this.teamLeaderInvites = [];
    this.originalNicknames = {};
    this.teamNicknameOptOut = {};
    this.schedules = [];
    this.matchTicketConfig = {};
    this.teamLogChannelId = null;
    this.teamLogDigest = "";
    this.ticketConfig = {};
    this.tickets = {};
    this.automod = {};
    this.auditLogs = {};
    this.autoRoles = {};
    this.welcomeMessages = {};
    this.signupApprovals = {};
    this.approvedSignupMessages = {};
    this.playerStats = [];
    this.teamLeaveDeadlines = {};
    this.saveQueue = Promise.resolve();
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8"));
      this.channelId = typeof value.channelId === "string" ? value.channelId : null;
      this.pending = value.pending && typeof value.pending === "object" ? value.pending : {};
      this.links = value.links && typeof value.links === "object" ? value.links : {};
      this.radioChannelId = typeof value.radioChannelId === "string" ? value.radioChannelId : null;
      this.radioVolume = Number.isFinite(Number(value.radioVolume)) ? Math.max(0, Math.min(100, Number(value.radioVolume))) : 80;
      this.teamSnapshot = value.teamSnapshot || { teams: [], players: [] };
      this.teamActions = Array.isArray(value.teamActions) ? value.teamActions : [];
      this.teamDrafts = value.teamDrafts && typeof value.teamDrafts === "object" ? value.teamDrafts : {};
      this.teamSignupDrafts = value.teamSignupDrafts && typeof value.teamSignupDrafts === "object" ? value.teamSignupDrafts : {};
      this.teamLeaderDrafts = value.teamLeaderDrafts && typeof value.teamLeaderDrafts === "object" ? value.teamLeaderDrafts : {};
      this.teamLeaderInvites = Array.isArray(value.teamLeaderInvites) ? value.teamLeaderInvites : [];
      this.originalNicknames = value.originalNicknames && typeof value.originalNicknames === "object" ? value.originalNicknames : {};
      this.teamNicknameOptOut = value.teamNicknameOptOut && typeof value.teamNicknameOptOut === "object" ? value.teamNicknameOptOut : {};
      this.schedules = Array.isArray(value.schedules) ? value.schedules : [];
      this.matchTicketConfig = value.matchTicketConfig && typeof value.matchTicketConfig === "object" ? value.matchTicketConfig : {};
      this.teamLogChannelId = typeof value.teamLogChannelId === "string" ? value.teamLogChannelId : null;
      this.teamLogDigest = typeof value.teamLogDigest === "string" ? value.teamLogDigest : "";
      this.ticketConfig = value.ticketConfig && typeof value.ticketConfig === "object" ? value.ticketConfig : {};
      this.tickets = value.tickets && typeof value.tickets === "object" ? value.tickets : {};
      this.automod = value.automod && typeof value.automod === "object" ? value.automod : {};
      this.auditLogs = value.auditLogs && typeof value.auditLogs === "object" ? value.auditLogs : {};
      this.autoRoles = value.autoRoles && typeof value.autoRoles === "object" ? value.autoRoles : {};
      this.welcomeMessages = value.welcomeMessages && typeof value.welcomeMessages === "object" ? value.welcomeMessages : {};
      this.signupApprovals = value.signupApprovals && typeof value.signupApprovals === "object" ? value.signupApprovals : {};
      this.approvedSignupMessages = value.approvedSignupMessages && typeof value.approvedSignupMessages === "object" ? value.approvedSignupMessages : {};
      this.playerStats = Array.isArray(value.playerStats) ? value.playerStats : [];
      this.teamLeaveDeadlines = value.teamLeaveDeadlines && typeof value.teamLeaveDeadlines === "object" ? value.teamLeaveDeadlines : {};
    } catch (error) {
      if (error.code === "ENOENT") return this.channelId;
      // A truncated config must never make the bot continue with empty defaults.
      // Recover the last known-good snapshot if one is available.
      try {
        const backup = JSON.parse(await readFile(`${this.filePath}.bak`, "utf8"));
        await this.#loadValue(backup);
        console.error(`Settings file ${this.filePath} was invalid; recovered the last known-good backup.`);
        await copyFile(`${this.filePath}.bak`, this.filePath);
        await this.save();
      } catch (backupError) {
        throw new Error(`Cannot load persistent settings from ${this.filePath}; refusing to start so ticket data is not overwritten. ${error.message}`);
      }
    }
    return this.channelId;
  }

  async #loadValue(value) {
    this.channelId = typeof value.channelId === "string" ? value.channelId : null;
    this.pending = value.pending && typeof value.pending === "object" ? value.pending : {};
    this.links = value.links && typeof value.links === "object" ? value.links : {};
    this.radioChannelId = typeof value.radioChannelId === "string" ? value.radioChannelId : null;
    this.radioVolume = Number.isFinite(Number(value.radioVolume)) ? Math.max(0, Math.min(100, Number(value.radioVolume))) : 80;
    this.teamSnapshot = value.teamSnapshot || { teams: [], players: [] };
    this.teamActions = Array.isArray(value.teamActions) ? value.teamActions : [];
    this.teamDrafts = value.teamDrafts && typeof value.teamDrafts === "object" ? value.teamDrafts : {};
    this.teamSignupDrafts = value.teamSignupDrafts && typeof value.teamSignupDrafts === "object" ? value.teamSignupDrafts : {};
    this.teamLeaderDrafts = value.teamLeaderDrafts && typeof value.teamLeaderDrafts === "object" ? value.teamLeaderDrafts : {};
    this.teamLeaderInvites = Array.isArray(value.teamLeaderInvites) ? value.teamLeaderInvites : [];
    this.originalNicknames = value.originalNicknames && typeof value.originalNicknames === "object" ? value.originalNicknames : {};
    this.teamNicknameOptOut = value.teamNicknameOptOut && typeof value.teamNicknameOptOut === "object" ? value.teamNicknameOptOut : {};
    this.schedules = Array.isArray(value.schedules) ? value.schedules : [];
    this.matchTicketConfig = value.matchTicketConfig && typeof value.matchTicketConfig === "object" ? value.matchTicketConfig : {};
    this.teamLogChannelId = typeof value.teamLogChannelId === "string" ? value.teamLogChannelId : null;
    this.teamLogDigest = typeof value.teamLogDigest === "string" ? value.teamLogDigest : "";
    this.ticketConfig = value.ticketConfig && typeof value.ticketConfig === "object" ? value.ticketConfig : {};
    this.tickets = value.tickets && typeof value.tickets === "object" ? value.tickets : {};
    this.automod = value.automod && typeof value.automod === "object" ? value.automod : {};
    this.auditLogs = value.auditLogs && typeof value.auditLogs === "object" ? value.auditLogs : {};
    this.autoRoles = value.autoRoles && typeof value.autoRoles === "object" ? value.autoRoles : {};
    this.welcomeMessages = value.welcomeMessages && typeof value.welcomeMessages === "object" ? value.welcomeMessages : {};
    this.signupApprovals = value.signupApprovals && typeof value.signupApprovals === "object" ? value.signupApprovals : {};
    this.approvedSignupMessages = value.approvedSignupMessages && typeof value.approvedSignupMessages === "object" ? value.approvedSignupMessages : {};
    this.playerStats = Array.isArray(value.playerStats) ? value.playerStats : [];
    this.teamLeaveDeadlines = value.teamLeaveDeadlines && typeof value.teamLeaveDeadlines === "object" ? value.teamLeaveDeadlines : {};
  }

  async saveChannel(channelId) {
    this.channelId = channelId;
    await this.save();
  }

  async save() {
    this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      const value = { channelId: this.channelId, radioChannelId: this.radioChannelId, radioVolume: this.radioVolume, pending: this.pending, links: this.links, teamSnapshot: this.teamSnapshot, teamActions: this.teamActions, teamDrafts: this.teamDrafts, teamSignupDrafts: this.teamSignupDrafts, teamLeaderDrafts: this.teamLeaderDrafts, teamLeaderInvites: this.teamLeaderInvites, originalNicknames: this.originalNicknames, teamNicknameOptOut: this.teamNicknameOptOut, schedules: this.schedules, matchTicketConfig: this.matchTicketConfig, teamLogChannelId: this.teamLogChannelId, teamLogDigest: this.teamLogDigest, ticketConfig: this.ticketConfig, tickets: this.tickets, automod: this.automod, auditLogs: this.auditLogs, autoRoles: this.autoRoles, welcomeMessages: this.welcomeMessages, signupApprovals: this.signupApprovals, approvedSignupMessages: this.approvedSignupMessages, playerStats: this.playerStats, teamLeaveDeadlines:this.teamLeaveDeadlines };
      if (!value.playerStats.length) delete value.playerStats;
      if (!Object.keys(value.teamLeaveDeadlines).length) delete value.teamLeaveDeadlines;
      await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
      try { await copyFile(this.filePath, `${this.filePath}.bak`); } catch (error) { if (error.code !== "ENOENT") throw error; }
      await rename(temporary, this.filePath);
    });
    return this.saveQueue;
  }
}
