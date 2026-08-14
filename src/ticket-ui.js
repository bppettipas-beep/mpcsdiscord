import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

export const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Set up or manage support tickets")
  .addSubcommand(command => command.setName("panel").setDescription("Open the ticket control panel"))
  .addSubcommand(command => command.setName("edit").setDescription("Edit the configured ticket panel"))
  .addSubcommand(command => command.setName("close").setDescription("Close the current ticket"))
  .addSubcommand(command => command.setName("request-close").setDescription("Ask the ticket opener for permission to close"));

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const appearance = config => ({ title: config?.appearance?.title || "MPCS SUPPORT", description: config?.appearance?.description || "Need help? Open a private ticket and a staff member will assist you.\n\nPlease create only one ticket at a time.", footer: config?.appearance?.footer || "MPCS Support System" });
const styles = { Primary: ButtonStyle.Primary, Success: ButtonStyle.Success, Secondary: ButtonStyle.Secondary, Danger: ButtonStyle.Danger };
const ticketTypes = config => config?.ticketTypes?.length ? config.ticketTypes : [{ id: "support", name: "Support", label: config?.appearance?.buttonLabel || "Open Ticket", style: config?.appearance?.buttonStyle || "Primary", pingRoleId: config?.supportRoleId || null, questions: [] }];
const ensureTypes = config => config.ticketTypes ||= ticketTypes(config).map(type => ({ ...type }));
const panel = config => {
  const look = appearance(config);
  const types = ticketTypes(config), components = [];
  if (config?.layout === "dropdown") components.push(row(new StringSelectMenuBuilder().setCustomId("ticket:open-select").setPlaceholder("Select a ticket type").addOptions(types.map(type => ({ label: type.label, value: type.id, description: `Open a ${type.name} ticket`.slice(0, 100), emoji: "🎫" })))));
  else { const buttons = types.map(type => new ButtonBuilder().setCustomId(`ticket:open:${type.id}`).setLabel(type.label).setEmoji("🎫").setStyle(styles[type.style] || ButtonStyle.Primary)); for (let index = 0; index < buttons.length; index += 5) components.push(row(...buttons.slice(index, index + 5))); }
  return { embeds: [new EmbedBuilder().setColor(0x00e5ff).setTitle(look.title).setDescription(look.description).setFooter({ text: look.footer })], components };
};
const ticketActions = record => row(new ButtonBuilder().setCustomId("ticket:close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("ticket:claim").setLabel(record?.claimedBy ? "Claimed" : "Claim Ticket").setEmoji("✋").setStyle(ButtonStyle.Success).setDisabled(Boolean(record?.claimedBy)));
const ticketKey = interaction => `${interaction.guildId}:${interaction.user.id}`;
const safeName = name => name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "member";
const configFor = (settings, guildId) => settings.ticketConfig[guildId];
const ticketInChannel = (settings, channelId) => Object.entries(settings.tickets).find(([, ticket]) => ticket.channelId === channelId);

function typeManager(config, selectedId, notice = "Add a ticket type or select one to edit it.") {
  const types = ticketTypes(config), selected = types.find(type => type.id === selectedId);
  const components = [row(new StringSelectMenuBuilder().setCustomId("ticket:type-select").setPlaceholder("Select a ticket button to edit").addOptions(types.map(type => ({ label: type.label, value: type.id, description: `${type.name} • ${type.style}` }))))];
  if (selected) components.push(row(new RoleSelectMenuBuilder().setCustomId(`ticket:type-role:${selected.id}`).setPlaceholder(selected.pingRoleId ? "Change this ticket's ping and claim role" : "Select the role this ticket should ping").setMinValues(1).setMaxValues(1)));
  components.push(row(new ButtonBuilder().setCustomId("ticket:add-type").setLabel("Add Button").setEmoji("➕").setStyle(ButtonStyle.Success), ...(selected ? [new ButtonBuilder().setCustomId(`ticket:edit-type:${selected.id}`).setLabel("Edit Name").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`ticket:edit-questions:${selected.id}`).setLabel("Edit Questions").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`ticket:type-style:${selected.id}`).setLabel(`Style: ${selected.style}`).setStyle(ButtonStyle.Secondary)] : [])));
  components.push(row(new ButtonBuilder().setCustomId("ticket:layout").setLabel(config.layout === "dropdown" ? "Layout: Dropdown" : "Layout: Buttons").setStyle(ButtonStyle.Primary), ...(selected ? [new ButtonBuilder().setCustomId(`ticket:delete-type:${selected.id}`).setLabel("Delete Selected").setStyle(ButtonStyle.Danger)] : []), new ButtonBuilder().setCustomId("ticket:back-control").setLabel("Back").setStyle(ButtonStyle.Secondary)));
  return { content: "", embeds: [new EmbedBuilder().setColor(0x00e5ff).setTitle("TICKET BUTTON MANAGER").setDescription(`${notice}\n\n**Public layout: ${config.layout === "dropdown" ? "Dropdown selection" : "Individual buttons"}**\n\n${types.map((type, index) => `**${index + 1}. ${type.label}**\nCreates \`${safeName(type.name)}-1\`, \`${safeName(type.name)}-2\`, etc. • ${type.style}\nPings: ${type.pingRoleId ? `<@&${type.pingRoleId}>` : "default support role"} • ${(type.questions || []).length} question(s)`).join("\n\n")}`).setFooter({ text: `${types.length}/10 ticket options configured` })], components };
}

function controlPanel(settings, guildId, notice = "Use the selectors below—everything saves automatically.") {
  const config = configFor(settings, guildId) || {};
  const look = appearance(config);
  const ready = Boolean(config.panelChannelId && config.categoryId && config.supportRoleId);
  return {
    content: "",
    embeds: [new EmbedBuilder().setColor(config.enabled === false ? 0xed4245 : 0x00e5ff).setTitle("MPCS TICKET CONTROL CENTER").setDescription(`${notice}\n\n${ready ? "✅ **Ready to post**" : "⚠️ **Select all three settings below**"}`).addFields(
      { name: "Public Panel Channel", value: config.panelChannelId ? `<#${config.panelChannelId}>` : "Not selected", inline: true },
      { name: "Private Ticket Category", value: config.categoryId ? `<#${config.categoryId}>` : "Not selected", inline: true },
      { name: "Default Support Role", value: config.supportRoleId ? `<@&${config.supportRoleId}>` : "Not selected", inline: true },
      { name: "New Tickets", value: config.enabled === false ? "🔴 Disabled" : "🟢 Enabled", inline: true },
      { name: "Open Tickets", value: String(Object.keys(settings.tickets).filter(key => key.startsWith(`${guildId}:`)).length), inline: true },
      { name: "Panel Appearance", value: `**${look.title}**\n${look.description.slice(0, 160)}${look.description.length > 160 ? "…" : ""}\n**${ticketTypes(config).length} customizable ticket button${ticketTypes(config).length === 1 ? "" : "s"}**` }
    ).setFooter({ text: "Settings persist automatically across restarts" })],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId("ticket:config-panel").setPlaceholder("1. Select the public ticket-panel channel").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId("ticket:config-category").setPlaceholder("2. Select the private ticket category").setChannelTypes(ChannelType.GuildCategory).setMinValues(1).setMaxValues(1)),
      row(new RoleSelectMenuBuilder().setCustomId("ticket:config-role").setPlaceholder("3. Select the staff support role").setMinValues(1).setMaxValues(1)),
      row(new ButtonBuilder().setCustomId("ticket:edit-appearance").setLabel("Edit Panel Text").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId("ticket:manage-buttons").setLabel("Manage Buttons").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId("ticket:post-panel").setLabel("Post New").setEmoji("📨").setStyle(ButtonStyle.Success).setDisabled(!ready), new ButtonBuilder().setCustomId("ticket:update-panel").setLabel("Update Live").setStyle(ButtonStyle.Success).setDisabled(!config.livePanel), new ButtonBuilder().setCustomId("ticket:toggle").setLabel(config.enabled === false ? "Enable" : "Disable").setStyle(config.enabled === false ? ButtonStyle.Success : ButtonStyle.Danger))
    ]
  };
}

