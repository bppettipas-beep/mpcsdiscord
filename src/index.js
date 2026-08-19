import "dotenv/config";
import { createServer } from "node:http";
import { Client, GatewayIntentBits, Partials, ActivityType, escapeMarkdown, PermissionFlagsBits, SlashCommandBuilder, MessageFlags } from "discord.js";
import { secretsMatch, validateChatPayload } from "./bridge-utils.js";
import { SettingsStore } from "./settings-store.js";
import { RadioService } from "./radio-service.js";
import { teamsCommand, panel as teamsPanel, handleTeams } from "./teams-ui.js";
import { embedCommand, sayCommand, statsCommand, openEmbed, handleEmbed, say, serverStats } from "./admin-ui.js";
import { scheduleCommand, panel as schedulePanel, handleSchedule } from "./schedule-ui.js";
import { ticketCommand, ticketActionCommands, handleTicketCommand, handleTicketComponent, repairTicketNumbers, enforceTicketRestrictionsForMember } from "./ticket-ui.js";
import { automodCommand, AutoModService } from "./automod-service.js";
import { logsCommand, AuditLogService } from "./audit-log-service.js";
import { welcomeCommand, handleWelcomeCommand, welcomeMember } from "./welcome-service.js";
import { teamSignupCommand, signupPanel, handleTeamSignup } from "./team-signup-ui.js";
import { teamLeaderCommand, openTeamLeader, handleTeamLeader } from "./team-leader-ui.js";
import { assignJoinRole, handleRoleAllCommand, reconcileAutoRole, roleAllCommand } from "./role-service.js";
import { configureTeamLogs, publishTeamLogs, teamLogsCommand } from "./team-log-service.js";
import { handleSignupApprovalCommand, handleSignupReaction, handleSignupTeamsCommand, signupApprovalCommand, signupTeamsCommand } from "./signup-approval-service.js";

const required = ["DISCORD_TOKEN", "BRIDGE_SECRET"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent], partials:[Partials.Message,Partials.Channel,Partials.Reaction,Partials.User,Partials.GuildMember] });
const settings = new SettingsStore(process.env.CONFIG_PATH || "/data/config.json");
const radio = new RadioService(client, process.env.RADIO_STREAM_URL || "https://stream.revma.ihrhls.com/zc185");
const automod = new AutoModService(client, settings);
const mainGuildId = process.env.MAIN_GUILD_ID || null;
const staffGuildId = process.env.STAFF_GUILD_ID || null;
const auditLogs = new AuditLogService(client,settings,mainGuildId,staffGuildId);
const teamMemberRoleId = process.env.TEAM_MEMBER_ROLE_ID || "1537632587260887150";
const outgoing = [];
const liveMatches = new Map();
let discordChannel;
let flushing = false;

const setChatCommand = new SlashCommandBuilder()
  .setName("setchat")
  .setDescription("Set the channel that receives Minecraft chat")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) => option
    .setName("channel-id")
    .setDescription("The Discord channel ID")
    .setRequired(true));
const setRadioCommand = new SlashCommandBuilder().setName("setradio").setDescription("Play 102.7 KIIS-FM Los Angeles in a voice channel").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption((option) => option.setName("channel-id").setDescription("Voice channel ID, or off to disconnect").setRequired(true));
const radioVolumeCommand = new SlashCommandBuilder().setName("radiovolume").setDescription("Adjust the radio volume").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addIntegerOption(option=>option.setName("percent").setDescription("Volume from 0 to 100 percent").setMinValue(0).setMaxValue(100).setRequired(true));
const autoRoleCommand = new SlashCommandBuilder().setName("autorole").setDescription("Configure the role automatically given to new members").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command=>command.setName("set").setDescription("Choose the role given to new members").addRoleOption(option=>option.setName("role").setDescription("Role to give automatically").setRequired(true)))
  .addSubcommand(command=>command.setName("disable").setDescription("Disable automatic roles in this server"))
  .addSubcommand(command=>command.setName("status").setDescription("Show the configured automatic role"));
const teamNicknameCommand=new SlashCommandBuilder().setName("teamnickname").setDescription("Toggle your automatic team nickname").setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const linkCommand = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Minecraft account")
  .addStringOption((option) => option
    .setName("code")
    .setDescription("The six-digit code from /link in Minecraft")
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(6));

async function selectDiscordChannel(channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.isSendable() || !channel.guild) {
    throw new Error("That ID is not a server text channel the bot can send to.");
  }
  const permissions = channel.permissionsFor(client.user);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    throw new Error("The bot needs View Channel and Send Messages permission there.");
  }
  discordChannel = channel;
  return channel;
}

