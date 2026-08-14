import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

export const scheduleCommand = new SlashCommandBuilder().setName("schedule").setDescription("Create and manage MPCS match schedules").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
const drafts = new Map();
const stages = [
  { id: "QUALIFIERS", label: "Qualifiers", bestOf: 3 },
  { id: "CHAMPIONSHIP_ROUND_OF_16", label: "Championship Round of 16", bestOf: 3 },
  { id: "QUARTERFINALS", label: "Quarterfinals", bestOf: 5 },
  { id: "SEMIFINALS", label: "Semifinals", bestOf: 5 },
  { id: "GRAND_FINAL", label: "Grand Final", bestOf: 7 }
];
const bansPerTeam = bestOf => bestOf === 3 ? 2 : bestOf === 5 ? 1 : 0;
const formatText = bestOf => bestOf === 7 ? "BO7 • NO BANS" : `BO${bestOf} • ${bansPerTeam(bestOf)} BAN${bansPerTeam(bestOf) === 1 ? "" : "S"} PER TEAM`;
const key = interaction => `${interaction.guildId}:${interaction.user.id}`;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const select = (id, placeholder, options) => row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options));
const teamName = (settings, id) => (settings.teamSnapshot.teams || []).find(team => team.id === id)?.name || "TBD";
const est = value => new Intl.DateTimeFormat("en-US", { timeZone: "Etc/GMT+5", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value)) + " EST";

export function panel(settings, notice = "Create a matchup or manage an existing one.") {
  const matches = [...settings.schedules].sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const components = [row(new ButtonBuilder().setCustomId("schedule:create").setLabel("Create Match").setStyle(ButtonStyle.Success).setEmoji("➕").setDisabled((settings.teamSnapshot.teams || []).length < 2))];
  if (matches.length) components.unshift(select("schedule:view", "Select a scheduled match", matches.slice(0, 25).map(match => ({ label: `${teamName(settings, match.teamOne)} vs ${teamName(settings, match.teamTwo)}`.slice(0, 100), value: match.id, description: `${stages.find(stage => stage.id === match.stage)?.label || match.stage} • ${est(match.scheduledAt)}`.slice(0, 100) }))));
  return { embeds: [new EmbedBuilder().setTitle("MPCS SCHEDULE MANAGER").setDescription(`${notice}\n\n**ALL TIMES ARE EST (UTC−5).**`).setColor(0x00e5ff).addFields({ name: "Scheduled Matches", value: matches.length ? matches.slice(0, 15).map(match => `**${teamName(settings, match.teamOne)} vs ${teamName(settings, match.teamTwo)}**\n${stages.find(stage => stage.id === match.stage)?.label || match.stage} • ${formatText(match.bestOf)} • ${est(match.scheduledAt)}`).join("\n\n") : "No matches scheduled." })], components };
}

function chooseStage() { return { embeds: [new EmbedBuilder().setTitle("CREATE MATCH • STAGE").setDescription("Choose the tournament round.\n\n**The date and time will be entered in EST (UTC−5).**").setColor(0x00e5ff)], components: [select("schedule:stage", "Choose tournament stage", stages.map(stage => ({ label: stage.label, value: stage.id, description: `Best of ${stage.bestOf}` })))] }; }
function chooseTeam(settings, draft, side) {
  const teams = (settings.teamSnapshot.teams || []).filter(team => side === 1 || team.id !== draft.teamOne).slice(0, 25);
  return { embeds: [new EmbedBuilder().setTitle(`CREATE MATCH • TEAM ${side}`).setDescription(side === 1 ? "Choose the first team." : `Team 1: **${teamName(settings, draft.teamOne)}**\nChoose their opponent.`).setColor(0x00e5ff)], components: [select(`schedule:team${side}`, `Choose Team ${side}`, teams.map(team => ({ label: team.name || team.id, value: team.id, description: `${(team.members || []).length}/8 players` })))] };
}
function parseEst(raw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(raw.trim()); if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number); if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour + 5, minute));
  const check = new Date(date.getTime() - 5 * 3600000); if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) return null;
  return date;
}

export async function handleSchedule(interaction, settings) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server.", flags: MessageFlags.Ephemeral });
  const [, action, id] = interaction.customId.split(":"), draftKey = key(interaction); let draft = drafts.get(draftKey);
  if (action === "create") { drafts.set(draftKey, {}); return interaction.update(chooseStage()); }
  if (action === "stage") { draft.stage = interaction.values[0]; drafts.set(draftKey, draft); return interaction.update(chooseTeam(settings, draft, 1)); }
  if (action === "team1") { draft.teamOne = interaction.values[0]; drafts.set(draftKey, draft); return interaction.update(chooseTeam(settings, draft, 2)); }
  if (action === "team2") {
    draft.teamTwo = interaction.values[0]; drafts.set(draftKey, draft);
    const modal = new ModalBuilder().setCustomId("schedule:datetime").setTitle("Schedule Match in EST").addComponents(row(new TextInputBuilder().setCustomId("datetime").setLabel("DATE & TIME — YYYY-MM-DD HH:MM EST").setPlaceholder("2026-09-12 19:00").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(16)));
    return interaction.showModal(modal);
  }
  if (action === "datetime") {
    const date = parseEst(interaction.fields.getTextInputValue("datetime")); if (!date) return interaction.reply({ content: "Invalid time. Use exactly `YYYY-MM-DD HH:MM`, interpreted as **EST (UTC−5)**.", flags: MessageFlags.Ephemeral });
    const stage = stages.find(entry => entry.id === draft?.stage); if (!draft || !stage || !draft.teamOne || !draft.teamTwo || draft.teamOne === draft.teamTwo) return interaction.reply({ content: "That scheduling session is invalid. Run `/schedule` again.", flags: MessageFlags.Ephemeral });
    settings.schedules.push({ id: `match_${randomUUID().slice(0, 8)}`, stage: stage.id, teamOne: draft.teamOne, teamTwo: draft.teamTwo, bestOf: stage.bestOf, bansPerTeam: bansPerTeam(stage.bestOf), scheduledAt: date.toISOString(), status: "CONFIRMED", createdBy: interaction.user.id, createdAt: new Date().toISOString(), revision: 1 });
    delete settings.teamDrafts[draftKey]; drafts.delete(draftKey); await settings.save(); return interaction.reply({ ...panel(settings, "Match created successfully."), flags: MessageFlags.Ephemeral });
  }
  if (action === "view") {
    const match = settings.schedules.find(entry => entry.id === interaction.values[0]); if (!match) return interaction.update(panel(settings, "That match no longer exists."));
    return interaction.update({ embeds: [new EmbedBuilder().setTitle(`${teamName(settings, match.teamOne)} VS ${teamName(settings, match.teamTwo)}`).setDescription(`**${stages.find(stage => stage.id === match.stage)?.label || match.stage} • ${formatText(match.bestOf)}**\n\n${est(match.scheduledAt)}\n**ALL TIMES ARE EST (UTC−5).**\n\nStatus: ${match.status}`).setColor(0x00e5ff)], components: [row(new ButtonBuilder().setCustomId(`schedule:delete:${match.id}`).setLabel("Delete Match").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("schedule:back").setLabel("Back").setStyle(ButtonStyle.Secondary))] });
  }
  if (action === "delete") { settings.schedules = settings.schedules.filter(match => match.id !== id); await settings.save(); return interaction.update(panel(settings, "Match deleted.")); }
  if (action === "back") return interaction.update(panel(settings));
}
