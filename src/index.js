import "dotenv/config";
import { createServer } from "node:http";
import { Client, GatewayIntentBits, ActivityType, escapeMarkdown, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { secretsMatch, validateChatPayload } from "./bridge-utils.js";
import { SettingsStore } from "./settings-store.js";

const required = ["DISCORD_TOKEN", "BRIDGE_SECRET"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const settings = new SettingsStore(process.env.CONFIG_PATH || "/data/config.json");
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
  if (request.method !== "POST" || request.url !== "/minecraft-chat") {
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
      const payload = validateChatPayload(JSON.parse(body));
      if (!payload) return response.writeHead(400).end();
      if (!discordChannel) return response.writeHead(503).end();
      queueDiscordLine(payload);
      response.writeHead(202).end();
    } catch {
      response.writeHead(400).end();
    }
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => console.log(`HTTP bridge listening on port ${port}.`));
setInterval(() => void flushOutgoing(), 500);

client.once("ready", async () => {
  try {
    await client.application.commands.set([setChatCommand.toJSON()]);
    const savedChannelId = await settings.load();
    const initialChannelId = savedChannelId || process.env.DISCORD_CHANNEL_ID;
    if (initialChannelId) await selectDiscordChannel(initialChannelId);
    client.user.setActivity("over MPCS", { type: ActivityType.Watching });
    console.log(`Connected as ${client.user.tag}.`);
    if (discordChannel) console.log(`Forwarding chat to #${discordChannel.name}.`);
    else console.log("No chat channel selected yet. Use /setchat in Discord.");
  } catch (error) {
    console.error("Discord startup configuration warning:", error.message);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "setchat") return;
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need Manage Server permission to use this command.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const raw = interaction.options.getString("channel-id", true).trim();
    const channelId = raw.replace(/^<#(\d+)>$/, "$1");
    if (!/^\d{17,20}$/.test(channelId)) throw new Error("Enter a valid Discord channel ID.");
    const channel = await selectDiscordChannel(channelId);
    if (channel.guildId !== interaction.guildId) throw new Error("The channel must be in this Discord server.");
    await settings.saveChannel(channel.id);
    await interaction.editReply(`Minecraft chat will now be sent to <#${channel.id}>.`);
  } catch (error) {
    await interaction.editReply(`Could not set the chat channel: ${error.message}`);
  }
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close();
  await flushOutgoing();
  client.destroy();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
client.login(process.env.DISCORD_TOKEN).catch((error) => { console.error("Discord login failed:", error); process.exit(1); });