function queueDiscordLine({ player, message, type }) {
  const name = escapeMarkdown(player);
  outgoing.push(type === "join" ? `**${name}** [🟢 +]` : type === "leave" ? `**${name}** [🔴 −]` : `**${name}**: ${escapeMarkdown(message)}`);
  if (outgoing.length > 1000) outgoing.shift();
}

async function flushOutgoing() {
  if (flushing || !discordChannel || outgoing.length === 0) return;
  flushing = true;
  const lines = [];
  try {
    let length = 0;
    while (outgoing.length) {
      const next = outgoing[0];
      if (lines.length && length + next.length + 1 > 1900) break;
      outgoing.shift();
      lines.push(next);
      length += next.length + 1;
    }
    await discordChannel.send({ content: lines.join("\n"), allowedMentions: { parse: [] } });
  } catch (error) {
    outgoing.unshift(...lines);
    console.error("Failed to send Minecraft chat to Discord:", error);
  } finally {
    flushing = false;
  }
}

const server = createServer((request, response) => {
  if (request.method === "OPTIONS" && (request.url === "/api/schedule" || request.url === "/api/live" || request.url.startsWith("/api/live/"))) {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Accept, Cache-Control, Content-Type" }).end();
    return;
  }
  if (request.method === "GET" && request.url === "/api/live") {
    const now=Date.now();
    for(const [id,live] of liveMatches)if(now-live.updatedAt>15000)liveMatches.delete(id);
    const games=[...liveMatches.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
    response.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store, no-cache, must-revalidate","Pragma":"no-cache","Access-Control-Allow-Origin":"*"});response.end(JSON.stringify({games,updatedAt:new Date().toISOString()}));return;
  }
  if (request.method === "GET" && request.url === "/api/schedule") {
    const syncedTeams=settings.teamSnapshot.teams||[],syncedIds=new Set(syncedTeams.map(team=>team.id)),approvedPreviews=Object.values(settings.approvedSignupMessages||{}).filter(record=>record?.status==="approved"&&record.preview&&!syncedIds.has(record.preview.id)&&Date.now()-record.at<600000).map(record=>record.preview),sourceTeams=[...syncedTeams,...approvedPreviews];
    const teamNames = new Map(sourceTeams.map(team => [team.id, team.name]));
    const matches = settings.schedules.map(match => ({ ...match, teamOneName: match.teamOneName || teamNames.get(match.teamOne) || null, teamTwoName: match.teamTwoName || teamNames.get(match.teamTwo) || null, watchReady: match.status === "LIVE" && liveMatches.get(match.id)?.watchReady === true }));
    const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const playerNames = new Map((settings.teamSnapshot.players || []).map(player => [player.uuid,typeof player.name==="string"&&!uuidPattern.test(player.name)?player.name:null]));
    const teams = sourceTeams.map(team => ({ id: team.id, name: team.name || null, tag: team.tag || null, type: team.type || null, players: (team.members || []).map(member => {const uuid=typeof member==="string"?member:member?.uuid;const supplied=typeof member==="object"&&typeof member?.name==="string"&&!uuidPattern.test(member.name)?member.name:null;return{uuid,name:supplied||team.playerNames?.[uuid]||playerNames.get(uuid)||null};}) }));
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "Expires": "0", "Access-Control-Allow-Origin": "*" });
    response.end(JSON.stringify({ matches, teams, modes: ["Crystal", "Sword", "Ultra Hardcore", "Cart", "Spear Mace", "Pot", "Diamond SMP"], updatedAt: new Date().toISOString() }));
    return;
  }
  if (request.method === "GET" && request.url.startsWith("/api/live/")) {
    const id=decodeURIComponent(request.url.slice("/api/live/".length));const live=liveMatches.get(id);
    if(!live||Date.now()-live.updatedAt>15000){liveMatches.delete(id);response.writeHead(404,{"Access-Control-Allow-Origin":"*"}).end();return;}
    response.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"});response.end(JSON.stringify(live));return;
  }
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(discordChannel ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: Boolean(discordChannel), build: "team-signup-v2" }));
    return;
  }
  if (request.method !== "POST" || !["/minecraft-chat", "/link/start", "/link/remove", "/rank-sync", "/teams/sync", "/match/status", "/match/result", "/match/reset", "/match/live"].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  const authorization = request.headers.authorization ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secretsMatch(supplied, process.env.BRIDGE_SECRET)) {
    response.writeHead(401).end();
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 131072) request.destroy();
  });
  request.on("end", () => {
    try {
      const value = JSON.parse(body);
      if(request.url==="/match/live"){
        if(typeof value.matchId!=="string"||!["LIVE","ENDED"].includes(value.status)||!Array.isArray(value.players)){response.writeHead(400).end();return;}
        if(value.status==="ENDED"){liveMatches.delete(value.matchId);response.writeHead(204).end();return;}
        const previous=liveMatches.get(value.matchId),events=previous?.events||[];if(value.event){events.unshift(value.event);if(events.length>30)events.length=30;}
        liveMatches.set(value.matchId,{matchId:value.matchId,status:"LIVE",watchReady:value.watchReady===true,mode:typeof value.mode==="string"&&value.mode.trim()?value.mode.trim():"Unknown",round:Number(value.round)||1,scoreOne:Number(value.scoreOne)||0,scoreTwo:Number(value.scoreTwo)||0,players:value.players.slice(0,2),events,updatedAt:Date.now()});response.writeHead(202).end();return;
      }
      if (request.url === "/match/status" || request.url === "/match/result" || request.url === "/match/reset") {
        const match=settings.schedules.find(entry=>entry.id===value.matchId);if(!match){response.writeHead(404).end();return;}
        if(request.url==="/match/reset"){
          delete match.scoreOne;delete match.scoreTwo;delete match.winnerTeam;delete match.completedAt;delete match.startedAt;match.status="CONFIRMED";match.revision=(match.revision||0)+1;
        }else if(request.url==="/match/status"){
          if(!["LIVE","CONFIRMED"].includes(value.status)){response.writeHead(400).end();return;}
          match.status=value.status;match.startedAt=value.status==="LIVE"?new Date().toISOString():null;match.revision=(match.revision||0)+1;
        }else{
          const one=Number(value.scoreOne),two=Number(value.scoreTwo),winner=String(value.winnerTeam||"");
          if(!Number.isInteger(one)||!Number.isInteger(two)||one<0||two<0||one===two||![match.teamOne,match.teamTwo].includes(winner)){response.writeHead(400).end();return;}
          match.scoreOne=one;match.scoreTwo=two;match.winnerTeam=winner;match.status="COMPLETED";match.completedAt=new Date().toISOString();match.revision=(match.revision||0)+1;liveMatches.delete(match.id);
        }
        void settings.save().then(()=>{response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify(match));}).catch(()=>response.writeHead(500).end());return;
      }
      if (request.url === "/minecraft-chat") {
        const payload = validateChatPayload(value);
        if (!payload) return response.writeHead(400).end();
        if (!discordChannel) return response.writeHead(503).end();
        queueDiscordLine(payload); return response.writeHead(202).end();
      }
      if (request.url === "/link/start") {
        if (!/^\d{6}$/.test(value.code) || typeof value.uuid !== "string" || typeof value.player !== "string") return response.writeHead(400).end();
        if (settings.links[value.uuid]) return response.writeHead(409).end();
        settings.pending[value.code] = { uuid: value.uuid, player: value.player, expires: Date.now() + 10 * 60_000 };
        settings.save().then(() => response.writeHead(202).end()).catch(() => response.writeHead(500).end()); return;
      }
      if (request.url === "/link/remove") {
        if (typeof value.uuid !== "string") return response.writeHead(400).end();
        const linked = settings.links[value.uuid];
        if (!linked) { response.writeHead(404, { "Content-Type": "application/json" }); response.end(JSON.stringify({ unlinked: false })); return; }
        delete settings.links[value.uuid];
        void settings.save().then(() => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ unlinked: true }));
          void removeTeamDiscordState(value.uuid, linked).catch(error => console.error("Post-unlink Discord cleanup failed:", error));
        }).catch(error => {
          settings.links[value.uuid] = linked;
          console.error("Could not persist account unlink:", error);
          if (!response.headersSent) response.writeHead(500).end();
        });
        return;
      }
      if (request.url === "/teams/sync") {
        settings.teamSnapshot={teams:Array.isArray(value.teams)?value.teams:[],players:Array.isArray(value.players)?value.players:[]};const validTeams=new Set(settings.teamSnapshot.teams.map(team=>team.id));settings.teamLeaderInvites=settings.teamLeaderInvites.filter(invite=>validTeams.has(invite.teamId)&&(!invite.accepted||!settings.teamSnapshot.teams.find(team=>team.id===invite.teamId)?.members?.includes(invite.profile?.uuid)));const removedMatches=settings.schedules.filter(match=>!validTeams.has(match.teamOne)||!validTeams.has(match.teamTwo));settings.schedules=settings.schedules.filter(match=>validTeams.has(match.teamOne)&&validTeams.has(match.teamTwo));removedMatches.forEach(match=>liveMatches.delete(match.id));const actions=settings.teamActions.splice(0,100);
        void reconcileTeamMembers().then(()=>publishTeamLogs(client,settings).catch(error=>console.error("Team roster log failed:",error))).then(()=>settings.save()).then(()=>{response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({actions,linkedUuids:Object.keys(settings.links)}));}).catch(error=>{console.error("Team Discord sync failed:",error);response.writeHead(500).end();});return;
      }
      void handleRankSync(value).then((result) => {
        response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(result));
      }).catch((error) => { console.error("Rank sync failed:", error); response.writeHead(500).end(); });
    } catch {
      response.writeHead(400).end();
    }
  });
});

