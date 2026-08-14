import "dotenv/config";
import { createServer } from "node:http";
import { Client, GatewayIntentBits, ActivityType, escapeMarkdown, PermissionFlagsBits, SlashCommandBuilder, Partials, MessageFlags } from "discord.js";
import { secretsMatch, validateChatPayload } from "./bridge-utils.js";
import { SettingsStore } from "./settings-store.js";
import { RadioService } from "./radio-service.js";

const required = ["DISCORD_TOKEN", "BRIDGE_SECRET"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
const settings = new SettingsStore(process.env.CONFIG_PATH || "/data/config.json");
const radio = new RadioService(client, process.env.RADIO_STREAM_URL || "https://stream.revma.ihrhls.com/zc185");
const mainGuildId = process.env.MAIN_GUILD_ID || null;
const staffGuildId = process.env.STAFF_GUILD_ID || null;
const outgoing = [];
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

function queueDiscordLine({ player, message }) {
  outgoing.push(`**${escapeMarkdown(player)}**: ${escapeMarkdown(message)}`);
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
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(discordChannel ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: Boolean(discordChannel) }));
    return;
  }
  if (request.method !== "POST" || !["/minecraft-chat", "/link/start", "/link/remove", "/rank-sync"].includes(request.url)) {
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
    if (body.length > 4096) request.destroy();
  });
  request.on("end", () => {
    try {
      const value = JSON.parse(body);
      if (request.url === "/minecraft-chat") {
        const payload = validateChatPayload(value);
        if (!payload) return response.writeHead(400).end();
        if (!discordChannel) return response.writeHead(503).end();
        queueDiscordLine(payload); return response.writeHead(202).end();
      }
      if (request.url === "/link/start") {
        if (!/^\d{6}$/.test(value.code) || typeof value.uuid !== "string" || typeof value.player !== "string") return response.writeHead(400).end();
        settings.pending[value.code] = { uuid: value.uuid, player: value.player, expires: Date.now() + 10 * 60_000 };
        settings.save().then(() => response.writeHead(202).end()).catch(() => response.writeHead(500).end()); return;
      }
      if (request.url === "/link/remove") {
        if (typeof value.uuid !== "string") return response.writeHead(400).end();
        const linked = settings.links[value.uuid]; delete settings.links[value.uuid];
        settings.save().then(() => { response.writeHead(linked ? 200 : 404, { "Content-Type": "application/json" }); response.end(JSON.stringify({ unlinked: Boolean(linked) })); }).catch(() => response.writeHead(500).end()); return;
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

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.guild) return;
  const code = message.content.trim();
  const pending = settings.pending[code];
  if (!pending || pending.expires < Date.now()) { if (pending) { delete settings.pending[code]; await settings.save(); } await message.reply("That link code is invalid or expired. Run /link in Minecraft again."); return; }
  for (const [uuid, discordId] of Object.entries(settings.links)) if (discordId === message.author.id) delete settings.links[uuid];
  settings.links[pending.uuid] = message.author.id; delete settings.pending[code]; await settings.save();
  await message.reply(`Linked your Discord account to Minecraft player **${pending.player}**.`);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => console.log(`HTTP bridge listening on port ${port}.`));
setInterval(() => void flushOutgoing(), 500);

client.once("clientReady", async () => {
  try {
    console.log("MPCS bot build: railway-radio-native-ffmpeg-v2");
    if (staffGuildId) await (await client.guilds.fetch(staffGuildId)).commands.set([setChatCommand.toJSON()]);
    if (mainGuildId) await (await client.guilds.fetch(mainGuildId)).commands.set([setRadioCommand.toJSON()]);
    if (!staffGuildId && !mainGuildId) await client.application.commands.set([setChatCommand.toJSON(), setRadioCommand.toJSON()]);
    else await client.application.commands.set([]);
    const savedChannelId = await settings.load();
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
  if (!interaction.isChatInputCommand() || !["setchat", "setradio"].includes(interaction.commandName)) return;
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need Manage Server permission to use this command.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.commandName === "setchat" && staffGuildId && interaction.guildId !== staffGuildId) { await interaction.reply({ content: "This command is only available in the staff server.", flags: MessageFlags.Ephemeral }); return; }
  if (interaction.commandName === "setradio" && mainGuildId && interaction.guildId !== mainGuildId) { await interaction.reply({ content: "This command is only available in the main server.", flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
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
