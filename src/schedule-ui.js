import { randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder } from "discord.js";

export const scheduleCommand = new SlashCommandBuilder().setName("schedule").setDescription("Create and manage MPCS match schedules").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(option=>option.setName("ticket-category").setDescription("Category where new match tickets are created").addChannelTypes(ChannelType.GuildCategory)).addRoleOption(option=>option.setName("competitor-role").setDescription("Role pinged in every new match ticket"));
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
  const components = [row(new ButtonBuilder().setCustomId("schedule:create").setLabel("Create Match").setStyle(ButtonStyle.Success).setEmoji("➕"))];
  if (matches.length) components.unshift(select("schedule:view", "Select a scheduled match", matches.slice(0, 25).map(match => ({ label: `${teamName(settings, match.teamOne)} vs ${teamName(settings, match.teamTwo)}`.slice(0, 100), value: match.id, description: `${stages.find(stage => stage.id === match.stage)?.label || match.stage} • ${est(match.scheduledAt)}`.slice(0, 100) }))));
  return { embeds: [new EmbedBuilder().setTitle("MPCS SCHEDULE MANAGER").setDescription(`${notice}\n\n**ALL TIMES ARE EST (UTC−5).**`).setColor(0x00e5ff).addFields({ name: "Scheduled Matches", value: matches.length ? matches.slice(0, 15).map(match => `**${teamName(settings, match.teamOne)} vs ${teamName(settings, match.teamTwo)}**\n${stages.find(stage => stage.id === match.stage)?.label || match.stage} • ${formatText(match.bestOf)} • ${est(match.scheduledAt)}`).join("\n\n") : "No matches scheduled." })], components };
}

const safeChannelName=value=>String(value||"team").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,35)||"team";
const rosterDiscordIds=(settings,team)=>[...new Set((team.members||[]).map(uuid=>settings.links[uuid]).filter(Boolean))];
const rosterNames=(settings,team)=>{const players=new Map((settings.teamSnapshot.players||[]).map(player=>[player.uuid,player.name]));return(team.members||[]).map(uuid=>players.get(uuid)||uuid);};
async function createMatchTicket(interaction,settings,match){const config=settings.matchTicketConfig?.[interaction.guildId],category=config?await interaction.guild.channels.fetch(config.categoryId).catch(()=>null):null,role=config?interaction.guild.roles.cache.get(config.competitorRoleId):null;if(category?.type!==ChannelType.GuildCategory||!role)throw new Error("Configure the ticket category and Competitor role with `/schedule ticket-category:... competitor-role:...` first.");if(!role.mentionable&&!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.MentionEveryone))throw new Error("Make the Competitor role mentionable or give the bot Mention Everyone so the ticket can ping it.");const one=(settings.teamSnapshot.teams||[]).find(team=>team.id===match.teamOne),two=(settings.teamSnapshot.teams||[]).find(team=>team.id===match.teamTwo);if(!one||!two)throw new Error("One of the selected teams is no longer synchronized.");const missing=[...rosterNames(settings,one).filter((name,index)=>!settings.links[one.members[index]]),...rosterNames(settings,two).filter((name,index)=>!settings.links[two.members[index]])];if(missing.length)throw new Error(`Every roster member must link Discord before scheduling. Missing: ${missing.join(", ")}`);const discordIds=[...new Set([...rosterDiscordIds(settings,one),...rosterDiscordIds(settings,two)])],overwrites=[{id:interaction.guildId,deny:[PermissionFlagsBits.ViewChannel]},{id:interaction.client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]},...discordIds.map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}))],unix=Math.floor(new Date(match.scheduledAt).getTime()/1000),channel=await interaction.guild.channels.create({name:`match-${safeChannelName(one.name)}-vs-${safeChannelName(two.name)}`.slice(0,100),type:ChannelType.GuildText,parent:category.id,topic:`MPCS scheduled match ${match.id}: ${one.name} vs ${two.name}`,permissionOverwrites:overwrites,reason:`Scheduled MPCS match ${match.id}`});const roster=(team)=>rosterDiscordIds(settings,team).map(id=>`<@${id}>`).join("\n");try{await channel.send({content:`<@&${role.id}>`,embeds:[new EmbedBuilder().setColor(0x00e5ff).setTitle(`${one.name} VS ${two.name}`).setDescription(`## MATCH DEADLINE\n<t:${unix}:F>\n<t:${unix}:R>\n\nDiscord displays this date and time in **your own timezone**. The entire match must be completed before this deadline.`).addFields({name:one.name,value:roster(one)||"No linked players",inline:true},{name:two.name,value:roster(two)||"No linked players",inline:true},{name:"How to complete the match",value:"1. Every rostered player from both teams must be online in Minecraft.\n2. Either team leader runs `/match`.\n3. Open this scheduled matchup and click it to start.\n4. Complete every required game before the deadline above."},{name:"Results",value:"Results are submitted automatically by the Minecraft match system after the series finishes. Do not manually report or edit the result unless staff asks you to."},{name:"Important",value:"The match cannot begin unless **everyone on both team rosters is online**. Coordinate here early enough to finish the complete series before the displayed deadline."}).setFooter({text:`Match ID: ${match.id}`})],allowedMentions:{roles:[role.id],users:discordIds}});return channel;}catch(error){await channel.delete("Match ticket setup failed").catch(()=>null);throw error;}}