async function handleRankSync(value) {
  const guild = mainGuildId ? await client.guilds.fetch(mainGuildId) : discordChannel?.guild;
  if (!guild || !Array.isArray(value.players) || !Array.isArray(value.mappings)) return { updates: [] };
  const direction = String(value.direction || "BOTH").toUpperCase();
  const mappings = value.mappings.filter((m) => m.rank && /^\d{17,20}$/.test(m.roleId)).sort((a,b) => Number(b.weight)-Number(a.weight));
  const updates = [];
  for (const player of value.players) {
    const discordId = settings.links[player.uuid]; if (!discordId) continue;
    let member; try { member = await guild.members.fetch(discordId); } catch { continue; }
    const discordMapping = mappings.find((m) => member.roles.cache.has(m.roleId));
    if ((direction === "DISCORD_TO_MINECRAFT" || direction === "BOTH") && discordMapping) {
      if (discordMapping.rank !== player.rank) updates.push({ uuid: player.uuid, rank: discordMapping.rank });
    } else if (direction === "MINECRAFT_TO_DISCORD" || direction === "BOTH") {
      const target = mappings.find((m) => m.rank === player.rank);
      for (const mapping of mappings) if (mapping.roleId !== target?.roleId && member.roles.cache.has(mapping.roleId)) await member.roles.remove(mapping.roleId);
      if (target && !member.roles.cache.has(target.roleId)) await member.roles.add(target.roleId);
    }
  }
  return { updates };
}

