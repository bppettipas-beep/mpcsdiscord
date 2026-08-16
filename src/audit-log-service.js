import { AuditLogEvent, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const logsCommand = new SlashCommandBuilder()
  .setName("logs").setDescription("Configure staff server audit logs")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command => command.setName("set").setDescription("Set a log destination")
    .addStringOption(option => option.setName("type").setDescription("Log category").setRequired(true)
      .addChoices({name:"Text edits and deletions",value:"text"},{name:"Member changes",value:"member"},{name:"Moderation actions",value:"mod"}))
    .addChannelOption(option => option.setName("channel").setDescription("Destination text channel").setRequired(true)))
  .addSubcommand(command => command.setName("disable").setDescription("Disable one log category")
    .addStringOption(option => option.setName("type").setDescription("Log category").setRequired(true)
      .addChoices({name:"Text edits and deletions",value:"text"},{name:"Member changes",value:"member"},{name:"Moderation actions",value:"mod"})))
  .addSubcommand(command => command.setName("status").setDescription("Show all configured log destinations"));

const colors={text:0x38bdf8,member:0x22c55e,mod:0xef4444};
const cut=(value,max=1000)=>String(value||"(empty)").slice(0,max);

export class AuditLogService {
  constructor(client,settings,mainGuildId,staffGuildId){this.client=client;this.settings=settings;this.mainGuildId=mainGuildId;this.staffGuildId=staffGuildId;}
  configGuildId(fallback){return this.staffGuildId||fallback;}
  config(guildId){return this.settings.auditLogs[guildId] ||= {text:null,member:null,mod:null};}
  async command(interaction){
    if(!interaction.inGuild()||!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return interaction.reply({content:"You need Manage Server permission.",flags:MessageFlags.Ephemeral});
    if(this.staffGuildId&&interaction.guildId!==this.staffGuildId)return interaction.reply({content:"Log configuration is only available in the staff server.",flags:MessageFlags.Ephemeral});
    const config=this.config(this.configGuildId(interaction.guildId)),sub=interaction.options.getSubcommand();
    if(sub==="status")return interaction.reply({embeds:[this.status(config)],flags:MessageFlags.Ephemeral});
    const type=interaction.options.getString("type",true);
    if(sub==="disable")config[type]=null;
    else {const channel=interaction.options.getChannel("channel",true);if(!channel.isTextBased()||!channel.isSendable())return interaction.reply({content:"Choose a text channel the bot can send to.",flags:MessageFlags.Ephemeral});config[type]=channel.id;}
    await this.settings.save();
    return interaction.reply({content:`${type[0].toUpperCase()+type.slice(1)} logging ${config[type]?`will be sent to <#${config[type]}>`:"was disabled"}.`,embeds:[this.status(config)],flags:MessageFlags.Ephemeral});
  }
  status(config){return new EmbedBuilder().setColor(0x00e5ff).setTitle("MPCS Staff Logs").addFields({name:"Text logs",value:config.text?`<#${config.text}>`:"Disabled",inline:true},{name:"Member logs",value:config.member?`<#${config.member}>`:"Disabled",inline:true},{name:"Moderation logs",value:config.mod?`<#${config.mod}>`:"Disabled",inline:true});}
  enabled(guildId){return !this.mainGuildId||guildId===this.mainGuildId;}
  async send(guild,type,embed){if(!guild||!this.enabled(guild.id))return;const id=this.config(this.configGuildId(guild.id))[type];if(!id)return;const channel=await this.client.channels.fetch(id).catch(()=>null);if(channel?.guildId!==this.configGuildId(guild.id)||!channel.isSendable())return;await channel.send({embeds:[embed.setColor(colors[type]).setTimestamp()]}).catch(error=>console.error(`Could not send ${type} audit log:`,error.message));}
  base(title,user){const embed=new EmbedBuilder().setTitle(title);if(user)embed.setAuthor({name:user.tag||user.username,iconURL:user.displayAvatarURL()});return embed;}
  async messageDelete(message){if(!message.guild||message.author?.bot)return;const audit=message.author?await this.findAudit(message.guild,AuditLogEvent.MessageDelete,message.author.id):null;await this.send(message.guild,"text",this.base("Message deleted",message.author).addFields({name:"Member",value:message.author?`<@${message.author.id}> (${message.author.id})`:"Unknown"},{name:"Channel",value:`<#${message.channelId}>`},{name:"Deleted by",value:audit?this.executor(audit):"Author or unknown"},{name:"Content",value:cut(message.content)},{name:"Attachments",value:message.attachments?.size?[...message.attachments.values()].map(a=>a.url).join("\n").slice(0,1000):"None"}));}
  async messageUpdate(before,after){if(!after.guild||after.author?.bot||before.content===after.content)return;await this.send(after.guild,"text",this.base("Message edited",after.author).setURL(after.url).addFields({name:"Member",value:`<@${after.author.id}> (${after.author.id})`},{name:"Channel",value:`<#${after.channelId}>`},{name:"Before",value:cut(before.content)},{name:"After",value:cut(after.content)}));}
  async memberAdd(member){await this.send(member.guild,"member",this.base("Member joined",member.user).addFields({name:"Member",value:`<@${member.id}> (${member.id})`},{name:"Account created",value:`<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`}));}
  async memberRemove(member){const audit=await this.findAudit(member.guild,AuditLogEvent.MemberKick,member.id);if(audit){await this.send(member.guild,"mod",this.base("Member kicked",member.user).addFields({name:"Member",value:`${member.user.tag} (${member.id})`},{name:"Moderator",value:this.executor(audit)},{name:"Reason",value:cut(audit.reason||"No reason provided")}));return;}await this.send(member.guild,"member",this.base("Member left",member.user).addFields({name:"Member",value:`${member.user.tag} (${member.id})`}));}
  async memberUpdate(before,after){
    if(before.nickname!==after.nickname)await this.send(after.guild,"member",this.base("Nickname changed",after.user).addFields({name:"Member",value:`<@${after.id}> (${after.id})`},{name:"Before",value:cut(before.nickname||before.user.username)},{name:"After",value:cut(after.nickname||after.user.username)}));
    if(before.avatar!==after.avatar)await this.send(after.guild,"member",this.base("Server profile picture changed",after.user).setThumbnail(after.displayAvatarURL({size:256})).addFields({name:"Member",value:`<@${after.id}> (${after.id})`}));
    const added=after.roles.cache.filter(role=>!before.roles.cache.has(role.id)&&role.id!==after.guild.id),removed=before.roles.cache.filter(role=>!after.roles.cache.has(role.id)&&role.id!==after.guild.id);
    if(added.size||removed.size){const audit=await this.findAudit(after.guild,AuditLogEvent.MemberRoleUpdate,after.id);await this.send(after.guild,"member",this.base("Member roles changed",after.user).addFields({name:"Member",value:`<@${after.id}> (${after.id})`},{name:"Added",value:added.size?[...added.values()].map(r=>`<@&${r.id}>`).join(" "):"None"},{name:"Removed",value:removed.size?[...removed.values()].map(r=>`<@&${r.id}>`).join(" "):"None"},{name:"Changed by",value:audit?this.executor(audit):"Unknown"}));}
    if(before.communicationDisabledUntilTimestamp!==after.communicationDisabledUntilTimestamp){const active=(after.communicationDisabledUntilTimestamp||0)>Date.now(),audit=await this.findAudit(after.guild,AuditLogEvent.MemberUpdate,after.id);await this.send(after.guild,"mod",this.base(active?"Member timed out":"Timeout removed",after.user).addFields({name:"Member",value:`<@${after.id}> (${after.id})`},{name:"Moderator",value:audit?this.executor(audit):"Unknown"},{name:"Until",value:active?`<t:${Math.floor(after.communicationDisabledUntilTimestamp/1000)}:F>`:"No longer timed out"},{name:"Reason",value:cut(audit?.reason||"No reason provided")}));}
  }
  async userUpdate(before,after){if(before.avatar===after.avatar&&before.globalName===after.globalName&&before.username===after.username)return;const guildId=this.mainGuildId||this.staffGuildId;if(!guildId)return;const guild=await this.client.guilds.fetch(guildId).catch(()=>null);if(!guild)return;const member=await guild.members.fetch(after.id).catch(()=>null);if(!member)return;await this.send(guild,"member",this.base("Discord profile changed",after).setThumbnail(after.displayAvatarURL({size:256})).addFields({name:"Member",value:`<@${after.id}> (${after.id})`},{name:"Before",value:cut(`${before.globalName||before.username} / ${before.username}`)},{name:"After",value:cut(`${after.globalName||after.username} / ${after.username}`)},{name:"Profile picture",value:before.avatar!==after.avatar?"Changed":"Unchanged"}));}
  async banAdd(ban){const audit=await this.findAudit(ban.guild,AuditLogEvent.MemberBanAdd,ban.user.id);await this.send(ban.guild,"mod",this.base("Member banned",ban.user).addFields({name:"Member",value:`${ban.user.tag} (${ban.user.id})`},{name:"Moderator",value:audit?this.executor(audit):"Unknown"},{name:"Reason",value:cut(audit?.reason||ban.reason||"No reason provided")}));}
  async banRemove(ban){const audit=await this.findAudit(ban.guild,AuditLogEvent.MemberBanRemove,ban.user.id);await this.send(ban.guild,"mod",this.base("Member unbanned",ban.user).addFields({name:"Member",value:`${ban.user.tag} (${ban.user.id})`},{name:"Moderator",value:audit?this.executor(audit):"Unknown"},{name:"Reason",value:cut(audit?.reason||"No reason provided")}));}
  async voiceUpdate(before,after){if(!after.guild||!this.enabled(after.guild.id))return;for(const[oldValue,newValue,label,auditKey]of[[before.serverMute,after.serverMute,"Server mute","mute"],[before.serverDeaf,after.serverDeaf,"Server deafen","deaf"]]){if(typeof oldValue!=="boolean"||typeof newValue!=="boolean"||oldValue===newValue)continue;const audit=await this.findAudit(after.guild,AuditLogEvent.MemberUpdate,after.id),confirmed=audit?.changes?.some(change=>(change.key===auditKey||change.key===`$${auditKey}`)&&Boolean(change.new)===newValue);if(!confirmed)continue;await this.send(after.guild,"mod",this.base(`${label} ${newValue?"enabled":"removed"}`,after.member?.user).addFields({name:"Member",value:`<@${after.id}> (${after.id})`},{name:"Moderator",value:this.executor(audit)}));}}
  async findAudit(guild,type,targetId){if(!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog))return null;await new Promise(resolve=>setTimeout(resolve,700));const logs=await guild.fetchAuditLogs({type,limit:6}).catch(()=>null);return logs?.entries.find(entry=>entry.target?.id===targetId&&Date.now()-entry.createdTimestamp<15000)||null;}
  executor(entry){return entry.executor?`<@${entry.executor.id}> (${entry.executor.id})`:"Unknown";}
}
