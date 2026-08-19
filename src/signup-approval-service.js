import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { randomInt } from "node:crypto";
import { minecraftProfile } from "./team-signup-ui.js";

const COLORS=["#FF5555","#FFAA00","#FFFF55","#55FF55","#00AA00","#55FFFF","#5555FF","#0000AA","#AA00AA","#FF55FF","#FFFFFF","#AAAAAA","#00AAAA","#AA5500"];
const teamId=name=>name.toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,16);

export const signupApprovalCommand=new SlashCommandBuilder().setName("signupapproval").setDescription("Configure staff-approved team signup messages").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command=>command.setName("setup").setDescription("Set the signup channel, approved-team channel, and approving role")
    .addChannelOption(option=>option.setName("signup-channel").setDescription("Channel where players post team forms").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption(option=>option.setName("teams-channel").setDescription("Channel where approved rosters are published").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption(option=>option.setName("staff-role").setDescription("Role allowed to approve with a checkmark").setRequired(true)))
  .addSubcommand(command=>command.setName("role").setDescription("Change the role allowed to approve signups")
    .addRoleOption(option=>option.setName("staff-role").setDescription("New approving staff role").setRequired(true)))
  .addSubcommand(command=>command.setName("status").setDescription("Show the current signup approval configuration"))
  .addSubcommand(command=>command.setName("disable").setDescription("Disable reaction-based signup approvals"));
export const signupTeamsCommand=new SlashCommandBuilder().setName("signupteams").setDescription("Set where approved signup rosters are posted").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(option=>option.setName("channel").setDescription("Staff channel that receives approved team rosters").addChannelTypes(ChannelType.GuildText).setRequired(true));

export function parseSignup(content){
  const lines=String(content||"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  let name=null,leader=null;const players=[];
  for(const line of lines){
    let match=line.match(/^team\s*name\s*:\s*(.+)$/i);if(match){if(name)throw new Error("Include exactly one `Team name:` line.");name=match[1].trim();continue;}
    match=line.match(/^team\s*leader\s*:\s*<@!?(\d{17,20})>\s+([A-Za-z0-9_]{3,16})\s*$/i);if(match){if(leader)throw new Error("Include exactly one `Team Leader:` line.");leader={discordId:match[1],ign:match[2]};continue;}
    match=line.match(/^player\s*\d+\s*:\s*<@!?(\d{17,20})>\s+([A-Za-z0-9_]{3,16})\s*$/i);if(match){players.push({discordId:match[1],ign:match[2]});continue;}
    throw new Error(`I could not read this line: \`${line.slice(0,80)}\``);
  }
  if(!name||!leader)throw new Error("The signup needs `Team name:` and `Team Leader: @user IGN`.");
  if(!/^[A-Za-z0-9 _-]{1,16}$/.test(name)||!teamId(name))throw new Error("Team names must be 1–16 letters, numbers, spaces, `_`, or `-`.");
  const roster=[leader,...players];if(roster.length>8)throw new Error("A team can contain at most eight players.");
  if(new Set(roster.map(member=>member.discordId)).size!==roster.length)throw new Error("A Discord member can only appear once in a signup.");
  if(new Set(roster.map(member=>member.ign.toLowerCase())).size!==roster.length)throw new Error("A Minecraft username can only appear once in a signup.");
  return{id:teamId(name),name,leader,...{roster}};
}

function gradient(){const first=randomInt(COLORS.length);let second=randomInt(COLORS.length-1);if(second>=first)second++;return[COLORS[first],COLORS[second]];}
function existingTeam(settings,signup){return[...(settings.teamSnapshot.teams||[]),...(settings.teamActions||[]).filter(action=>action.type==="create")].find(team=>team.id===signup.id||String(team.name).toLowerCase()===signup.name.toLowerCase());}
function assignedUuids(settings){return new Set([...(settings.teamSnapshot.teams||[]),...(settings.teamActions||[]).filter(action=>action.type==="create")].flatMap(team=>team.members||[]));}
const approvalConfig=(settings,guildId)=>settings.signupApprovals?.[guildId];

export async function handleSignupTeamsCommand(interaction,settings){
  if(!interaction.inGuild()||!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return interaction.reply({content:"You need Manage Server permission.",flags:MessageFlags.Ephemeral});
  const channel=interaction.options.getChannel("channel",true),me=interaction.guild.members.me;
  if(!channel.isTextBased()||!channel.isSendable()||!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return interaction.reply({content:`I need View Channel, Send Messages, and Embed Links in ${channel}.`,flags:MessageFlags.Ephemeral});
  settings.signupApprovals??={};settings.signupApprovals._teamsChannelId=channel.id;await settings.save();
  return interaction.reply({content:`Approved signup rosters will now be posted in ${channel}.`,flags:MessageFlags.Ephemeral});
}

function signupGuide(roleId){return{embeds:[new EmbedBuilder().setColor(0x00e5ff).setTitle("MPCS TEAM SIGNUP FORMAT").setDescription("Post your team in this channel using the exact structure below. Replace each `@Discord` placeholder with a real Discord mention and put that person's exact Minecraft username after it.").addFields({name:"Copy this structure",value:"```text\nTeam name: Your Team Name\nTeam Leader: @Discord ExactMinecraftIGN\n\nPlayer2: @Discord ExactMinecraftIGN\nPlayer3: @Discord ExactMinecraftIGN\nPlayer4: @Discord ExactMinecraftIGN\nPlayer5: @Discord ExactMinecraftIGN\nPlayer6: @Discord ExactMinecraftIGN\nPlayer7: @Discord ExactMinecraftIGN\n```"},{name:"What you need to do",value:"• Use a real Discord mention for every player.\n• Put the matching exact Minecraft IGN after each mention.\n• Include one team leader and only the player lines your team needs.\n• Teams may contain up to eight total players.\n• Check every IGN carefully before posting. The bot verifies each account with Minecraft.\n• Wait for staff to review the signup. Only a member with the configured staff role can approve it using ✅."},{name:"After approval",value:`A member with <@&${roleId}> reacts with ✅. The bot then verifies the roster, generates a random in-game team gradient, creates the team, and posts the approved roster in the teams channel.`}).setFooter({text:"Do not react to your own signup. Wait for staff approval."})],allowedMentions:{parse:[]}};}

export async function handleSignupApprovalCommand(interaction,settings){
  if(!interaction.inGuild()||!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return interaction.reply({content:"You need Manage Server permission.",flags:MessageFlags.Ephemeral});
  const action=interaction.options.getSubcommand();settings.signupApprovals??={};
  if(action==="status"){const config=approvalConfig(settings,interaction.guildId);return interaction.reply({content:config?`Signup channel: <#${config.signupChannelId}>\nApproved teams channel: <#${config.teamsChannelId}>\nApproving role: <@&${config.staffRoleId}>`:`Reaction-based signup approval is disabled.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});}
  if(action==="disable"){delete settings.signupApprovals[interaction.guildId];await settings.save();return interaction.reply({content:"Reaction-based team signup approval is disabled.",flags:MessageFlags.Ephemeral});}
  if(action==="role"){const config=approvalConfig(settings,interaction.guildId);if(!config)return interaction.reply({content:"Run `/signupapproval setup` first.",flags:MessageFlags.Ephemeral});config.staffRoleId=interaction.options.getRole("staff-role",true).id;await settings.save();return interaction.reply({content:`Only members with <@&${config.staffRoleId}> can now approve team signups with ✅.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});}
  const signupChannel=interaction.options.getChannel("signup-channel",true),teamsChannel=interaction.options.getChannel("teams-channel",true),role=interaction.options.getRole("staff-role",true),me=interaction.guild.members.me;
  for(const channel of [signupChannel,teamsChannel])if(!channel.isTextBased()||!channel.isSendable()||!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]))return interaction.reply({content:`I need View Channel, Send Messages, and Read Message History in ${channel}.`,flags:MessageFlags.Ephemeral});
  settings.signupApprovals[interaction.guildId]={signupChannelId:signupChannel.id,teamsChannelId:teamsChannel.id,staffRoleId:role.id};await settings.save();
  const guide=await signupChannel.send(signupGuide(role.id));
  return interaction.reply({content:`Configured ${signupChannel} for signups. Members with ${role} can approve using ✅, and approved rosters will be posted in ${teamsChannel}. I posted the exact signup instructions here: ${guide.url}`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
}

export async function handleSignupReaction(reaction,user,settings){
  if(user.bot||reaction.emoji.name!=="✅")return false;if(reaction.partial)await reaction.fetch();const message=reaction.message;if(!message.guild)return false;
  const config=approvalConfig(settings,message.guild.id);if(!config||message.channelId!==config.signupChannelId)return false;
  const staff=await message.guild.members.fetch(user.id).catch(()=>null);if(!staff?.roles.cache.has(config.staffRoleId))return false;
  settings.approvedSignupMessages??={};const previous=settings.approvedSignupMessages[message.id];if(previous?.status==="approved"||(previous?.status==="processing"&&Date.now()-previous.at<120000))return true;
  settings.approvedSignupMessages[message.id]={status:"processing",at:Date.now(),approvedBy:user.id};await settings.save();
  try{
    const signup=parseSignup(message.content);if(existingTeam(settings,signup))throw new Error(`A team named **${signup.name}** already exists or is queued.`);
    const discordMembers=await Promise.all(signup.roster.map(entry=>message.guild.members.fetch(entry.discordId).catch(()=>null)));if(discordMembers.some(member=>!member||member.user.bot))throw new Error("Every mentioned account must be a real member of this server.");
    const profiles=await Promise.all(signup.roster.map(entry=>minecraftProfile(entry.ign)));const assigned=assignedUuids(settings);
    for(let index=0;index<profiles.length;index++){const profile=profiles[index],discordId=signup.roster[index].discordId,linked=settings.links[profile.uuid],otherLink=Object.entries(settings.links).find(([uuid,id])=>id===discordId&&uuid!==profile.uuid);if(linked&&linked!==discordId)throw new Error(`**${profile.name}** is linked to another Discord account.`);if(otherLink)throw new Error(`<@${discordId}> is linked to a different Minecraft account.`);if(assigned.has(profile.uuid))throw new Error(`**${profile.name}** is already on another team.`);}
    signup.roster.forEach((entry,index)=>settings.links[profiles[index].uuid]=entry.discordId);const colors=gradient();settings.teamActions.push({type:"create",id:signup.id,name:signup.name,leaderName:profiles[0].name,colors,members:profiles.map(profile=>profile.uuid)});settings.approvedSignupMessages[message.id]={status:"approved",at:Date.now(),approvedBy:user.id,teamId:signup.id};await settings.save();
    const teamsChannelId=settings.signupApprovals._teamsChannelId||config.teamsChannelId,channel=await message.client.channels.fetch(teamsChannelId).catch(()=>null);if(!channel?.isSendable())throw new Error("The configured approved-teams channel is unavailable. Staff must run `/signupteams` again.");await channel.send({embeds:[new EmbedBuilder().setColor(Number.parseInt(colors[0].slice(1),16)).setTitle(`${signup.name} — APPROVED`).setDescription(`Approved from [the signup message](${message.url}) by <@${user.id}>.`).addFields({name:"Team Leader",value:`<@${signup.leader.discordId}> — **${profiles[0].name}**`},{name:"Players",value:signup.roster.slice(1).map((entry,index)=>`<@${entry.discordId}> — **${profiles[index+1].name}**`).join("\n")||"No additional players"},{name:"In-game Gradient",value:`\`${colors[0]} → ${colors[1]}\``}).setTimestamp()],allowedMentions:{parse:[]}});
    await message.reply({content:`✅ **${signup.name}** was approved and queued for Minecraft with ${profiles.length} player${profiles.length===1?"":"s"}.`,allowedMentions:{repliedUser:false,parse:[]}});return true;
  }catch(error){delete settings.approvedSignupMessages[message.id];await settings.save();await reaction.users.remove(user.id).catch(()=>null);await message.reply({content:`❌ This signup was not created: ${error.message}`,allowedMentions:{repliedUser:false,parse:[]}});return true;}
}
