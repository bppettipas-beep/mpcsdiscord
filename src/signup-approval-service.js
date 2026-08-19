import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { randomInt, randomUUID } from "node:crypto";
import { minecraftProfile } from "./team-signup-ui.js";

const COLORS=["#FF5555","#FFAA00","#FFFF55","#55FF55","#00AA00","#55FFFF","#5555FF","#0000AA","#AA00AA","#FF55FF","#FFFFFF","#AAAAAA","#00AAAA","#AA5500"];
const teamId=name=>name.toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,16);
const pendingDestructive=new Map();
const TEAM_FORMAT=`Team Name: Your Team Name
Team Leader: @Discord — IGN

Player 2: @Discord — IGN
Player 3: @Discord — IGN
Player 4: @Discord — IGN
Player 5: @Discord — IGN
Player 6: @Discord — IGN
Player 7: @Discord — IGN
Substitute: @Discord — IGN`;

export const signupApprovalCommand=new SlashCommandBuilder().setName("signupapproval").setDescription("Configure staff-approved team signup messages").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command=>command.setName("setup").setDescription("Set the signup channel and approving role")
    .addChannelOption(option=>option.setName("signup-channel").setDescription("Channel where players post team forms").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption(option=>option.setName("staff-role").setDescription("Role allowed to approve with a checkmark").setRequired(true)))
  .addSubcommand(command=>command.setName("role").setDescription("Change the role allowed to approve signups")
    .addRoleOption(option=>option.setName("staff-role").setDescription("New approving staff role").setRequired(true)))
  .addSubcommand(command=>command.setName("status").setDescription("Show the current signup approval configuration"))
  .addSubcommand(command=>command.setName("delete").setDescription("Delete one approval-created team after two confirmations")
    .addStringOption(option=>option.setName("team").setDescription("Approved team name or ID").setRequired(true)))
  .addSubcommand(command=>command.setName("wipe").setDescription("Delete every approval-created team after two confirmations"))
  .addSubcommand(command=>command.setName("disable").setDescription("Disable reaction-based signup approvals"));
export const signupTeamsCommand=new SlashCommandBuilder().setName("signupteams").setDescription("Set where approved signup rosters are posted").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(option=>option.setName("channel").setDescription("Staff channel that receives approved team rosters").addChannelTypes(ChannelType.GuildText).setRequired(true));