function chooseStage() { return { embeds: [new EmbedBuilder().setTitle("CREATE MATCH • STAGE").setDescription("Choose the tournament round.\n\n**The date and time will be entered in EST (UTC−5).**").setColor(0x00e5ff)], components: [select("schedule:stage", "Choose tournament stage", stages.map(stage => ({ label: stage.label, value: stage.id, description: `Best of ${stage.bestOf}` })))] }; }
function chooseTeam(settings, draft, side) {
  const teams = (settings.teamSnapshot.teams || []).filter(team => side === 1 || team.id !== draft.teamOne).slice(0, 25);
  return { embeds: [new EmbedBuilder().setTitle(`CREATE MATCH • TEAM ${side}`).setDescription(side === 1 ? "Choose the first team." : `Team 1: **${teamName(settings, draft.teamOne)}**\nChoose their opponent.`).setColor(0x00e5ff)], components: [select(`schedule:team${side}`, `Choose Team ${side}`, teams.map(team => ({ label: team.name || team.id, value: team.id, description: `${(team.members || []).length}/8 players` })))] };
}
function estToday() {
  const shifted = new Date(Date.now() - 5 * 3600000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}
function dateValue(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
function chooseDate(page = 0) {
  const pageSize = 14, maxPages = 7, start = estToday();
  const options = Array.from({ length: pageSize }, (_, index) => {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + page * pageSize + index);
    return { label: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date), value: dateValue(date) };
  });
  return { embeds: [new EmbedBuilder().setTitle("CREATE MATCH • DATE").setDescription(`Select the match date. Page ${page + 1}/${maxPages}.\n\n**All selections use EST (UTC−5).**`).setColor(0x00e5ff)], components: [select("schedule:date", "Choose a date", options), row(new ButtonBuilder().setCustomId(`schedule:datepage:${Math.max(0, page - 1)}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page === 0), new ButtonBuilder().setCustomId(`schedule:datepage:${Math.min(maxPages - 1, page + 1)}`).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(page === maxPages - 1))] };
}
function chooseHour(draft) {
  const options = Array.from({ length: 24 }, (_, hour) => hour).filter(hour => selectedEstDate({ ...draft, hour }, 45).getTime() > Date.now()).map(hour => ({ label: `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`, value: String(hour), description: `${String(hour).padStart(2, "0")}:00 EST` }));
  return { embeds: [new EmbedBuilder().setTitle("CREATE MATCH • TIME").setDescription(`Date: **${draft.date}**\nChoose the starting hour.\n\n**EST (UTC−5)**`).setColor(0x00e5ff)], components: [select("schedule:hour", "Choose an hour (EST)", options)] };
}
function chooseMinute(draft) {
  const displayHour = draft.hour % 12 || 12, suffix = draft.hour < 12 ? "AM" : "PM", minutes = [0, 15, 30, 45].filter(minute => selectedEstDate(draft, minute).getTime() > Date.now());
  return { embeds: [new EmbedBuilder().setTitle("CREATE MATCH • TIME").setDescription(`Date: **${draft.date}**\nHour: **${displayHour}:00 ${suffix} EST**\nChoose the minutes.`).setColor(0x00e5ff)], components: [select("schedule:minute", "Choose minutes", minutes.map(minute => ({ label: `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`, value: String(minute), description: "EST (UTC−5)" })))] };
}
function selectedEstDate(draft, minute) {
  const [year, month, day] = draft.date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, Number(draft.hour) + 5, Number(minute)));
}

export async function handleSchedule(interaction, settings) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server.", flags: MessageFlags.Ephemeral });
  const [, action, id] = interaction.customId.split(":"), draftKey = key(interaction); let draft = drafts.get(draftKey);
  if (action === "create") { const count=(settings.teamSnapshot.teams||[]).length;if(count<2)return interaction.reply({content:`The bot currently sees **${count} synchronized Minecraft team${count===1?'':'s'}**. Create at least two teams with \`/team\` in Minecraft, then wait about 10 seconds and run \`/schedule\` again.`,flags:MessageFlags.Ephemeral});drafts.set(draftKey, {}); return interaction.update(chooseStage()); }
  if (["stage", "team1", "team2", "datepage", "date", "hour", "minute"].includes(action) && !draft) return interaction.reply({ content: "That scheduling session expired. Run `/schedule` again.", flags: MessageFlags.Ephemeral });
  if (action === "stage") { draft.stage = interaction.values[0]; drafts.set(draftKey, draft); return interaction.update(chooseTeam(settings, draft, 1)); }
  if (action === "team1") { draft.teamOne = interaction.values[0]; drafts.set(draftKey, draft); return interaction.update(chooseTeam(settings, draft, 2)); }
  if (action === "team2") {
    draft.teamTwo = interaction.values[0]; drafts.set(draftKey, draft);
    return interaction.update(chooseDate());
  }
  if (action === "datepage") return interaction.update(chooseDate(Math.max(0, Math.min(6, Number(id) || 0))));
  if (action === "date") { draft.date = interaction.values[0]; drafts.set(draftKey, draft); return interaction.update(chooseHour(draft)); }
  if (action === "hour") { draft.hour = Number(interaction.values[0]); drafts.set(draftKey, draft); return interaction.update(chooseMinute(draft)); }
  if (action === "minute") {
    const date = selectedEstDate(draft, interaction.values[0]);
    const stage = stages.find(entry => entry.id === draft?.stage); if (!draft || !stage || !draft.teamOne || !draft.teamTwo || draft.teamOne === draft.teamTwo) return interaction.reply({ content: "That scheduling session is invalid. Run `/schedule` again.", flags: MessageFlags.Ephemeral });
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return interaction.reply({ content: "That time has just passed. Restart `/schedule` and select a later available time.", flags: MessageFlags.Ephemeral });
    const match={ id: `match_${randomUUID().slice(0, 8)}`, stage: stage.id, teamOne: draft.teamOne, teamTwo: draft.teamTwo, bestOf: stage.bestOf, bansPerTeam: bansPerTeam(stage.bestOf), scheduledAt: date.toISOString(), status: "CONFIRMED", createdBy: interaction.user.id, createdAt: new Date().toISOString(), revision: 1 };await interaction.deferUpdate();try{const channel=await createMatchTicket(interaction,settings,match);match.ticketChannelId=channel.id;settings.schedules.push(match);delete settings.teamDrafts[draftKey];drafts.delete(draftKey);await settings.save();return interaction.editReply(panel(settings,`Match created successfully. Private match ticket: <#${channel.id}>`));}catch(error){return interaction.editReply(panel(settings,`Match was not created: ${error.message}`));}
  }
  if (action === "view") {
    const match = settings.schedules.find(entry => entry.id === interaction.values[0]); if (!match) return interaction.update(panel(settings, "That match no longer exists."));
    return interaction.update({ embeds: [new EmbedBuilder().setTitle(`${teamName(settings, match.teamOne)} VS ${teamName(settings, match.teamTwo)}`).setDescription(`**${stages.find(stage => stage.id === match.stage)?.label || match.stage} • ${formatText(match.bestOf)}**\n\n${est(match.scheduledAt)}\n**ALL TIMES ARE EST (UTC−5).**\n\nStatus: ${match.status}`).setColor(0x00e5ff)], components: [row(new ButtonBuilder().setCustomId(`schedule:delete:${match.id}`).setLabel("Delete Match").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("schedule:back").setLabel("Back").setStyle(ButtonStyle.Secondary))] });
  }
  if (action === "delete") { const match=settings.schedules.find(entry=>entry.id===id);if(match?.ticketChannelId){const channel=await interaction.guild.channels.fetch(match.ticketChannelId).catch(()=>null);await channel?.delete(`Scheduled match ${id} deleted`).catch(()=>null);}settings.schedules = settings.schedules.filter(match => match.id !== id); await settings.save(); return interaction.update(panel(settings, "Match and its private ticket deleted.")); }
  if (action === "back") return interaction.update(panel(settings));
}