async function canClose(interaction, settings, record) {
  if (record.userId === interaction.user.id) return true;
  return isTicketStaff(interaction, settings, record);
}

async function isTicketStaff(interaction, settings, record) {
  const config = configFor(settings, interaction.guildId), member = await interaction.guild.members.fetch(interaction.user.id);
  const roleId = record.pingRoleId || config?.supportRoleId;
  return member.permissions.has(PermissionFlagsBits.ManageChannels) || Boolean(roleId && member.roles.cache.has(roleId));
}

async function requestClose(interaction, settings) {
  const found = ticketInChannel(settings, interaction.channelId);
  if (!found || !(await canClose(interaction, settings, found[1]))) return interaction.reply({ content: "This is not your ticket, or you do not have permission to close it.", flags: MessageFlags.Ephemeral });
  return interaction.reply({ content: "Are you sure you want to permanently close this ticket?", components: [row(new ButtonBuilder().setCustomId("ticket:confirm-close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("ticket:cancel-close").setLabel("Cancel").setStyle(ButtonStyle.Secondary))], flags: MessageFlags.Ephemeral });
}

async function requestOwnerClose(interaction, settings) {
  const found = ticketInChannel(settings, interaction.channelId);
  if (!found || !(await isTicketStaff(interaction, settings, found[1]))) return interaction.reply({ content: "Only the staff role assigned to this ticket can request closure.", flags: MessageFlags.Ephemeral });
  await interaction.channel.send({ content: `<@${found[1].userId}>`, embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("CLOSE TICKET?").setDescription(`${interaction.user} has requested to close this ticket. Do you want to close it?`)], components: [row(new ButtonBuilder().setCustomId("ticket:accept-request").setLabel("Yes, Close Ticket").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("ticket:decline-request").setLabel("Keep It Open").setStyle(ButtonStyle.Secondary))], allowedMentions: { users: [found[1].userId] } });
  return interaction.reply({ content: "Closure request sent to the ticket opener.", flags: MessageFlags.Ephemeral });
}

export async function handleTicketCommand(interaction, settings) {
  if (!interaction.inGuild()) return interaction.reply({ content: "Tickets are only available inside the MPCS Discord server.", flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "close") return requestClose(interaction, settings);
  if (subcommand === "request-close") return requestOwnerClose(interaction, settings);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server permission to open the ticket control panel.", flags: MessageFlags.Ephemeral });
  return interaction.reply({ ...controlPanel(settings, interaction.guildId, subcommand === "edit" ? "Edit the live panel below, then click **Update Live**." : undefined), flags: MessageFlags.Ephemeral });
}

export async function handleTicketComponent(interaction, settings) {
  let [, action, targetId] = interaction.customId.split(":");
  if (action === "open-select") { action = "open"; targetId = interaction.values[0]; }
  if (["config-panel", "config-category", "config-role", "edit-appearance", "save-appearance", "manage-buttons", "layout", "type-select", "type-role", "add-type", "edit-type", "save-type", "edit-questions", "save-questions", "type-style", "delete-type", "back-control", "post-panel", "update-panel", "toggle", "refresh"].includes(action)) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server permission to use this control panel.", flags: MessageFlags.Ephemeral });
    const config = settings.ticketConfig[interaction.guildId] ||= { enabled: true };
    if (action === "edit-appearance") {
      const look = appearance(config), input = (id, label, value, style, max) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setValue(value).setStyle(style).setRequired(true).setMaxLength(max));
      return interaction.showModal(new ModalBuilder().setCustomId("ticket:save-appearance").setTitle("Customize Ticket Panel").addComponents(input("title", "Panel title", look.title, TextInputStyle.Short, 256), input("description", "Panel message", look.description, TextInputStyle.Paragraph, 4000), input("footer", "Panel footer", look.footer, TextInputStyle.Short, 2048)));
    }
    if (action === "save-appearance") {
      config.appearance = { ...appearance(config), title: interaction.fields.getTextInputValue("title").trim(), description: interaction.fields.getTextInputValue("description").trim(), footer: interaction.fields.getTextInputValue("footer").trim() };
      await settings.save(); return interaction.update(controlPanel(settings, interaction.guildId, "✅ Ticket panel text saved."));
    }
    if (action === "manage-buttons") return interaction.update(typeManager(config));
    if (action === "layout") { config.layout = config.layout === "dropdown" ? "buttons" : "dropdown"; await settings.save(); return interaction.update(typeManager(config, null, `✅ Public ticket layout changed to ${config.layout === "dropdown" ? "a dropdown" : "individual buttons"}.`)); }
    if (action === "back-control") return interaction.update(controlPanel(settings, interaction.guildId));
    if (action === "type-select") return interaction.update(typeManager(config, interaction.values[0], "Selected. Use the controls below to edit this button."));
    if (action === "type-role") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); type.pingRoleId = interaction.values[0]; await settings.save(); return interaction.update(typeManager(config, type.id, "✅ Ping and claim role updated.")); }
    if (action === "add-type" || action === "edit-type") {
      const existing = action === "edit-type" ? ticketTypes(config).find(type => type.id === targetId) : null;
      if (action === "add-type" && ticketTypes(config).length >= 10) return interaction.reply({ content: "A ticket panel can have at most 10 buttons.", flags: MessageFlags.Ephemeral });
      if (action === "edit-type" && !existing) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral });
      const input = (id, label, value, max) => { const builder = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max); if (value) builder.setValue(value); return row(builder); };
      return interaction.showModal(new ModalBuilder().setCustomId(`ticket:save-type:${existing?.id || "new"}`).setTitle(existing ? "Edit Ticket Button" : "Add Ticket Button").addComponents(input("type-name", "Ticket type / channel name", existing?.name || "", 40), input("button-label", "Button text", existing?.label || "", 80)));
    }
    if (action === "save-type") {
      const name = interaction.fields.getTextInputValue("type-name").trim(), label = interaction.fields.getTextInputValue("button-label").trim(), types = ensureTypes(config), duplicate = types.some(type => type.id !== targetId && type.name.toLowerCase() === name.toLowerCase());
      if (duplicate) return interaction.reply({ content: "A ticket type with that name already exists.", flags: MessageFlags.Ephemeral });
      if (targetId === "new") { const type = { id: randomUUID().slice(0, 8), name, label, style: "Primary", pingRoleId: config.supportRoleId || null, questions: [] }; types.push(type); await settings.save(); return interaction.update(typeManager(config, type.id, "✅ New ticket button added. Select its ping role and optional questions below.")); }
      const type = types.find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral });
      type.name = name; type.label = label; await settings.save(); return interaction.update(typeManager(config, type.id, "✅ Ticket button updated."));
    }
    if (action === "edit-questions") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); const questions = (type.questions || []).join("\n"); const builder = new TextInputBuilder().setCustomId("questions").setLabel("One question per line (maximum 5)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000); if (questions) builder.setValue(questions); return interaction.showModal(new ModalBuilder().setCustomId(`ticket:save-questions:${type.id}`).setTitle("Ticket Intake Questions").addComponents(row(builder))); }
    if (action === "save-questions") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); const questions = interaction.fields.getTextInputValue("questions").split(/\r?\n/).map(value => value.trim()).filter(Boolean); if (questions.length > 5) return interaction.reply({ content: "Use at most five questions, one per line.", flags: MessageFlags.Ephemeral }); if (questions.some(question => question.length > 100)) return interaction.reply({ content: "Each question must be 100 characters or fewer.", flags: MessageFlags.Ephemeral }); type.questions = questions; await settings.save(); return interaction.update(typeManager(config, type.id, `✅ Saved ${questions.length} intake question${questions.length === 1 ? "" : "s"}.`)); }
    if (action === "type-style") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); const names = Object.keys(styles); type.style = names[(names.indexOf(type.style) + 1) % names.length]; await settings.save(); return interaction.update(typeManager(config, type.id, "✅ Button style updated.")); }
    if (action === "delete-type") { const types = ensureTypes(config); if (types.length <= 1) return interaction.reply({ content: "Keep at least one ticket button.", flags: MessageFlags.Ephemeral }); config.ticketTypes = types.filter(type => type.id !== targetId); await settings.save(); return interaction.update(typeManager(config, null, "✅ Ticket button deleted. Existing open tickets were not affected.")); }
    if (action === "config-panel") config.panelChannelId = interaction.values[0];
    if (action === "config-category") config.categoryId = interaction.values[0];
    if (action === "config-role") config.supportRoleId = interaction.values[0];
    if (action === "toggle") config.enabled = config.enabled === false;
    if (["config-panel", "config-category", "config-role", "toggle"].includes(action)) { await settings.save(); return interaction.update(controlPanel(settings, interaction.guildId, "✅ Setting saved.")); }
    if (action === "refresh") return interaction.update(controlPanel(settings, interaction.guildId, "Control panel refreshed."));
    if (action === "update-panel") { const live = config.livePanel, channel = live ? await interaction.guild.channels.fetch(live.channelId).catch(() => null) : null, message = channel?.isTextBased() ? await channel.messages.fetch(live.messageId).catch(() => null) : null; if (!message) { delete config.livePanel; await settings.save(); return interaction.update(controlPanel(settings, interaction.guildId, "❌ The live panel message no longer exists. Post a new one.")); } const updated = await message.edit(panel(config)).then(() => true).catch(() => false); return interaction.update(controlPanel(settings, interaction.guildId, updated ? "✅ Live ticket panel updated." : "❌ I could not edit the live panel. Check my permissions.")); }
    const panelChannel = await interaction.guild.channels.fetch(config.panelChannelId).catch(() => null), category = await interaction.guild.channels.fetch(config.categoryId).catch(() => null), supportRole = interaction.guild.roles.cache.get(config.supportRoleId), me = interaction.guild.members.me;
    if (!panelChannel?.isSendable() || category?.type !== ChannelType.GuildCategory || !supportRole) return interaction.update(controlPanel(settings, interaction.guildId, "❌ One of your selections no longer exists. Select it again."));
    if (!panelChannel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.update(controlPanel(settings, interaction.guildId, "❌ I need Manage Channels plus View Channel, Send Messages, and Embed Links in the selected panel channel."));
    const posted = await panelChannel.send(panel(config)); config.livePanel = { channelId: panelChannel.id, messageId: posted.id }; await settings.save();
    return interaction.update(controlPanel(settings, interaction.guildId, `✅ Ticket panel posted in ${panelChannel}.`));
  }
  if (action === "close") return requestClose(interaction, settings);
  if (action === "claim") {
    const found = ticketInChannel(settings, interaction.channelId);
    if (!found || !(await isTicketStaff(interaction, settings, found[1]))) return interaction.reply({ content: "Only the role assigned to this ticket can claim it.", flags: MessageFlags.Ephemeral });
    if (found[1].claimedBy) return interaction.reply({ content: `This ticket is already claimed by <@${found[1].claimedBy}>.`, flags: MessageFlags.Ephemeral });
    found[1].claimedBy = interaction.user.id; await settings.save();
    await interaction.update({ components: [ticketActions(found[1])] });
    await interaction.followUp({ content: `✋ ${interaction.user} claimed this ticket.` }); return;
  }
  if (action === "cancel-close") return interaction.update({ content: "Ticket closure cancelled.", components: [] });
  if (action === "decline-request") { const found = ticketInChannel(settings, interaction.channelId); if (!found || found[1].userId !== interaction.user.id) return interaction.reply({ content: "Only the person who opened this ticket can answer.", flags: MessageFlags.Ephemeral }); return interaction.update({ content: "The ticket opener chose to keep this ticket open.", embeds: [], components: [] }); }
  if (action === "accept-request") { const found = ticketInChannel(settings, interaction.channelId); if (!found || found[1].userId !== interaction.user.id) return interaction.reply({ content: "Only the person who opened this ticket can answer.", flags: MessageFlags.Ephemeral }); delete settings.tickets[found[0]]; await settings.save(); await interaction.update({ content: "The ticket opener accepted the closure request. This channel will be deleted in 5 seconds.", embeds: [], components: [] }); setTimeout(() => void interaction.channel.delete(`Ticket closure accepted by ${interaction.user.tag}`).catch(error => console.error("Could not delete accepted ticket channel:", error)), 5000); return; }
  if (action === "confirm-close") {
    const found = ticketInChannel(settings, interaction.channelId);
    if (!found || !(await canClose(interaction, settings, found[1]))) return interaction.update({ content: "This ticket no longer exists or you cannot close it.", components: [] });
    delete settings.tickets[found[0]]; await settings.save();
    await interaction.update({ content: "Ticket closed. This channel will be deleted in 5 seconds.", components: [] });
    setTimeout(() => void interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(error => console.error("Could not delete closed ticket channel:", error)), 5000);
    return;
  }
  if (!["open", "answers"].includes(action)) return;
  const config = configFor(settings, interaction.guildId);
  if (!config || config.enabled === false) return interaction.reply({ content: config?.enabled === false ? "New tickets are currently disabled." : "The ticket system has not been configured yet.", flags: MessageFlags.Ephemeral });
  const type = ticketTypes(config).find(entry => entry.id === targetId) || (!targetId ? ticketTypes(config)[0] : null);
  if (!type) return interaction.reply({ content: "That ticket type is no longer available. Please use the newest ticket panel.", flags: MessageFlags.Ephemeral });
  const questions = type.questions || [];
  if (action === "open" && questions.length) {
    const inputs = questions.map((question, index) => row(new TextInputBuilder().setCustomId(`answer-${index}`).setLabel(`Question ${index + 1}`).setPlaceholder(question).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
    return interaction.showModal(new ModalBuilder().setCustomId(`ticket:answers:${type.id}`).setTitle(`${type.name} Ticket Questions`.slice(0, 45)).addComponents(...inputs));
  }
  const answers = action === "answers" ? questions.map((question, index) => ({ question, answer: interaction.fields.getTextInputValue(`answer-${index}`).trim() })) : [];
  const key = ticketKey(interaction), existing = settings.tickets[key];
  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    if (channel) return interaction.reply({ content: `You already have an open ticket: ${channel}`, flags: MessageFlags.Ephemeral });
    delete settings.tickets[key]; await settings.save();
  }
  const category = await interaction.guild.channels.fetch(config.categoryId).catch(() => null), pingRole = interaction.guild.roles.cache.get(type.pingRoleId || config.supportRoleId);
  if (!category || category.type !== ChannelType.GuildCategory || !pingRole) return interaction.reply({ content: "The ticket configuration is no longer valid. Please notify an administrator.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    config.counters ||= {}; const ticketNumber = config.counters[type.id] = (Number(config.counters[type.id]) || 0) + 1;
    const channelName = `${safeName(type.name).slice(0, 85)}-${ticketNumber}`;
    const channel = await interaction.guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, topic: `${type.name} ticket opened by ${interaction.user.tag} (${interaction.user.id})`, permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
      { id: pingRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
    ], reason: `Ticket opened by ${interaction.user.tag}` });
    const record = { channelId: channel.id, userId: interaction.user.id, typeId: type.id, typeName: type.name, pingRoleId: pingRole.id, number: ticketNumber, claimedBy: null, openedAt: new Date().toISOString() }; settings.tickets[key] = record; await settings.save();
    const opened = new EmbedBuilder().setColor(0x00e5ff).setTitle(`${type.name.toUpperCase()} TICKET OPENED`).setDescription("Describe anything else staff should know below.").addFields({ name: "Ticket Type", value: type.name, inline: true }, { name: "Ticket Number", value: `#${ticketNumber}`, inline: true }, ...answers.map(item => ({ name: item.question, value: item.answer || "No answer" }))).setFooter({ text: `Opened by ${interaction.user.tag}` }).setTimestamp();
    await channel.send({ content: `${interaction.user} ${pingRole}`, embeds: [opened], components: [ticketActions(record)], allowedMentions: { users: [interaction.user.id], roles: [pingRole.id] } });
    await interaction.editReply(`Your private ticket is ready: ${channel}`);
  } catch (error) {
    console.error("Could not create ticket:", error);
    await interaction.editReply("I could not create your ticket. Check my channel and role permissions, then try again.");
  }
}