export function parseSignup(content){
  const lines=String(content||"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  let name=null,leader=null;const players=[],labels=new Set();
  for(const line of lines){
    let match=line.match(/^team\s*name\s*:\s*(.+)$/i);if(match){if(name)throw new Error("Include exactly one `Team name:` line.");name=match[1].trim();continue;}
    match=line.match(/^team\s*leader\s*:\s*<@!?(\d{17,20})>\s*(?:—|-)\s*([A-Za-z0-9_]{3,16})\s*$/i);if(match){if(leader)throw new Error("Include exactly one `Team Leader:` line.");leader={discordId:match[1],ign:match[2]};continue;}
    match=line.match(/^player\s*([2-7])\s*:\s*<@!?(\d{17,20})>\s*(?:—|-)\s*([A-Za-z0-9_]{3,16})\s*$/i);if(match){const label=`Player ${match[1]}`;if(labels.has(label))throw new Error(`Include only one \`${label}:\` line.`);labels.add(label);players.push({discordId:match[2],ign:match[3]});continue;}
    match=line.match(/^substitute\s*:\s*<@!?(\d{17,20})>\s*(?:—|-)\s*([A-Za-z0-9_]{3,16})\s*$/i);if(match){if(labels.has("Substitute"))throw new Error("Include only one `Substitute:` line.");labels.add("Substitute");players.push({discordId:match[1],ign:match[2]});continue;}
    throw new Error(`I could not read this line: \`${line.slice(0,80)}\``);
  }
  if(!name||!leader)throw new Error("The signup needs `Team Name:` and `Team Leader: @Discord — IGN`.");
  if(!/^[A-Za-z0-9 _-]{1,16}$/.test(name)||!teamId(name))throw new Error("Team names must be 1–16 letters, numbers, spaces, `_`, or `-`.");
  const roster=[leader,...players];if(roster.length!==8||labels.size!==7)throw new Error("Every slot is required: Team Leader, Players 2–7, and Substitute.");
  if(new Set(roster.map(member=>member.discordId)).size!==roster.length)throw new Error("A Discord member can only appear once in a signup.");
  if(new Set(roster.map(member=>member.ign.toLowerCase())).size!==roster.length)throw new Error("A Minecraft username can only appear once in a signup.");
  return{id:teamId(name),name,leader,...{roster}};
}

function gradient(){const first=randomInt(COLORS.length);let second=randomInt(COLORS.length-1);if(second>=first)second++;return[COLORS[first],COLORS[second]];}
function existingTeam(settings,signup){return[...(settings.teamSnapshot.teams||[]),...(settings.teamActions||[]).filter(action=>action.type==="create")].find(team=>team.id===signup.id||String(team.name).toLowerCase()===signup.name.toLowerCase());}
function assignedUuids(settings){return new Set([...(settings.teamSnapshot.teams||[]),...(settings.teamActions||[]).filter(action=>action.type==="create")].flatMap(team=>team.members||[]));}
const approvalConfig=(settings,guildId)=>settings.signupApprovals?.[guildId];
const approvalRecords=settings=>Object.entries(settings.approvedSignupMessages||{}).filter(([,record])=>record?.status==="approved"&&record.teamId);

export function removeApprovedSignups(settings,requestedTeamId=null){
  const records=approvalRecords(settings).filter(([,record])=>!requestedTeamId||record.teamId===requestedTeamId),ids=[...new Set(records.map(([,record])=>record.teamId))];
  for(const[messageId]of records)delete settings.approvedSignupMessages[messageId];
  settings.teamActions=(settings.teamActions||[]).filter(action=>!(ids.includes(action.id)&&action.type==="create"));
  const queuedDeletes=new Set(settings.teamActions.filter(action=>action.type==="delete").map(action=>action.id));for(const id of ids)if(!queuedDeletes.has(id))settings.teamActions.push({type:"delete",id});
  settings.schedules=(settings.schedules||[]).filter(match=>!ids.includes(match.teamOne)&&!ids.includes(match.teamTwo));return ids;
}
function confirmationRow(token,step){return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`signupapproval:confirm:${step}:${token}`).setLabel(step===1?"Continue to Final Warning":"Permanently Delete").setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`signupapproval:cancel:${token}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary));}
function findApprovedTeam(settings,input){const wanted=String(input||"").trim().toLowerCase();return approvalRecords(settings).map(([,record])=>record).find(record=>record.teamId.toLowerCase()===wanted||String(record.preview?.name||"").toLowerCase()===wanted);}

export async function handleSignupTeamsCommand(interaction,settings){
  if(!interaction.inGuild()||!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return interaction.reply({content:"You need Manage Server permission.",flags:MessageFlags.Ephemeral});
  const channel=interaction.options.getChannel("channel",true),me=interaction.guild.members.me;
  if(!channel.isTextBased()||!channel.isSendable()||!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return interaction.reply({content:`I need View Channel, Send Messages, and Embed Links in ${channel}.`,flags:MessageFlags.Ephemeral});
  settings.signupApprovals??={};settings.signupApprovals._teamsChannelId=channel.id;await settings.save();
  return interaction.reply({content:`Approved signup rosters will now be posted in ${channel}.`,flags:MessageFlags.Ephemeral});
}

function signupGuide(){return{embeds:[new EmbedBuilder().setColor(0x00e5ff).setTitle("MPCS TEAM SIGNUP FORMAT").setDescription("Post your team using the exact structure below. Every slot is mandatory. Replace each placeholder with a real Discord mention and that player's exact Minecraft IGN.").addFields({name:"Copy this structure",value:`\`\`\`text\n${TEAM_FORMAT}\n\`\`\``},{name:"What you need to do",value:"• Fill Team Leader, Players 2–7, and Substitute.\n• Use a real Discord mention for every player.\n• Put the matching exact Minecraft IGN after the dash.\n• Check every IGN carefully; the bot verifies every Minecraft account.\n• Wait for configured staff to approve the post using ✅."}).setFooter({text:"Invalid posts are removed automatically and the correct format is sent by DM."})],allowedMentions:{parse:[]}};}