async function removeTeamDiscordState(uuid, discordId) {
  const guild = mainGuildId ? await client.guilds.fetch(mainGuildId) : null;
  if (!guild) return;
  let member; try { member = await guild.members.fetch(discordId); } catch { return; }
  if (member.roles.cache.has(teamMemberRoleId)) await member.roles.remove(teamMemberRoleId, "MPCS team membership ended");
  if (uuid in settings.originalNicknames) await member.setNickname(settings.originalNicknames[uuid], "MPCS team membership ended");
  delete settings.originalNicknames[uuid];
}

async function reconcileTeamMembers() {
  const guild = mainGuildId ? await client.guilds.fetch(mainGuildId) : null; if (!guild) return;
  const assigned = new Map(); for (const team of settings.teamSnapshot.teams || []) for (const uuid of team.members || []) assigned.set(uuid, team);
  for (const [uuid, discordId] of Object.entries(settings.links)) {
    let member; try { member = await guild.members.fetch(discordId); } catch { continue; }
    const team = assigned.get(uuid);
    try {
      if (team) {
        if (!(uuid in settings.originalNicknames)) settings.originalNicknames[uuid] = member.nickname ?? null;
        if (!member.roles.cache.has(teamMemberRoleId)) await member.roles.add(teamMemberRoleId, "MPCS team membership");
        if(!settings.teamNicknameOptOut[discordId]){const discordName=member.user.globalName||member.user.username,visibleName=discordName.slice(0,28),teamPart=team.name.toUpperCase().slice(0,Math.max(1,32-visibleName.length-3)),nickname=`${teamPart} | ${visibleName}`;if(member.nickname!==nickname)await member.setNickname(nickname,"MPCS team membership");}
      } else if (uuid in settings.originalNicknames) await removeTeamDiscordState(uuid, discordId);
    } catch (error) { console.error(`Could not synchronize team role/nickname for ${uuid}:`, error); }
  }
}

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => console.log(`HTTP bridge listening on port ${port}.`));
setInterval(() => void flushOutgoing(), 500);

