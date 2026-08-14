# MPCS Discord Chat Bridge

The MPCS Minecraft plugin sends accepted player chat over authenticated HTTPS to this Railway service. The service forwards it to one Discord text channel. It does not read Discord messages and does not need privileged gateway intents.

## Railway variables

Set these variables on the Railway service:

```dotenv
DISCORD_TOKEN=your_discord_bot_token
BRIDGE_SECRET=a_long_random_secret
CONFIG_PATH=/data/config.json
```

Railway supplies `PORT` automatically. The start command is `npm start`. Generate a public Railway domain, then use its HTTPS URL in the plugin's `discord.yml`.

Add a Railway volume mounted at `/data`, then use this Discord command from an account with **Manage Server** permission:

```text
/setchat channel-id:YOUR_CHANNEL_ID
```

The selected channel is stored in `/data/config.json`, so it survives deployments and restarts. `DISCORD_CHANNEL_ID` remains available as an optional initial fallback.

## Minecraft configuration

After installing the newly built MPCSCore JAR once, edit `plugins/MPCSCore/discord.yml`:

```yaml
enabled: true
endpoint: 'https://your-service.up.railway.app/minecraft-chat'
secret: 'the_exact_same_long_random_secret'
server-name: 'MPCS'
```

Restart Minecraft after editing it. Existing MPCS configuration files are preserved; the new JAR only creates the new `discord.yml` when it does not exist.

The Railway health endpoint is `/health`. It returns HTTP 200 after the bot has connected to Discord.

## 91.9 The Bend radio

Run `/setradio channel-id:VOICE_CHANNEL_ID` with **Manage Server** permission. The bot joins that voice channel and continuously plays 91.9 The Bend from Moncton. Run `/setradio channel-id:off` to disconnect it. The bot needs **View Channel**, **Connect**, and **Speak** permissions.

Railway builds the included `Dockerfile`, which installs native Linux FFmpeg automatically.

## Account linking and rank synchronization

Enable **Server Members Intent** and **Message Content Intent** on the bot page in the Discord Developer Portal. In Minecraft, run `/link`, then DM the six-digit code to the bot.

Map ranks as an operator with `/discordrank set <rank> <DiscordRoleID>`. Use `/discordrank direction BOTH`, `DISCORD_TO_MINECRAFT`, or `MINECRAFT_TO_DISCORD`. Synchronization checks online Minecraft players every 10 seconds. The bot's Discord role must be above every managed rank role.
