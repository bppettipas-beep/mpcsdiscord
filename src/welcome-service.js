import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const welcomeCommand = new SlashCommandBuilder()
  .setName("welcome")
  .setDescription("Configure welcome messages for new members")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command => command.setName("set").setDescription("Set the welcome channel and message")
    .addChannelOption(option => option.setName("channel").setDescription("Channel for welcome messages").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption(option => option.setName("message").setDescription("Welcome text with placeholders").setRequired(true).setMaxLength(1900)))
  .addSubcommand(command => command.setName("status").setDescription("Show the current welcome configuration"))
  .addSubcommand(command => command.setName("test").setDescription("Preview the welcome message using your account"))
  .addSubcommand(command => command.setName("disable").setDescription("Disable welcome messages"));

export const placeholders = ["{guild name}", "{member name}", "{member mention}", "{member tag}", "{member id}", "{member count}"];

export function formatWelcome(template, member) {
  const values = {
    "{guild name}": member.guild.name,
    "{member name}": member.displayName || member.user.globalName || member.user.username,
    "{member mention}": `<@${member.id}>`,
    "{member tag}": member.user.tag,
    "{member id}": member.id,
    "{member count}": String(member.guild.memberCount)
  };
  return Object.entries(values).reduce((text, [placeholder, value]) => text.replaceAll(placeholder, value), template);
}

async function sendConfigured(member, settings) {
  const config = settings.welcomeMessages[member.guild.id];
  if (!config) throw new Error("Welcome messages are disabled in this server.");
  const channel = await member.guild.channels.fetch(config.channelId);
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("The configured welcome channel no longer exists or is not sendable.");
  await channel.send({ content: formatWelcome(config.message, member), allowedMentions: { users: [member.id], roles: [], repliedUser: false } });
  return channel;
}

export async function welcomeMember(member, settings) {
  if (!settings.welcomeMessages[member.guild.id]) return;
  await sendConfigured(member, settings);
}

export async function handleWelcomeCommand(interaction, settings) {
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server permission.", flags: MessageFlags.Ephemeral });
  const action = interaction.options.getSubcommand();
  if (action === "disable") {
    delete settings.welcomeMessages[interaction.guildId]; await settings.save();
    return interaction.reply({ content: "Welcome messages are now disabled.", flags: MessageFlags.Ephemeral });
  }
  if (action === "status") {
    const config = settings.welcomeMessages[interaction.guildId];
    return interaction.reply({ content: config ? `Welcome channel: <#${config.channelId}>\nMessage: ${config.message}\n\nPlaceholders: ${placeholders.join(", ")}` : `Welcome messages are disabled.\n\nPlaceholders: ${placeholders.join(", ")}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  if (action === "test") {
    try { const channel = await sendConfigured(interaction.member, settings); return interaction.reply({ content: `Test welcome sent to ${channel}.`, flags: MessageFlags.Ephemeral }); }
    catch (error) { return interaction.reply({ content: `Could not send the test: ${error.message}`, flags: MessageFlags.Ephemeral }); }
  }
  const channel = interaction.options.getChannel("channel", true), message = interaction.options.getString("message", true).trim();
  if (!message) return interaction.reply({ content: "The welcome message cannot be empty.", flags: MessageFlags.Ephemeral });
  const permissions = channel.permissionsFor(interaction.guild.members.me);
  if (!channel.isSendable() || !permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return interaction.reply({ content: "I need View Channel and Send Messages permission in that channel.", flags: MessageFlags.Ephemeral });
  settings.welcomeMessages[interaction.guildId] = { channelId: channel.id, message }; await settings.save();
  return interaction.reply({ content: `Welcome messages will be sent to ${channel}.\nUse \`/welcome test\` to preview it.\n\nPlaceholders: ${placeholders.join(", ")}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
