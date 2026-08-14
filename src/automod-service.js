import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const automodCommand = new SlashCommandBuilder()
  .setName("automod")
  .setDescription("Configure MPCS automatic moderation")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command => command.setName("status").setDescription("Show the current automatic moderation settings"))
  .addSubcommand(command => command.setName("enable").setDescription("Enable or disable automatic moderation")
    .addBooleanOption(option => option.setName("enabled").setDescription("Whether automatic moderation is enabled").setRequired(true)))
  .addSubcommand(command => command.setName("log-channel").setDescription("Set the moderation log channel")
    .addChannelOption(option => option.setName("channel").setDescription("Channel for moderation logs").setRequired(true)))
  .addSubcommand(command => command.setName("settings").setDescription("Change filtering limits")
    .addIntegerOption(option => option.setName("spam-messages").setDescription("Messages allowed within 8 seconds").setMinValue(3).setMaxValue(20))
    .addIntegerOption(option => option.setName("max-mentions").setDescription("Maximum mentions in one message").setMinValue(1).setMaxValue(25))
    .addIntegerOption(option => option.setName("timeout-minutes").setDescription("Timeout length after repeated violations").setMinValue(1).setMaxValue(10080))
    .addBooleanOption(option => option.setName("block-invites").setDescription("Block Discord invite links"))
    .addBooleanOption(option => option.setName("block-links").setDescription("Block all web links")))
  .addSubcommand(command => command.setName("add-word").setDescription("Add a blocked word or phrase")
    .addStringOption(option => option.setName("text").setDescription("Word or phrase to block").setRequired(true).setMaxLength(100)))
  .addSubcommand(command => command.setName("remove-word").setDescription("Remove a blocked word or phrase")
    .addStringOption(option => option.setName("text").setDescription("Word or phrase to remove").setRequired(true).setMaxLength(100)))
  .addSubcommand(command => command.setName("exempt-role").setDescription("Set or clear the role ignored by automatic moderation")
    .addRoleOption(option => option.setName("role").setDescription("Leave empty to clear the exemption")));

export function defaultAutomodConfig() {
  return { enabled: false, logChannelId: null, spamMessages: 6, spamWindowMs: 8000, repeatMessages: 3, maxMentions: 5, timeoutMinutes: 10, blockInvites: true, blockLinks: false, blockedWords: [], exemptRoleId: null };
}

export function evaluateMessage(content, mentionCount, config, history, now = Date.now()) {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  if (mentionCount > config.maxMentions) return "excessive mentions";
  if (config.blockInvites && /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i.test(content)) return "Discord invite link";
  if (config.blockLinks && /https?:\/\/|\bwww\./i.test(content)) return "blocked link";
  const phrase = config.blockedWords.find(word => normalized.includes(String(word).toLowerCase()));
  if (phrase) return "blocked word or phrase";
  const recent = history.filter(entry => now - entry.at <= config.spamWindowMs);
  if (recent.length + 1 > config.spamMessages) return "message spam";
  if (normalized && recent.filter(entry => entry.text === normalized).length + 1 >= config.repeatMessages) return "repeated messages";
  return null;
}

export class AutoModService {
  constructor(client, settings) { this.client = client; this.settings = settings; this.history = new Map(); this.infractions = new Map(); }

  config(guildId) {
    const existing = this.settings.automod[guildId] || {};
    return this.settings.automod[guildId] = { ...defaultAutomodConfig(), ...existing, blockedWords: Array.isArray(existing.blockedWords) ? existing.blockedWords : [] };
  }

