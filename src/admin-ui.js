import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

export const embedCommand = new SlashCommandBuilder().setName("embed").setDescription("Create and post a customized embed").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
export const sayCommand = new SlashCommandBuilder().setName("say").setDescription("Make the bot post a message").setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption(option => option.setName("message").setDescription("Message to post").setMaxLength(2000).setRequired(true))
  .addChannelOption(option => option.setName("channel").setDescription("Where to post it (defaults to this channel)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));
export const statsCommand = new SlashCommandBuilder().setName("serverstats").setDescription("View the MPCS server dashboard");

const drafts = new Map();
const key = interaction => `${interaction.guildId}:${interaction.user.id}`;
const blank = () => ({ title: "MPCS Announcement", description: "Use the buttons below to customize this embed.", color: 0x00e5ff, author: "", footer: "", image: "", thumbnail: "" });
const embed = draft => { const value = new EmbedBuilder().setColor(draft.color).setTitle(draft.title).setDescription(draft.description); if (draft.author) value.setAuthor({ name: draft.author }); if (draft.footer) value.setFooter({ text: draft.footer }); if (draft.image) value.setImage(draft.image); if (draft.thumbnail) value.setThumbnail(draft.thumbnail); return value; };
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`embed:${id}`).setLabel(label).setStyle(style);
const editor = draft => ({ embeds: [embed(draft)], components: [new ActionRowBuilder().addComponents(button("text", "Title & Description", ButtonStyle.Primary), button("style", "Color, Author & Footer", ButtonStyle.Primary)), new ActionRowBuilder().addComponents(button("media", "Image & Thumbnail"), button("reset", "Reset", ButtonStyle.Danger), button("post", "Post Embed", ButtonStyle.Success), button("cancel", "Cancel"))] });
const input = (id, label, value, style = TextInputStyle.Short, required = false, maxLength = 256) => new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength).setValue(value || "");
const modal = (id, title, inputs) => new ModalBuilder().setCustomId(`embed:${id}`).setTitle(title).addComponents(...inputs.map(component => new ActionRowBuilder().addComponents(component)));

export async function openEmbed(interaction) { const draft = blank(); drafts.set(key(interaction), draft); await interaction.reply({ ...editor(draft), flags: MessageFlags.Ephemeral }); }
export async function handleEmbed(interaction) {
  const id = interaction.customId.split(":")[1], draft = drafts.get(key(interaction));
  if (!draft) return interaction.reply({ content: "That embed editor expired. Run /embed again.", flags: MessageFlags.Ephemeral });
  if (id === "text") return interaction.showModal(modal("savetext", "Embed Text", [input("title", "Title", draft.title, TextInputStyle.Short, true), input("description", "Description", draft.description, TextInputStyle.Paragraph, true, 4000)]));
  if (id === "style") return interaction.showModal(modal("savestyle", "Embed Style", [input("color", "Hex color, e.g. #00E5FF", `#${draft.color.toString(16).padStart(6, "0")}`), input("author", "Author (optional)", draft.author), input("footer", "Footer (optional)", draft.footer, TextInputStyle.Short, false, 2048)]));
  if (id === "media") return interaction.showModal(modal("savemedia", "Embed Media", [input("image", "Image URL (optional)", draft.image, TextInputStyle.Short, false, 1000), input("thumbnail", "Thumbnail URL (optional)", draft.thumbnail, TextInputStyle.Short, false, 1000)]));
  if (id === "savetext") { draft.title = interaction.fields.getTextInputValue("title"); draft.description = interaction.fields.getTextInputValue("description"); return interaction.update(editor(draft)); }
  if (id === "savestyle") { const raw = interaction.fields.getTextInputValue("color").trim(); if (!/^#?[0-9a-f]{6}$/i.test(raw)) return interaction.reply({ content: "Color must be a six-digit hex color such as `#00E5FF`.", flags: MessageFlags.Ephemeral }); draft.color = Number.parseInt(raw.replace("#", ""), 16); draft.author = interaction.fields.getTextInputValue("author").trim(); draft.footer = interaction.fields.getTextInputValue("footer").trim(); return interaction.update(editor(draft)); }
  if (id === "savemedia") { const image = interaction.fields.getTextInputValue("image").trim(), thumbnail = interaction.fields.getTextInputValue("thumbnail").trim(); if ([image, thumbnail].some(url => url && !/^https?:\/\//i.test(url))) return interaction.reply({ content: "Image fields must contain an `https://` or `http://` URL.", flags: MessageFlags.Ephemeral }); draft.image = image; draft.thumbnail = thumbnail; return interaction.update(editor(draft)); }
  if (id === "reset") { const fresh = blank(); drafts.set(key(interaction), fresh); return interaction.update(editor(fresh)); }
  if (id === "cancel") { drafts.delete(key(interaction)); return interaction.update({ content: "Embed cancelled.", embeds: [], components: [] }); }
  if (id === "post") { if (!interaction.channel?.isSendable()) return interaction.reply({ content: "I cannot post in this channel.", flags: MessageFlags.Ephemeral }); await interaction.channel.send({ embeds: [embed(draft)] }); drafts.delete(key(interaction)); return interaction.update({ content: "Embed posted.", embeds: [], components: [] }); }
}

export async function say(interaction) {
  const channel = interaction.options.getChannel("channel") || interaction.channel;
  if (!channel?.isSendable() || channel.guildId !== interaction.guildId) return interaction.reply({ content: "I cannot post in that channel.", flags: MessageFlags.Ephemeral });
  if (!channel.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return interaction.reply({ content: "I need View Channel and Send Messages there.", flags: MessageFlags.Ephemeral });
  await channel.send({ content: interaction.options.getString("message", true), allowedMentions: { parse: [] } });
  await interaction.reply({ content: `Message posted in ${channel}.`, flags: MessageFlags.Ephemeral });
}

export async function serverStats(interaction, settings, client) {
  const players = settings.teamSnapshot.players || [], online = players.filter(player => player.online), teams = settings.teamSnapshot.teams || [], guild = interaction.guild;
  const linkedOnline = online.filter(player => settings.links[player.uuid]).length, teamMembers = new Set(teams.flatMap(team => team.members || [])).size;
  const dashboard = new EmbedBuilder().setTitle("MPCS SERVER DASHBOARD").setColor(0x00e5ff).setTimestamp()
    .addFields(
      { name: "Minecraft", value: `**${online.length}** online\n**${players.length}** known players\n**${linkedOnline}** linked online`, inline: true },
      { name: "Teams", value: `**${teams.length}** teams\n**${teamMembers}** assigned players\n**${Object.keys(settings.links).length}** linked accounts`, inline: true },
      { name: "Discord", value: `**${guild?.memberCount ?? 0}** members\n**${client.ws.ping}ms** gateway ping\n**${Math.floor(process.uptime() / 60)}m** bot uptime`, inline: true },
      { name: "Online Players", value: online.length ? online.slice(0, 30).map(player => `${settings.links[player.uuid] ? "🔗" : "⚪"} ${player.name}`).join("\n") : "Nobody is online." },
      { name: "Team Summary", value: teams.length ? teams.slice(0, 25).map(team => `**${team.name}** — ${team.members.length}/8`).join("\n") : "No teams created." }
    ).setFooter({ text: "Minecraft data refreshes approximately every 10 seconds" });
  await interaction.reply({ embeds: [dashboard], flags: MessageFlags.Ephemeral });
}
