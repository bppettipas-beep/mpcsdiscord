import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

const COLORS = [["Red", "#FF5555"], ["Gold", "#FFAA00"], ["Yellow", "#FFFF55"], ["Green", "#55FF55"], ["Dark Green", "#00AA00"], ["Aqua", "#55FFFF"], ["Blue", "#5555FF"], ["Dark Blue", "#0000AA"], ["Purple", "#AA00AA"], ["Pink", "#FF55FF"], ["White", "#FFFFFF"], ["Gray", "#AAAAAA"], ["Dark Gray", "#555555"], ["Black", "#111111"], ["Cyan", "#00AAAA"], ["Brown", "#AA5500"]];
export const teamsCommand = new SlashCommandBuilder().setName("editteams").setDescription("Open the Minecraft team manager").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const select = (id, placeholder, options, min = 1, max = 1) => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(min).setMaxValues(max).addOptions(options));
const linked = (s, uuid) => Boolean(s.links?.[uuid]);
const playerName = (s, uuid) => (s.teamSnapshot.players || []).find(player => player.uuid === uuid)?.name || uuid;
const assignedTeam = (s, uuid) => (s.teamSnapshot.teams || []).find(team => (team.members || []).includes(uuid))?.id || null;

export function panel(s, note = "Select a team or create one.") {
  const teams = s.teamSnapshot.teams || [], components = [];
  if (teams.length) components.push(select("teams:select", "Select a team", teams.slice(0, 25).map(team => ({ label: team.name, value: team.id, description: `${team.members.length}/8 members` }))));
  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("teams:create").setLabel("Create Team").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("teams:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary)));
  return { embeds: [new EmbedBuilder().setTitle("MPCS Team Manager").setDescription(note).setColor(0x00e5ff).addFields({ name: "Teams", value: teams.length ? teams.map(team => `**${team.name}** - ${team.members.length}/8`).join("\n") : "None" })], components };
}

function colors(stage) {
  return { embeds: [new EmbedBuilder().setTitle(`Choose ${stage === 1 ? "First" : "Second"} Prefix Color`).setColor(0x00e5ff)], components: [select(`teams:color${stage}`, `Choose color ${stage}`, COLORS.map(([label, value]) => ({ label, value })))] };
}

function memberPicker(s, draft, editing = false) {
  const candidates = (s.teamSnapshot.players || []).filter(player => (player.online || draft.members.includes(player.uuid)) && (!assignedTeam(s,player.uuid)||assignedTeam(s,player.uuid)===draft.id)).slice(0, 25);
  const options = candidates.map(player => ({ label: player.name, value: player.uuid, description: linked(s, player.uuid) ? (player.online ? "Linked - online" : "Linked - offline") : "Not linked - Discord sync will wait", default: draft.members.includes(player.uuid) }));
  const components = [];
  if (options.length) components.push(select(editing ? `teams:editmembers:${draft.id}` : "teams:draftmembers", "Select specific Minecraft players", options, 0, Math.min(8, options.length)));
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(editing ? `teams:save:${draft.id}` : "teams:finish").setLabel(editing ? "Save Members" : "Create Team").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("teams:back").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  ));
  return { embeds: [new EmbedBuilder().setTitle(`${editing ? "Edit" : "Members for"} ${draft.name}`).setDescription(`Selected: ${draft.members.length}/8\nDiscord linking is optional.`).setColor(0x00e5ff)], components };
}

function detail(s, id) {
  const team = (s.teamSnapshot.teams || []).find(entry => entry.id === id);
  if (!team) return panel(s);
  return { embeds: [new EmbedBuilder().setTitle(team.name).setDescription(`Members: ${team.members.map(uuid => playerName(s, uuid)).join(", ") || "None"}`).setColor(0x00e5ff)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`teams:edit:${id}`).setLabel("Add / Remove People").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`teams:delete:${id}`).setLabel("Delete").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("teams:back").setLabel("Back").setStyle(ButtonStyle.Secondary))] };
}

export async function handleTeams(i, s) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return i.reply({ content: "You need Manage Server.", flags: MessageFlags.Ephemeral });
  const [, op, id] = i.customId.split(":"), key = i.user.id;
  let draft = s.teamDrafts[key];
  if (op === "create") {
    const modal = new ModalBuilder().setCustomId("teams:name").setTitle("Create Minecraft Team").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Team name").setStyle(TextInputStyle.Short).setMaxLength(16).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("leader").setLabel("Team leader Minecraft IGN").setPlaceholder("Exact in-game name").setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(16).setRequired(true)));
    return i.showModal(modal);
  }
  if (op === "name") {
    const name = i.fields.getTextInputValue("name").trim(), leaderName=i.fields.getTextInputValue("leader").trim(), teamId = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!teamId) return i.reply({ content: "Enter a valid team name.", flags: MessageFlags.Ephemeral });
    if(!/^[A-Za-z0-9_]{3,16}$/.test(leaderName))return i.reply({content:"Enter a valid Minecraft IGN for the team leader.",flags:MessageFlags.Ephemeral});
    s.teamDrafts[key] = { id: teamId, name, leaderName, colors: [], members: [] };
    await s.save(); return i.reply({ ...colors(1), flags: MessageFlags.Ephemeral });
  }
  if (op === "color1") { draft.colors = [i.values[0]]; await s.save(); return i.update(colors(2)); }
  if (op === "color2") { draft.colors[1] = i.values[0]; await s.save(); return i.update(memberPicker(s, draft)); }
  if (op === "draftmembers" || op === "editmembers") {
    draft = op === "editmembers" ? { id, name: (s.teamSnapshot.teams || []).find(team => team.id === id)?.name || id, members: i.values.slice(0, 8) } : draft;
    draft.members = i.values.slice(0, 8); s.teamDrafts[key] = draft; await s.save(); return i.update(memberPicker(s, draft, op === "editmembers"));
  }
  if (op === "finish") {
    if (!draft?.leaderName) return i.reply({ content: "A team leader IGN is required.", flags: MessageFlags.Ephemeral });
    s.teamActions.push({ type: "create", ...draft }); delete s.teamDrafts[key]; await s.save(); return i.update(panel(s, "Team queued; Minecraft will apply it shortly."));
  }
  if (op === "select") return i.update(detail(s, i.values[0]));
  if (op === "edit") {
    const team = (s.teamSnapshot.teams || []).find(entry => entry.id === id); if (!team) return i.update(panel(s));
    draft = { id, name: team.name, members: [...team.members] }; s.teamDrafts[key] = draft; await s.save(); return i.update(memberPicker(s, draft, true));
  }
  if (op === "save") { draft = s.teamDrafts[key]; if (!draft || draft.id !== id) return i.update(panel(s, "Edit session expired.")); s.teamActions.push({ type: "members", id, members: draft.members }); delete s.teamDrafts[key]; await s.save(); return i.update(panel(s, "Member changes queued.")); }
  if (op === "back" || op === "refresh") return i.update(panel(s));
  if (op === "delete") { const removed=s.schedules.filter(match=>match.teamOne===id||match.teamTwo===id).length;s.schedules=s.schedules.filter(match=>match.teamOne!==id&&match.teamTwo!==id);s.teamActions.push({ type: "delete", id }); await s.save(); return i.update(panel(s, `Delete queued.${removed?` ${removed} scheduled match${removed===1?"":"es"} removed.`:""}`)); }
}