client.once("clientReady", async () => {
  try {
    console.log("MPCS bot build: railway-radio-native-ffmpeg-v2");
    let savedChannelId;
    try {
      savedChannelId = await settings.load();
    } catch (error) {
      console.error(`FATAL: ${error.message}`);
      console.error("The bot will stop without registering handlers so existing ticket configuration cannot be overwritten.");
      await client.destroy().catch(() => {});
      process.exitCode = 1;
      return;
    }
    if (staffGuildId) await (await client.guilds.fetch(staffGuildId)).commands.set([setChatCommand.toJSON()]);
    const publicCommands=[linkCommand.toJSON(),embedCommand.toJSON(),sayCommand.toJSON(),statsCommand.toJSON(),scheduleCommand.toJSON(),autoRoleCommand.toJSON(),roleAllCommand.toJSON(),welcomeCommand.toJSON()];
    if (mainGuildId) await (await client.guilds.fetch(mainGuildId)).commands.set([setRadioCommand.toJSON(),radioVolumeCommand.toJSON(),teamsCommand.toJSON(),teamSignupCommand.toJSON(),signupApprovalCommand.toJSON(),teamLeaderCommand.toJSON(),teamNicknameCommand.toJSON(),ticketCommand.toJSON(),...ticketActionCommands.map(command=>command.toJSON()),automodCommand.toJSON(),...publicCommands]);
    if (staffGuildId) await (await client.guilds.fetch(staffGuildId)).commands.set([setChatCommand.toJSON(),teamLogsCommand.toJSON(),signupTeamsCommand.toJSON(),ticketCommand.toJSON(),automodCommand.toJSON(),logsCommand.toJSON(),...publicCommands]);
    if (!staffGuildId && !mainGuildId) await client.application.commands.set([setChatCommand.toJSON(),setRadioCommand.toJSON(),radioVolumeCommand.toJSON(),teamsCommand.toJSON(),teamSignupCommand.toJSON(),signupApprovalCommand.toJSON(),signupTeamsCommand.toJSON(),teamLeaderCommand.toJSON(),teamNicknameCommand.toJSON(),teamLogsCommand.toJSON(),ticketCommand.toJSON(),...ticketActionCommands.map(command=>command.toJSON()),automodCommand.toJSON(),logsCommand.toJSON(),...publicCommands]);
    else await client.application.commands.set([]);
    radio.setVolume(settings.radioVolume);
    await repairTicketNumbers(client,settings);
    const reconcileConfiguredAutoRoles=async()=>{for(const[guildId,roleId]of Object.entries(settings.autoRoles)){const guild=await client.guilds.fetch(guildId).catch(()=>null);if(guild)void reconcileAutoRole(guild,roleId).then(result=>console.log(`Autorole reconciliation in ${guild.name}: ${result.added} added, ${result.alreadyHad} already assigned, ${result.failed} failed.`)).catch(error=>console.error(`Autorole reconciliation failed in ${guild.name}:`,error.message));}};
    await reconcileConfiguredAutoRoles();
    const autoRoleRepairTimer=setInterval(()=>void reconcileConfiguredAutoRoles(),300_000);autoRoleRepairTimer.unref();
    for(const[guildId,config]of Object.entries(settings.ticketConfig))if(guildId!=="_transcriptLogChannelId"&&(config.restrictedRoleIds||[]).length){const guild=await client.guilds.fetch(guildId).catch(()=>null),members=guild?await guild.members.fetch().catch(()=>null):null;if(members)for(const member of members.values())if(config.restrictedRoleIds.some(roleId=>member.roles.cache.has(roleId)))await enforceTicketRestrictionsForMember(member,settings);}
    const initialChannelId = savedChannelId || process.env.DISCORD_CHANNEL_ID;
    if (initialChannelId) await selectDiscordChannel(initialChannelId);
    if (settings.radioChannelId) { const voice = await client.channels.fetch(settings.radioChannelId); if (voice?.isVoiceBased()) await radio.connect(voice); }
    client.user.setPresence({
      activities: [{ name: "MPCS", state: "Watching over MPCS", type: ActivityType.Custom }],
      status: "online"
    });
    console.log(`Connected as ${client.user.tag}.`);
    if (discordChannel) console.log(`Forwarding chat to #${discordChannel.name}.`);
    else console.log("No chat channel selected yet. Use /setchat in Discord.");
  } catch (error) {
    console.error("Discord startup configuration warning:", error.message);
  }
});