  async command(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return interaction.reply({ content: "You need Manage Server permission.", flags: MessageFlags.Ephemeral });
    const config = this.config(interaction.guildId), sub = interaction.options.getSubcommand();
    if (sub === "status") return interaction.reply({ embeds: [this.statusEmbed(config)], flags: MessageFlags.Ephemeral });
    if (sub === "enable") config.enabled = interaction.options.getBoolean("enabled", true);
    if (sub === "log-channel") {
      const channel = interaction.options.getChannel("channel", true);
      if (!channel.isTextBased() || !channel.isSendable()) return interaction.reply({ content: "Choose a text channel the bot can send to.", flags: MessageFlags.Ephemeral });
      config.logChannelId = channel.id;
    }
    if (sub === "settings") {
      for (const [option, key] of [["spam-messages","spamMessages"],["max-mentions","maxMentions"],["timeout-minutes","timeoutMinutes"]]) { const value=interaction.options.getInteger(option); if(value!==null) config[key]=value; }
      for (const [option, key] of [["block-invites","blockInvites"],["block-links","blockLinks"]]) { const value=interaction.options.getBoolean(option); if(value!==null) config[key]=value; }
    }
    if (sub === "add-word" || sub === "remove-word") {
      const phrase = interaction.options.getString("text", true).trim().toLowerCase();
      if (phrase.length < 2) return interaction.reply({ content: "Blocked entries must be at least two characters.", flags: MessageFlags.Ephemeral });
      config.blockedWords = sub === "add-word" ? [...new Set([...config.blockedWords, phrase])] : config.blockedWords.filter(word => word !== phrase);
    }
    if (sub === "exempt-role") config.exemptRoleId = interaction.options.getRole("role")?.id || null;
    await this.settings.save();
    await interaction.reply({ content: "Automatic moderation settings updated.", embeds: [this.statusEmbed(config)], flags: MessageFlags.Ephemeral });
  }

  statusEmbed(config) {
    return new EmbedBuilder().setColor(config.enabled ? 0x22c55e : 0xef4444).setTitle("MPCS Auto Moderation")
      .setDescription(config.enabled ? "Enabled" : "Disabled")
      .addFields(
        { name: "Spam", value: `${config.spamMessages} messages / ${config.spamWindowMs / 1000}s`, inline: true },
        { name: "Mentions", value: `${config.maxMentions} maximum`, inline: true },
        { name: "Timeout", value: `${config.timeoutMinutes} minutes`, inline: true },
        { name: "Invites", value: config.blockInvites ? "Blocked" : "Allowed", inline: true },
        { name: "Links", value: config.blockLinks ? "Blocked" : "Allowed", inline: true },
        { name: "Blocked entries", value: String(config.blockedWords.length), inline: true },
        { name: "Log channel", value: config.logChannelId ? `<#${config.logChannelId}>` : "Not set", inline: true },
        { name: "Exempt role", value: config.exemptRoleId ? `<@&${config.exemptRoleId}>` : "Staff permissions only", inline: true }
      );
  }

  async message(message) {
    if (!message.inGuild() || message.author.bot || !message.member) return;
    const config = this.config(message.guildId);
    if (!config.enabled || message.member.permissions.has(PermissionFlagsBits.ManageMessages) || (config.exemptRoleId && message.member.roles.cache.has(config.exemptRoleId))) return;
    const key = `${message.guildId}:${message.author.id}`, now = Date.now();
    const prior = (this.history.get(key) || []).filter(entry => now - entry.at <= config.spamWindowMs);
    const mentions = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? config.maxMentions + 1 : 0);
    const reason = evaluateMessage(message.content, mentions, config, prior, now);
    prior.push({ at: now, text: message.content.toLowerCase().replace(/\s+/g," ").trim() });
    this.history.set(key, prior.slice(-Math.max(config.spamMessages + 2, 10)));
    if (!reason) return;
    await message.delete().catch(() => null);
    const warning = await message.channel.send({ content: `<@${message.author.id}>, your message was removed: **${reason}**.`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
    if (warning) setTimeout(() => void warning.delete().catch(() => null), 5000);
    const strikes = (this.infractions.get(key) || []).filter(at => now - at < 15 * 60_000); strikes.push(now); this.infractions.set(key, strikes);
    let timedOut = false;
    if (strikes.length >= 2 && message.member.moderatable) { await message.member.timeout(config.timeoutMinutes * 60_000, `MPCS AutoMod: ${reason}`).catch(() => null); timedOut = true; this.infractions.set(key, []); }
    await this.log(message, reason, timedOut, config);
  }

  async log(message, reason, timedOut, config) {
    if (!config.logChannelId) return;
    const channel = await this.client.channels.fetch(config.logChannelId).catch(() => null);
    if (!channel?.isSendable()) return;
    await channel.send({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle("Automatic moderation action")
      .addFields({ name:"Member",value:`<@${message.author.id}> (${message.author.id})` },{ name:"Channel",value:`<#${message.channelId}>` },{ name:"Reason",value:reason },{ name:"Action",value:timedOut?`Message removed + ${config.timeoutMinutes} minute timeout`:"Message removed + warning" },{ name:"Message",value:(message.content || "(no text)").slice(0,1000) }).setTimestamp()] });
  }
}
