import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, RoleSelectMenuBuilder, SlashCommandBuilder } from "discord.js";

export const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Set up or manage support tickets")
  .addSubcommand(command => command.setName("panel").setDescription("Open the ticket control panel"))
  .addSubcommand(command => command.setName("close").setDescription("Close the current ticket"));

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const panel = () => ({
  embeds: [new EmbedBuilder().setColor(0x00e5ff).setTitle("MPCS SUPPORT").setDescription("Need help? Open a private ticket and a staff member will assist you.\n\nPlease create only one ticket at a time.").setFooter({ text: "MPCS Support System" })],
  components: [row(new ButtonBuilder().setCustomId("ticket:open").setLabel("Open Ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary))]
});
const closeRow = () => row(new ButtonBuilder().setCustomId("ticket:close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger));
const ticketKey = interaction => `${interaction.guildId}:${interaction.user.id}`;
const safeName = name => name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "member";
const configFor = (settings, guildId) => settings.ticketConfig[guildId];
const ticketInChannel = (settings, channelId) => Object.entries(settings.tickets).find(([, ticket]) => ticket.channelId === channelId);

function controlPanel(settings, guildId, notice = "Use the selectors below—everything saves automatically.") {
  const config = configFor(settings, guildId) || {};
  const ready = Boolean(config.panelChannelId && config.categoryId && config.supportRoleId);
  return {
    content: "",
    embeds: [new EmbedBuilder().setColor(config.enabled === false ? 0xed4245 : 0x00e5ff).setTitle("MPCS TICKET CONTROL CENTER").setDescription(`${notice}\n\n${ready ? "✅ **Ready to post**" : "⚠️ **Select all three settings below**"}`).addFields(
      { name: "Public Panel Channel", value: config.panelChannelId ? `<#${config.panelChannelId}>` : "Not selected", inline: true },
      { name: "Private Ticket Category", value: config.categoryId ? `<#${config.categoryId}>` : "Not selected", inline: true },
      { name: "Support Team", value: config.supportRoleId ? `<@&${config.supportRoleId}>` : "Not selected", inline: true },
      { name: "New Tickets", value: config.enabled === false ? "🔴 Disabled" : "🟢 Enabled", inline: true },
      { name: "Open Tickets", value: String(Object.keys(settings.tickets).filter(key => key.startsWith(`${guildId}:`)).length), inline: true }
    ).setFooter({ text: "Settings persist automatically across restarts" })],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId("ticket:config-panel").setPlaceholder("1. Select the public ticket-panel channel").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId("ticket:config-category").setPlaceholder("2. Select the private ticket category").setChannelTypes(ChannelType.GuildCategory).setMinValues(1).setMaxValues(1)),
      row(new RoleSelectMenuBuilder().setCustomId("ticket:config-role").setPlaceholder("3. Select the staff support role").setMinValues(1).setMaxValues(1)),
      row(new ButtonBuilder().setCustomId("ticket:post-panel").setLabel("Post Ticket Panel").setEmoji("📨").setStyle(ButtonStyle.Success).setDisabled(!ready), new ButtonBuilder().setCustomId("ticket:toggle").setLabel(config.enabled === false ? "Enable New Tickets" : "Disable New Tickets").setStyle(config.enabled === false ? ButtonStyle.Success : ButtonStyle.Danger), new ButtonBuilder().setCustomId("ticket:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary))
    ]
  };
}

async function canClose(interaction, settings, record) {
  if (record.userId === interaction.user.id) return true;
  const config = configFor(settings, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.permissions.has(PermissionFlagsBits.ManageChannels) || Boolean(config?.supportRoleId && member.roles.cache.has(config.supportRoleId));
}

async function requestClose(interaction, settings) {
  const found = ticketInChannel(settings, interaction.channelId);
  if (!found || !(await canClose(interaction, settings, found[1]))) return interaction.reply({ content: "This is not your ticket, or you do not have permission to close it.", flags: MessageFlags.Ephemeral });
  return interaction.reply({ content: "Are you sure you want to permanently close this ticket?", components: [row(new ButtonBuilder().setCustomId("ticket:confirm-close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("ticket:cancel-close").setLabel("Cancel").setStyle(ButtonStyle.Secondary))], flags: MessageFlags.Ephemeral });
}

export async function handleTicketCommand(interaction, settings) {
  if (!interaction.inGuild()) return interaction.reply({ content: "Tickets are only available inside the MPCS Discord server.", flags: MessageFlags.Ephemeral });
  if (interaction.options.getSubcommand() === "close") return requestClose(interaction, settings);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server permission to open the ticket control panel.", flags: MessageFlags.Ephemeral });
  return interaction.reply({ ...controlPanel(settings, interaction.guildId), flags: MessageFlags.Ephemeral });
}

export async function handleTicketComponent(interaction, settings) {
  const action = interaction.customId.split(":")[1];
  if (["config-panel", "config-category", "config-role", "post-panel", "toggle", "refresh"].includes(action)) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server permission to use this control panel.", flags: MessageFlags.Ephemeral });
    const config = settings.ticketConfig[interaction.guildId] ||= { enabled: true };
    if (action === "config-panel") config.panelChannelId = interaction.values[0];
    if (action === "config-category") config.categoryId = interaction.values[0];
    if (action === "config-role") config.supportRoleId = interaction.values[0];
    if (action === "toggle") config.enabled = config.enabled === false;
    if (["config-panel", "config-category", "config-role", "toggle"].includes(action)) { await settings.save(); return interaction.update(controlPanel(settings, interaction.guildId, "✅ Setting saved.")); }
    if (action === "refresh") return interaction.update(controlPanel(settings, interaction.guildId, "Control panel refreshed."));
    const panelChannel = await interaction.guild.channels.fetch(config.panelChannelId).catch(() => null), category = await interaction.guild.channels.fetch(config.categoryId).catch(() => null), supportRole = interaction.guild.roles.cache.get(config.supportRoleId), me = interaction.guild.members.me;
    if (!panelChannel?.isSendable() || category?.type !== ChannelType.GuildCategory || !supportRole) return interaction.update(controlPanel(settings, interaction.guildId, "❌ One of your selections no longer exists. Select it again."));
    if (!panelChannel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.update(controlPanel(settings, interaction.guildId, "❌ I need Manage Channels plus View Channel, Send Messages, and Embed Links in the selected panel channel."));
    await panelChannel.send(panel());
    return interaction.update(controlPanel(settings, interaction.guildId, `✅ Ticket panel posted in ${panelChannel}.`));
  }
  if (action === "close") return requestClose(interaction, settings);
  if (action === "cancel-close") return interaction.update({ content: "Ticket closure cancelled.", components: [] });
  if (action === "confirm-close") {
    const found = ticketInChannel(settings, interaction.channelId);
    if (!found || !(await canClose(interaction, settings, found[1]))) return interaction.update({ content: "This ticket no longer exists or you cannot close it.", components: [] });
    delete settings.tickets[found[0]]; await settings.save();
    await interaction.update({ content: "Ticket closed. This channel will be deleted in 5 seconds.", components: [] });
    setTimeout(() => void interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(error => console.error("Could not delete closed ticket channel:", error)), 5000);
    return;
  }
  if (action !== "open") return;
  const config = configFor(settings, interaction.guildId);
  if (!config || config.enabled === false) return interaction.reply({ content: config?.enabled === false ? "New tickets are currently disabled." : "The ticket system has not been configured yet.", flags: MessageFlags.Ephemeral });
  const key = ticketKey(interaction), existing = settings.tickets[key];
  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    if (channel) return interaction.reply({ content: `You already have an open ticket: ${channel}`, flags: MessageFlags.Ephemeral });
    delete settings.tickets[key]; await settings.save();
  }
  const category = await interaction.guild.channels.fetch(config.categoryId).catch(() => null), supportRole = interaction.guild.roles.cache.get(config.supportRoleId);
  if (!category || category.type !== ChannelType.GuildCategory || !supportRole) return interaction.reply({ content: "The ticket configuration is no longer valid. Please notify an administrator.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const channel = await interaction.guild.channels.create({ name: `ticket-${safeName(interaction.user.username)}`, type: ChannelType.GuildText, parent: category.id, topic: `MPCS ticket opened by ${interaction.user.tag} (${interaction.user.id})`, permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
      { id: supportRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
    ], reason: `Ticket opened by ${interaction.user.tag}` });
    settings.tickets[key] = { channelId: channel.id, userId: interaction.user.id, openedAt: new Date().toISOString() }; await settings.save();
    await channel.send({ content: `${interaction.user} ${supportRole}`, embeds: [new EmbedBuilder().setColor(0x00e5ff).setTitle("TICKET OPENED").setDescription("Describe what you need help with and a staff member will respond as soon as possible.").setFooter({ text: `Opened by ${interaction.user.tag}` }).setTimestamp()], components: [closeRow()], allowedMentions: { users: [interaction.user.id], roles: [supportRole.id] } });
    await interaction.editReply(`Your private ticket is ready: ${channel}`);
  } catch (error) {
    console.error("Could not create ticket:", error);
    await interaction.editReply("I could not create your ticket. Check my channel and role permissions, then try again.");
  }
}