export async function enforceSignupMessage(message,settings){
  if(!message.guild||message.author?.bot)return false;const config=approvalConfig(settings,message.guild.id);if(!config||message.channelId!==config.signupChannelId)return false;
  try{parseSignup(message.content);return true;}catch(error){await message.delete().catch(()=>null);await message.author.send({content:`Your MPCS team signup was removed because the format was invalid:\n\n**${error.message}**\n\nUse every slot exactly like this:\n\`\`\`text\n${TEAM_FORMAT}\n\`\`\``,allowedMentions:{parse:[]}}).catch(()=>null);return true;}
}

export async function handleSignupApprovalCommand(interaction,settings){
  if(!interaction.inGuild()||!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return interaction.reply({content:"You need Manage Server permission.",flags:MessageFlags.Ephemeral});
  const action=interaction.options.getSubcommand();settings.signupApprovals??={};
  if(action==="delete"||action==="wipe"){
    const records=approvalRecords(settings);if(!records.length)return interaction.reply({content:"There are no approval-created teams to delete.",flags:MessageFlags.Ephemeral});
    const record=action==="delete"?findApprovedTeam(settings,interaction.options.getString("team",true)):null;if(action==="delete"&&!record)return interaction.reply({content:"I could not find an approved team with that name or ID.",flags:MessageFlags.Ephemeral});
    const token=randomUUID(),teamIds=record?[record.teamId]:[...new Set(records.map(([,value])=>value.teamId))];pendingDestructive.set(token,{userId:interaction.user.id,guildId:interaction.guildId,teamIds,expires:Date.now()+120000});
    return interaction.reply({content:action==="wipe"?`⚠️ This will delete **all ${teamIds.length} approval-created teams**, their approval records, queued creates, and affected schedules. This is confirmation 1 of 2.`:`⚠️ This will delete **${record.preview?.name||record.teamId}**, its approval record, queued create, and affected schedules. This is confirmation 1 of 2.`,components:[confirmationRow(token,1)],flags:MessageFlags.Ephemeral});
  }
  if(action==="status"){const config=approvalConfig(settings,interaction.guildId),teamsChannelId=settings.signupApprovals._teamsChannelId;return interaction.reply({content:config?`Signup channel: <#${config.signupChannelId}>\nApproved teams channel: ${teamsChannelId?`<#${teamsChannelId}> (staff server)`:"Not set — run `/signupteams` in the staff server"}\nApproving role: <@&${config.staffRoleId}>`:`Reaction-based signup approval is disabled.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});}
  if(action==="disable"){delete settings.signupApprovals[interaction.guildId];await settings.save();return interaction.reply({content:"Reaction-based team signup approval is disabled.",flags:MessageFlags.Ephemeral});}
  if(action==="role"){const config=approvalConfig(settings,interaction.guildId);if(!config)return interaction.reply({content:"Run `/signupapproval setup` first.",flags:MessageFlags.Ephemeral});config.staffRoleId=interaction.options.getRole("staff-role",true).id;await settings.save();return interaction.reply({content:`Only members with <@&${config.staffRoleId}> can now approve team signups with ✅.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});}
  const signupChannel=interaction.options.getChannel("signup-channel",true),role=interaction.options.getRole("staff-role",true),me=interaction.guild.members.me;
  if(!signupChannel.isTextBased()||!signupChannel.isSendable()||!signupChannel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageMessages]))return interaction.reply({content:`I need View Channel, Send Messages, Read Message History, and Manage Messages in ${signupChannel}.`,flags:MessageFlags.Ephemeral});
  settings.signupApprovals[interaction.guildId]={signupChannelId:signupChannel.id,staffRoleId:role.id};await settings.save();
  const guide=await signupChannel.send(signupGuide());
  return interaction.reply({content:`Configured ${signupChannel} for signups. Members with ${role} can approve using ✅. Approved rosters use the channel selected with \`/signupteams\` in the staff server. I posted the exact signup instructions here: ${guide.url}`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
}

export async function handleSignupApprovalComponent(interaction,settings){
  if(!interaction.isButton()||!interaction.customId.startsWith("signupapproval:"))return false;const[,action,value,possibleToken]=interaction.customId.split(":"),token=action==="confirm"?possibleToken:value,pending=pendingDestructive.get(token);
  if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){await interaction.reply({content:"You need Manage Server permission to confirm deletions.",flags:MessageFlags.Ephemeral});return true;}
  if(!pending||pending.expires<Date.now()){pendingDestructive.delete(token);await interaction.update({content:"This deletion confirmation expired. Run the command again.",components:[]});return true;}
  if(interaction.user.id!==pending.userId||interaction.guildId!==pending.guildId){await interaction.reply({content:"Only the administrator who started this deletion can confirm it.",flags:MessageFlags.Ephemeral});return true;}
  if(action==="cancel"){pendingDestructive.delete(token);await interaction.update({content:"Deletion cancelled. Nothing was changed.",components:[]});return true;}
  if(value==="1"){await interaction.update({content:`🚨 **FINAL WARNING:** This will permanently remove ${pending.teamIds.length} approval-created team${pending.teamIds.length===1?"":"s"} from the bot and queue their deletion in Minecraft. Confirmation 2 of 2.`,components:[confirmationRow(token,2)]});return true;}
  const removed=pending.teamIds.flatMap(id=>removeApprovedSignups(settings,id));pendingDestructive.delete(token);await settings.save();await interaction.update({content:`✅ Deleted ${removed.length} approval-created team${removed.length===1?"":"s"}: ${removed.map(id=>`\`${id}\``).join(", ")}. Minecraft will apply the queued deletions on its next sync.`,components:[]});return true;
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
    signup.roster.forEach((entry,index)=>settings.links[profiles[index].uuid]=entry.discordId);const colors=gradient(),preview={id:signup.id,name:signup.name,members:profiles.map(profile=>profile.uuid),playerNames:Object.fromEntries(profiles.map(profile=>[profile.uuid,profile.name]))};settings.teamActions.push({type:"create",...preview,leaderName:profiles[0].name,colors});settings.approvedSignupMessages[message.id]={status:"approved",at:Date.now(),approvedBy:user.id,teamId:signup.id,preview};await settings.save();
    const teamsChannelId=settings.signupApprovals._teamsChannelId,channel=teamsChannelId?await message.client.channels.fetch(teamsChannelId).catch(()=>null):null;if(!channel?.isSendable())throw new Error("The configured approved-teams channel is unavailable. Staff must run `/signupteams` again.");await channel.send({embeds:[new EmbedBuilder().setColor(Number.parseInt(colors[0].slice(1),16)).setTitle(`${signup.name} — APPROVED`).setDescription(`Approved from [the signup message](${message.url}) by <@${user.id}>.`).addFields({name:"Team Leader",value:`<@${signup.leader.discordId}> — **${profiles[0].name}**`},{name:"Players",value:signup.roster.slice(1).map((entry,index)=>`<@${entry.discordId}> — **${profiles[index+1].name}**`).join("\n")||"No additional players"},{name:"In-game Gradient",value:`\`${colors[0]} → ${colors[1]}\``}).setTimestamp()],allowedMentions:{parse:[]}});
    await message.reply({content:`✅ **${signup.name}** was approved and queued for Minecraft with ${profiles.length} player${profiles.length===1?"":"s"}.`,allowedMentions:{repliedUser:false,parse:[]}});return true;
  }catch(error){delete settings.approvedSignupMessages[message.id];await settings.save();await reaction.users.remove(user.id).catch(()=>null);await message.reply({content:`❌ This signup was not created: ${error.message}`,allowedMentions:{repliedUser:false,parse:[]}});return true;}
}