client.on("interactionCreate", async (interaction) => {
  if(interaction.isChatInputCommand()&&interaction.commandName==="signupteams"){if(staffGuildId&&interaction.guildId!==staffGuildId)return void interaction.reply({content:"This command is only available in the staff server.",flags:MessageFlags.Ephemeral});return void await handleSignupTeamsCommand(interaction,settings);}
  if(interaction.isChatInputCommand()&&interaction.commandName==="signupapproval"){if(mainGuildId&&interaction.guildId!==mainGuildId)return void interaction.reply({content:"This command is only available in the main server.",flags:MessageFlags.Ephemeral});return void await handleSignupApprovalCommand(interaction,settings);}
  if(interaction.isChatInputCommand()&&["add","close","closerequest"].includes(interaction.commandName)){if(mainGuildId&&interaction.guildId!==mainGuildId)return void interaction.reply({content:"Ticket actions are only available in the main server.",flags:MessageFlags.Ephemeral});return void await handleTicketCommand(interaction,settings);}
  if(interaction.isChatInputCommand()&&interaction.commandName==="welcome")return void await handleWelcomeCommand(interaction,settings);
  if(interaction.isChatInputCommand()&&interaction.commandName==="roleall")return void await handleRoleAllCommand(interaction);
  if(interaction.isChatInputCommand()&&interaction.commandName==="autorole"){
    if(!interaction.inGuild()||!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return void await interaction.reply({content:"You need Manage Server permission.",flags:MessageFlags.Ephemeral});
    const action=interaction.options.getSubcommand();
    if(action==="status"){const roleId=settings.autoRoles[interaction.guildId];return void await interaction.reply({content:roleId?`New members automatically receive <@&${roleId}>.`:"Automatic roles are disabled in this server.",flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});}
    if(action==="disable"){delete settings.autoRoles[interaction.guildId];await settings.save();return void await interaction.reply({content:"Automatic roles are now disabled in this server.",flags:MessageFlags.Ephemeral});}
    const role=interaction.options.getRole("role",true),me=interaction.guild.members.me;
    if(role.id===interaction.guildId||role.managed)return void await interaction.reply({content:"Choose a normal server role, not `@everyone` or an integration-managed role.",flags:MessageFlags.Ephemeral});
    if(!me?.permissions.has(PermissionFlagsBits.ManageRoles)||role.position>=me.roles.highest.position)return void await interaction.reply({content:"I cannot give that role. Enable **Manage Roles** and move my bot role above the selected role.",flags:MessageFlags.Ephemeral});
    settings.autoRoles[interaction.guildId]=role.id;await settings.save();return void await interaction.reply({content:`New members will now automatically receive ${role}.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  }
  if(interaction.isChatInputCommand()&&interaction.commandName==="logs")return void await auditLogs.command(interaction);
  if(interaction.isChatInputCommand()&&interaction.commandName==="teamlogs"){if(staffGuildId&&interaction.guildId!==staffGuildId)return void interaction.reply({content:"Team logs can only be configured in the staff server.",flags:MessageFlags.Ephemeral});return void await configureTeamLogs(interaction,settings,client);}
  if(interaction.isChatInputCommand()&&interaction.commandName==="automod")return void await automod.command(interaction);
  if(interaction.isChatInputCommand()&&interaction.commandName==="ticket"){const logs=interaction.options.getSubcommand()==="logs";if(logs&&staffGuildId&&interaction.guildId!==staffGuildId)return void interaction.reply({content:"Ticket transcript logs must be configured in the staff server.",flags:MessageFlags.Ephemeral});if(!logs&&mainGuildId&&interaction.guildId!==mainGuildId)return void interaction.reply({content:"Tickets are only available in the main server.",flags:MessageFlags.Ephemeral});return void await handleTicketCommand(interaction,settings);}
  if(interaction.isChatInputCommand()&&interaction.commandName==="teamnickname"){const linked=Object.entries(settings.links).find(([,discordId])=>discordId===interaction.user.id);if(!linked)return void interaction.reply({content:"Your Discord account must be linked to Minecraft first.",flags:MessageFlags.Ephemeral});const[uuid]=linked,member=await interaction.guild.members.fetch(interaction.user.id);if(settings.teamNicknameOptOut[interaction.user.id]){delete settings.teamNicknameOptOut[interaction.user.id];await reconcileTeamMembers();await settings.save();return void interaction.reply({content:"Your automatic team nickname is now enabled.",flags:MessageFlags.Ephemeral});}settings.teamNicknameOptOut[interaction.user.id]=true;const original=settings.originalNicknames[uuid]??null;await member.setNickname(original,"Administrator disabled automatic MPCS team nickname").catch(()=>{});await settings.save();return void interaction.reply({content:"Your automatic team nickname is now disabled. Your team role and membership were kept.",flags:MessageFlags.Ephemeral});}
  if((interaction.isButton()||interaction.isStringSelectMenu()||interaction.isChannelSelectMenu()||interaction.isRoleSelectMenu()||interaction.isModalSubmit())&&interaction.customId.startsWith("ticket:")){await handleTicketComponent(interaction,settings);return;}
  if(interaction.isChatInputCommand()&&interaction.commandName==="link"){
    const code=interaction.options.getString("code",true).trim();
    const pending=settings.pending[code];
    if(!/^\d{6}$/.test(code)||!pending||pending.expires<Date.now()){
      if(pending){delete settings.pending[code];await settings.save();}
      await interaction.reply({content:"That link code is invalid or expired. Run `/link` in Minecraft again.",flags:MessageFlags.Ephemeral});return;
    }
    for(const [uuid,discordId] of Object.entries(settings.links))if(discordId===interaction.user.id)delete settings.links[uuid];
    settings.links[pending.uuid]=interaction.user.id;delete settings.pending[code];await settings.save();
    await interaction.reply({content:`Linked your Discord account to Minecraft player **${pending.player}**.`,flags:MessageFlags.Ephemeral});return;
  }
  if(interaction.isChatInputCommand()&&interaction.commandName==="schedule"){const category=interaction.options.getChannel("ticket-category"),role=interaction.options.getRole("competitor-role");if(category||role){const current=settings.matchTicketConfig[interaction.guildId]||{};settings.matchTicketConfig[interaction.guildId]={categoryId:category?.id||current.categoryId,competitorRoleId:role?.id||current.competitorRoleId};await settings.save();return void await interaction.reply({...schedulePanel(settings,"Match ticket configuration saved."),flags:MessageFlags.Ephemeral});}return void await interaction.reply({...schedulePanel(settings),flags:MessageFlags.Ephemeral});}
  if((interaction.isButton()||interaction.isStringSelectMenu()||interaction.isModalSubmit())&&interaction.customId.startsWith("schedule:")){await handleSchedule(interaction,settings);return;}
  if(interaction.isChatInputCommand()&&interaction.commandName==="embed")return void await openEmbed(interaction);
  if(interaction.isChatInputCommand()&&interaction.commandName==="say")return void await say(interaction);
  if(interaction.isChatInputCommand()&&interaction.commandName==="serverstats")return void await serverStats(interaction,settings,client);
  if((interaction.isButton()||interaction.isModalSubmit())&&interaction.customId.startsWith("embed:")){await handleEmbed(interaction);return;}
  if(interaction.isChatInputCommand()&&interaction.commandName==="teams"){if(mainGuildId&&interaction.guildId!==mainGuildId)return void interaction.reply({content:"This command is only available in the main server.",flags:MessageFlags.Ephemeral});return void interaction.reply({...teamsPanel(settings),flags:MessageFlags.Ephemeral});}
  if((interaction.isButton()||interaction.isStringSelectMenu()||interaction.isUserSelectMenu()||interaction.isModalSubmit())&&interaction.customId.startsWith("teams:")){await handleTeams(interaction,settings);return;}
  if(interaction.isChatInputCommand()&&interaction.commandName==="teamsignup"){if(mainGuildId&&interaction.guildId!==mainGuildId)return void interaction.reply({content:"This command is only available in the main server.",flags:MessageFlags.Ephemeral});return void interaction.reply(signupPanel());}
  if((interaction.isButton()||interaction.isStringSelectMenu()||interaction.isUserSelectMenu()||interaction.isModalSubmit())&&interaction.customId.startsWith("signup:")){await handleTeamSignup(interaction,settings);return;}
  if(interaction.isChatInputCommand()&&interaction.commandName==="teamleader"){if(mainGuildId&&interaction.guildId!==mainGuildId)return void interaction.reply({content:"This command is only available in the main server.",flags:MessageFlags.Ephemeral});return void await openTeamLeader(interaction,settings);}
  if((interaction.isButton()||interaction.isStringSelectMenu()||interaction.isUserSelectMenu()||interaction.isModalSubmit())&&interaction.customId.startsWith("leader:")){await handleTeamLeader(interaction,settings);return;}
  if (!interaction.isChatInputCommand() || !["setchat", "setradio", "radiovolume"].includes(interaction.commandName)) return;
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need Manage Server permission to use this command.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.commandName === "setchat" && staffGuildId && interaction.guildId !== staffGuildId) { await interaction.reply({ content: "This command is only available in the staff server.", flags: MessageFlags.Ephemeral }); return; }
  if ((interaction.commandName === "setradio" || interaction.commandName === "radiovolume") && mainGuildId && interaction.guildId !== mainGuildId) { await interaction.reply({ content: "This command is only available in the main server.", flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (interaction.commandName === "radiovolume") { const percent=interaction.options.getInteger("percent",true); settings.radioVolume=percent; radio.setVolume(percent); await settings.save(); await interaction.editReply(`Radio volume set to **${percent}%**.`); return; }
    const raw = interaction.options.getString("channel-id", true).trim();
    if (interaction.commandName === "setradio") {
      if (raw.toLowerCase() === "off") { radio.stop(); settings.radioChannelId=null; await settings.save(); await interaction.editReply("Radio disconnected."); return; }
      const voiceId=raw.replace(/^<#(\d+)>$/,"$1"); if(!/^\d{17,20}$/.test(voiceId))throw new Error("Enter a valid voice channel ID.");
      const voice=await client.channels.fetch(voiceId);if(!voice?.isVoiceBased()||voice.guildId!==interaction.guildId)throw new Error("That is not a voice channel in this server.");
      if(!voice.permissionsFor(client.user)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]))throw new Error("The bot needs View Channel, Connect, and Speak there.");
      await radio.connect(voice);settings.radioChannelId=voice.id;await settings.save();await interaction.editReply(`Now playing **102.7 KIIS-FM Los Angeles** in <#${voice.id}>.`);return;
    }
    const channelId = raw.replace(/^<#(\d+)>$/, "$1");
    if (!/^\d{17,20}$/.test(channelId)) throw new Error("Enter a valid Discord channel ID.");
    const channel = await selectDiscordChannel(channelId);
    if (channel.guildId !== interaction.guildId) throw new Error("The channel must be in this Discord server.");
    await settings.saveChannel(channel.id);
    await interaction.editReply(`Minecraft chat will now be sent to <#${channel.id}>.`);
  } catch (error) {
    const feature = interaction.commandName === "setradio" ? "radio channel" : "chat channel";
    await interaction.editReply(`Could not set the ${feature}: ${error.message}`);
  }
});

client.on("messageCreate", message => void automod.message(message).catch(error => console.error("AutoMod message handling failed:", error)));
client.on("messageReactionAdd",(reaction,user)=>void handleSignupReaction(reaction,user,settings).catch(error=>console.error("Team signup approval failed:",error)));
client.on("messageDelete",message=>void auditLogs.messageDelete(message).catch(error=>console.error("Message delete logging failed:",error)));
client.on("messageUpdate",(before,after)=>void auditLogs.messageUpdate(before,after).catch(error=>console.error("Message edit logging failed:",error)));
client.on("guildMemberAdd",member=>{void auditLogs.memberAdd(member).catch(error=>console.error("Member join logging failed:",error));void member.guild.members.fetch(member.id).then(full=>welcomeMember(full,settings)).catch(error=>console.error(`Could not welcome ${member.user.tag}:`,error.message));const roleId=settings.autoRoles[member.guild.id];if(roleId)void assignJoinRole(member,roleId).catch(error=>console.error(`Could not give or verify automatic role ${roleId} for ${member.user.tag}:`,error.message));});
client.on("guildMemberRemove",member=>void auditLogs.memberRemove(member).catch(error=>console.error("Member leave logging failed:",error)));
client.on("guildMemberUpdate",(before,after)=>{void auditLogs.memberUpdate(before,after).catch(error=>console.error("Member update logging failed:",error));void enforceTicketRestrictionsForMember(after,settings).catch(error=>console.error("Ticket restriction sync failed:",error));});
client.on("userUpdate",(before,after)=>void auditLogs.userUpdate(before,after).catch(error=>console.error("User update logging failed:",error)));
client.on("guildBanAdd",ban=>void auditLogs.banAdd(ban).catch(error=>console.error("Ban logging failed:",error)));
client.on("guildBanRemove",ban=>void auditLogs.banRemove(ban).catch(error=>console.error("Unban logging failed:",error)));
client.on("voiceStateUpdate",(before,after)=>void auditLogs.voiceUpdate(before,after).catch(error=>console.error("Voice moderation logging failed:",error)));

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close();
  radio.stop();
  await flushOutgoing();
  client.destroy();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
client.login(process.env.DISCORD_TOKEN).catch((error) => { console.error("Discord login failed:", error); process.exit(1); });
