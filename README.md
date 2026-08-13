# MPCS Discord Chat Bridge

The MPCS Minecraft plugin sends accepted player chat over authenticated HTTPS to this Railway service. The service forwards it to one Discord text channel. It does not read Discord messages and does not need privileged gateway intents.

## Railway variables

Set these three variables on the Railway service:

```dotenv
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_text_channel_id
BRIDGE_SECRET=a_long_random_secret
```

Railway supplies `PORT` automatically. The start command is `npm start`. Generate a public Railway domain, then use its HTTPS URL in the plugin's `discord.yml`.

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
