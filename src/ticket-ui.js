import { randomUUID } from "node:crypto";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

export const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Set up or manage support tickets")
  .addSubcommand(command => command.setName("panel").setDescription("Open the ticket control panel"))
  .addSubcommand(command => command.setName("edit").setDescription("Edit a specific posted ticket panel").addStringOption(option => option.setName("message-id").setDescription("The Discord message ID of the ticket panel").setRequired(true).setMinLength(17).setMaxLength(20)))
  .addSubcommand(command => command.setName("restrict").setDescription("Block a role from every ticket").addRoleOption(option => option.setName("role").setDescription("Role to block from all tickets").setRequired(true)))
  .addSubcommand(command => command.setName("unrestrict").setDescription("Remove a server-wide ticket restriction").addRoleOption(option => option.setName("role").setDescription("Role to allow again").setRequired(true)))
  .addSubcommand(command => command.setName("logs").setDescription("Choose where ticket transcripts are sent").addChannelOption(option => option.setName("channel").setDescription("Ticket transcript log channel").addChannelTypes(ChannelType.GuildText).setRequired(true)));

export const ticketActionCommands = [
  new SlashCommandBuilder().setName("add").setDescription("Add a member to the current ticket").addUserOption(option => option.setName("member").setDescription("Member to give access to this ticket").setRequired(true)),
  new SlashCommandBuilder().setName("close").setDescription("Close the current ticket"),
  new SlashCommandBuilder().setName("closerequest").setDescription("Ask the ticket opener for permission to close")
];

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const appearance = config => ({ title: config?.appearance?.title || "MPCS SUPPORT", description: config?.appearance?.description || "Need help? Open a private ticket and a staff member will assist you.\n\nPlease create only one ticket at a time.", footer: config?.appearance?.footer || "MPCS Support System" });
const styles = { Primary: ButtonStyle.Primary, Success: ButtonStyle.Success, Secondary: ButtonStyle.Secondary, Danger: ButtonStyle.Danger };
const ticketTypes = config => config?.ticketTypes?.length ? config.ticketTypes : [{ id: "support", name: "Support", label: config?.appearance?.buttonLabel || "Open Ticket", style: config?.appearance?.buttonStyle || "Primary", pingRoleId: config?.supportRoleId || null, questions: [] }];
const ensureTypes = config => config.ticketTypes ||= ticketTypes(config).map(type => ({ ...type }));
const panel = config => {
  const look = appearance(config);
  const types = ticketTypes(config), components = [];
  if (config?.layout === "dropdown") components.push(row(new StringSelectMenuBuilder().setCustomId("ticket:open-select").setPlaceholder("Select a ticket type").addOptions(types.map(type => ({ label: type.label, value: type.id, description: `Open a ${type.name} ticket`.slice(0, 100), emoji: "🎫" })))));
  else { const buttons = types.map(type => new ButtonBuilder().setCustomId(`ticket:open:${type.id}`).setLabel(type.label).setEmoji("🎫").setStyle(styles[type.style] || ButtonStyle.Primary)); for (let index = 0; index < buttons.length; index += 5) components.push(row(...buttons.slice(index, index + 5))); }
  return { embeds: [new EmbedBuilder().setColor(0x00e5ff).setTitle(look.title).setDescription(look.description).setFooter({ text: look.footer })], components };
};
const ticketActions = record => row(new ButtonBuilder().setCustomId("ticket:close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("ticket:claim").setLabel(record?.claimedBy ? "Claimed" : "Claim Ticket").setEmoji("✋").setStyle(ButtonStyle.Success).setDisabled(Boolean(record?.claimedBy)));
const ticketKey = interaction => `${interaction.guildId}:${interaction.user.id}`;
const safeName = name => name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "member";
const configFor = (settings, guildId) => settings.ticketConfig[guildId];
const ticketInChannel = (settings, channelId) => Object.entries(settings.tickets).find(([, ticket]) => ticket.channelId === channelId);
const snapshot = config => JSON.parse(JSON.stringify({ appearance: appearance(config), ticketTypes: ticketTypes(config), layout: config.layout || "buttons" }));
const applySnapshot = (config, value) => { config.appearance = JSON.parse(JSON.stringify(value.appearance || {})); config.ticketTypes = JSON.parse(JSON.stringify(value.ticketTypes || [])); config.layout = value.layout === "dropdown" ? "dropdown" : "buttons"; };
const panelConfigForMessage = (config, messageId) => { const saved = config?.panels?.[messageId]?.snapshot; return saved ? { ...config, ...JSON.parse(JSON.stringify(saved)) } : config; };

function typeManager(config, selectedId, notice = "Add a ticket type or select one to edit it.") {
  const types = ticketTypes(config), selected = types.find(type => type.id === selectedId);
  const components = [row(new StringSelectMenuBuilder().setCustomId("ticket:type-select").setPlaceholder("Select a ticket button to edit").addOptions(types.map(type => ({ label: type.label, value: type.id, description: `${type.name} • ${type.style}` }))))];
  if (selected) {
    components.push(row(new RoleSelectMenuBuilder().setCustomId(`ticket:type-role:${selected.id}`).setPlaceholder(selected.pingRoleId ? "Change this ticket's ping and claim role" : "Select the role this ticket should ping").setMinValues(1).setMaxValues(1)));
    components.push(row(new ChannelSelectMenuBuilder().setCustomId(`ticket:type-category:${selected.id}`).setPlaceholder(selected.categoryId ? "Change this button's ticket category" : "Choose a category for this button").setChannelTypes(ChannelType.GuildCategory).setMinValues(1).setMaxValues(1)));
  }
  components.push(row(new ButtonBuilder().setCustomId("ticket:add-type").setLabel("Add Button").setEmoji("➕").setStyle(ButtonStyle.Success), ...(selected ? [new ButtonBuilder().setCustomId(`ticket:edit-type:${selected.id}`).setLabel("Edit Name").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`ticket:edit-questions:${selected.id}`).setLabel("Edit Questions").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`ticket:type-style:${selected.id}`).setLabel(`Style: ${selected.style}`).setStyle(ButtonStyle.Secondary)] : [])));
  components.push(row(new ButtonBuilder().setCustomId("ticket:layout").setLabel(config.layout === "dropdown" ? "Layout: Dropdown" : "Layout: Buttons").setStyle(ButtonStyle.Primary), ...(selected ? [new ButtonBuilder().setCustomId(`ticket:delete-type:${selected.id}`).setLabel("Delete Selected").setStyle(ButtonStyle.Danger)] : []), new ButtonBuilder().setCustomId("ticket:back-control").setLabel("Back").setStyle(ButtonStyle.Secondary)));
  return { content: "", embeds: [new EmbedBuilder().setColor(0x00e5ff).setTitle("TICKET BUTTON MANAGER").setDescription(`${notice}\n\n**Public layout: ${config.layout === "dropdown" ? "Dropdown selection" : "Individual buttons"}**\n\n${types.map((type, index) => `**${index + 1}. ${type.label}**\nCreates \`${safeName(type.name)}-1\`, \`${safeName(type.name)}-2\`, etc. • ${type.style}\nPings: ${type.pingRoleId ? `<@&${type.pingRoleId}>` : "default support role"} • ${(type.questions || []).length} question(s)`).join("\n\n")}`).setFooter({ text: `${types.length}/10 ticket options configured` })], components };
}

function controlPanel(settings, guildId, notice = "Use the selectors below—everything saves automatically.") {
  const config = configFor(settings, guildId) || {};
  const look = appearance(config);
  const ready = Boolean(config.panelChannelId && config.categoryId && config.supportRoleId);
  return {
    content: "",
    embeds: [new EmbedBuilder().setColor(config.enabled === false ? 0xed4245 : 0x00e5ff).setTitle("MPCS TICKET CONTROL CENTER").setDescription(`${notice}\n\n${ready ? "✅ **Ready to post**" : "⚠️ **Select all three settings below**"}`).addFields(
      { name: "Public Panel Channel", value: config.panelChannelId ? `<#${config.panelChannelId}>` : "Not selected", inline: true },
      { name: "Private Ticket Category", value: config.categoryId ? `<#${config.categoryId}>` : "Not selected", inline: true },
      { name: "Default Support Role", value: config.supportRoleId ? `<@&${config.supportRoleId}>` : "Not selected", inline: true },
      { name: "New Tickets", value: config.enabled === false ? "🔴 Disabled" : "🟢 Enabled", inline: true },
      { name: "Open Tickets", value: String(Object.keys(settings.tickets).filter(key => key.startsWith(`${guildId}:`)).length), inline: true },
      { name: "Tracked Panels", value: String(Object.keys(config.panels || {}).length), inline: true },
      { name: "Panel Appearance", value: `**${look.title}**\n${look.description.slice(0, 160)}${look.description.length > 160 ? "…" : ""}\n**${ticketTypes(config).length} customizable ticket button${ticketTypes(config).length === 1 ? "" : "s"}**` }
    ).setFooter({ text: "Settings persist automatically across restarts" })],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId("ticket:config-panel").setPlaceholder("1. Select the public ticket-panel channel").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId("ticket:config-category").setPlaceholder("2. Select the private ticket category").setChannelTypes(ChannelType.GuildCategory).setMinValues(1).setMaxValues(1)),
      row(new RoleSelectMenuBuilder().setCustomId("ticket:config-role").setPlaceholder("3. Select the staff support role").setMinValues(1).setMaxValues(1)),
      row(new ButtonBuilder().setCustomId("ticket:edit-appearance").setLabel("Edit Panel Text").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId("ticket:manage-buttons").setLabel("Manage Buttons").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId("ticket:post-panel").setLabel("Post New").setEmoji("📨").setStyle(ButtonStyle.Success).setDisabled(!ready), new ButtonBuilder().setCustomId("ticket:update-panel").setLabel("Update Live").setStyle(ButtonStyle.Success).setDisabled(!config.livePanel), new ButtonBuilder().setCustomId("ticket:toggle").setLabel(config.enabled === false ? "Enable" : "Disable").setStyle(config.enabled === false ? ButtonStyle.Success : ButtonStyle.Danger))
    ]
  };
}

async function canClose(interaction, settings, record) {
  return isTicketStaff(interaction, settings, record);
}

function nextTicketNumber(settings,guildId,config,type){config.counters||={};const counterKey=safeName(type.name);const existing=Object.entries(settings.tickets).filter(([key,record])=>key.startsWith(`${guildId}:`)&&(record.typeId===type.id||safeName(record.typeName||"")===counterKey)).map(([,record])=>Number(record.number)||0);const next=Math.max(Number(config.counters[counterKey])||0,...existing,0)+1;config.counters[counterKey]=next;return next;}

export async function repairTicketNumbers(client,settings){let changed=false;const groups=new Map();for(const[key,record]of Object.entries(settings.tickets)){const guildId=key.split(":",1)[0],typeKey=safeName(record.typeName||"support"),groupKey=`${guildId}:${typeKey}`;if(!groups.has(groupKey))groups.set(groupKey,{guildId,typeKey,records:[]});groups.get(groupKey).records.push(record);}for(const{guildId,typeKey,records}of groups.values()){records.sort((a,b)=>String(a.openedAt||"").localeCompare(String(b.openedAt||""))||String(a.channelId).localeCompare(String(b.channelId)));const used=new Set(),repairs=[];for(const record of records){let number=Number(record.number);if(!Number.isInteger(number)||number<1||used.has(number)){number=1;while(used.has(number))number++;record.number=number;changed=true;repairs.push(record);}used.add(number);}const config=settings.ticketConfig[guildId]||={};config.counters||={};const maximum=Math.max(...used,0);if((Number(config.counters[typeKey])||0)<maximum){config.counters[typeKey]=maximum;changed=true;}for(const record of repairs){const channel=await client.channels.fetch(record.channelId).catch(()=>null);if(!channel?.isTextBased())continue;const desired=`${typeKey.slice(0,85)}-${record.number}`;if(channel.name!==desired)await channel.setName(desired,"Repair duplicate MPCS ticket number").catch(error=>console.error(`Could not rename repaired ticket ${record.channelId}:`,error.message));const messages=await channel.messages.fetch({limit:100}).catch(()=>null);const opening=messages?.find(message=>message.author.id===client.user.id&&message.embeds.some(embed=>(embed.title||"").endsWith("TICKET OPENED")));if(opening){const embeds=opening.embeds.map(embed=>{const builder=EmbedBuilder.from(embed);const fields=(embed.fields||[]).map(field=>field.name==="Ticket Number"?{...field,value:`#${record.number}`}:{...field});return builder.setFields(fields);});await opening.edit({embeds}).catch(error=>console.error(`Could not update repaired ticket message ${opening.id}:`,error.message));}}}if(changed)await settings.save();}

async function isTicketStaff(interaction, settings, record) {
  const config = configFor(settings, interaction.guildId), member = await interaction.guild.members.fetch(interaction.user.id);
  // Discord administrators and members who can manage the ticket channel must
  // never be locked out just because they also hold a restricted participant role.
  if(member.permissions.has([PermissionFlagsBits.Administrator])||member.permissions.has(PermissionFlagsBits.ManageGuild)||member.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageChannels))return true;
  // Older tickets stored the role selected when they were created. Keep that
  // role valid, but always include the guild's current support role so a role
  // configuration change does not strand existing tickets. Staff-role access
  // takes precedence over unrelated restricted roles a staff member may hold.
  const roleIds = [...new Set([record?.pingRoleId, config?.supportRoleId].filter(Boolean))];
  for (const roleId of roleIds) {
    const requiredRole = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (requiredRole && (member.roles.cache.has(roleId) || member.roles.highest.comparePositionTo(requiredRole) > 0)) return true;
  }
  if((config?.restrictedRoleIds||[]).some(roleId=>member.roles.cache.has(roleId)))return false;
  return false;
}

async function applyGlobalTicketRestriction(interaction,settings,role,restricted){const config=settings.ticketConfig[interaction.guildId]||={},otherRestrictions=new Set((config.restrictedRoleIds||[]).filter(id=>id!==role.id)),records=Object.entries(settings.tickets).filter(([key])=>key.startsWith(`${interaction.guildId}:`)).map(([,record])=>record);let updated=0;for(const record of records){const channel=await interaction.guild.channels.fetch(record.channelId).catch(()=>null);if(!channel?.isTextBased())continue;try{if(restricted){await channel.permissionOverwrites.edit(role,{ViewChannel:false},{reason:`Globally restricted from tickets by ${interaction.user.tag}`});const members=await interaction.guild.members.fetch();for(const member of members.values())if(member.roles.cache.has(role.id))await channel.permissionOverwrites.edit(member,{ViewChannel:false},{reason:"Member has a globally restricted ticket role"});}else{if(record.pingRoleId===role.id)await channel.permissionOverwrites.edit(role,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,ManageMessages:true},{reason:"Global ticket restriction removed"});else await channel.permissionOverwrites.delete(role,"Global ticket restriction removed").catch(()=>{});for(const userId of [record.userId,...(record.addedMembers||[])]){const member=await interaction.guild.members.fetch(userId).catch(()=>null);if(!member||[...otherRestrictions].some(id=>member.roles.cache.has(id)))continue;await channel.permissionOverwrites.edit(member,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,AttachFiles:true,EmbedLinks:true,AddReactions:true},{reason:"Global ticket restriction removed"});}}updated++;}catch(error){console.error(`Could not update ticket restriction in ${record.channelId}:`,error.message);}}return updated;}

export async function enforceTicketRestrictionsForMember(member,settings){const config=settings.ticketConfig[member.guild.id],restricted=(config?.restrictedRoleIds||[]).some(roleId=>member.roles.cache.has(roleId)),records=Object.entries(settings.tickets).filter(([key])=>key.startsWith(`${member.guild.id}:`)).map(([,record])=>record);for(const record of records){const channel=await member.guild.channels.fetch(record.channelId).catch(()=>null);if(!channel?.isTextBased())continue;if(restricted)await channel.permissionOverwrites.edit(member,{ViewChannel:false},{reason:"Member has a globally restricted ticket role"}).catch(()=>{});else if(record.userId===member.id||(record.addedMembers||[]).includes(member.id))await channel.permissionOverwrites.edit(member,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,AttachFiles:true,EmbedLinks:true,AddReactions:true},{reason:"Ticket restriction no longer applies"}).catch(()=>{});else await channel.permissionOverwrites.delete(member,"Ticket restriction no longer applies").catch(()=>{});}}

async function requestClose(interaction, settings) {
  const found = ticketInChannel(settings, interaction.channelId);
  if (!found || !(await canClose(interaction, settings, found[1]))) return interaction.reply({ content: "Only the staff role assigned to this ticket, or a higher role, can close it.", flags: MessageFlags.Ephemeral });
  return interaction.reply({ content: "Are you sure you want to permanently close this ticket?", components: [row(new ButtonBuilder().setCustomId("ticket:confirm-close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("ticket:cancel-close").setLabel("Cancel").setStyle(ButtonStyle.Secondary))], flags: MessageFlags.Ephemeral });
}

async function requestOwnerClose(interaction, settings) {
  const found = ticketInChannel(settings, interaction.channelId);
  if (!found || !(await isTicketStaff(interaction, settings, found[1]))) return interaction.reply({ content: "Only the staff role assigned to this ticket, or a higher role, can request closure.", flags: MessageFlags.Ephemeral });
  await interaction.channel.send({ content: `<@${found[1].userId}>`, embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("CLOSE TICKET?").setDescription(`${interaction.user} has requested to close this ticket. Do you want to close it?`)], components: [row(new ButtonBuilder().setCustomId("ticket:accept-request").setLabel("Yes, Close Ticket").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId("ticket:decline-request").setLabel("Keep It Open").setStyle(ButtonStyle.Secondary))], allowedMentions: { users: [found[1].userId] } });
  return interaction.reply({ content: "Closure request sent to the ticket opener.", flags: MessageFlags.Ephemeral });
}

async function addTicketMember(interaction, settings) {
  const found = ticketInChannel(settings, interaction.channelId);
  if (!found) return interaction.reply({ content: "Use this command inside an active ticket channel.", flags: MessageFlags.Ephemeral });
  const record = found[1];
  if (!(await isTicketStaff(interaction, settings, record))) return interaction.reply({ content: "Only the staff role assigned to this ticket, or a higher role, can add members.", flags: MessageFlags.Ephemeral });
  const user = interaction.options.getUser("member", true), member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.reply({ content: "That user is not a member of this Discord server.", flags: MessageFlags.Ephemeral });
  if (user.bot) return interaction.reply({ content: "Bots cannot be added as ticket participants.", flags: MessageFlags.Ephemeral });
  if (user.id === record.userId || (record.addedMembers || []).includes(user.id)) return interaction.reply({ content: `${user} already has participant access to this ticket.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  try {
    await interaction.channel.permissionOverwrites.edit(member, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true, AddReactions: true }, { reason: `Added to ticket by ${interaction.user.tag}` });
  } catch (error) {
    return interaction.reply({ content: `I could not add that member. Check that I have Manage Channels permission.`, flags: MessageFlags.Ephemeral });
  }
  record.addedMembers ||= []; record.addedMembers.push(user.id); await settings.save();
  await interaction.reply({ content: `✅ ${user} was added to this ticket by ${interaction.user}.`, allowedMentions: { users: [user.id] } });
}

async function archiveTicket(interaction,settings,record){
  const logId=settings.ticketConfig._transcriptLogChannelId;if(!logId)return false;const log=await interaction.client.channels.fetch(logId).catch(()=>null);if(!log?.isSendable())return false;
  const messages=[];let before;while(true){const batch=await interaction.channel.messages.fetch({limit:100,...(before?{before}:{})});if(!batch.size)break;messages.push(...batch.values());before=batch.last().id;if(batch.size<100)break;}messages.sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
  const lines=["MPCS TICKET TRANSCRIPT",`Source server: ${interaction.guild.name} (${interaction.guildId})`,`Channel: #${interaction.channel.name} (${interaction.channelId})`,`Type: ${record.typeName||"Support"} #${record.number||"?"}`,`Opened by: ${record.userId}`,`Added members: ${(record.addedMembers||[]).join(", ")||"None"}`,`Claimed by: ${record.claimedBy||"Nobody"}`,`Closed by: ${interaction.user.tag} (${interaction.user.id})`,`Opened: ${record.openedAt||"Unknown"}`,`Closed: ${new Date().toISOString()}`,"","MESSAGES","========"];
  for(const message of messages){lines.push(`[${new Date(message.createdTimestamp).toISOString()}] ${message.author?.tag||"Unknown"} (${message.author?.id||"unknown"}): ${message.content||"[no text]"}`);for(const attachment of message.attachments.values())lines.push(`  Attachment: ${attachment.url}`);for(const embed of message.embeds){if(embed.title)lines.push(`  Embed title: ${embed.title}`);if(embed.description)lines.push(`  Embed: ${embed.description}`);}}
  const transcript=Buffer.from(lines.join("\n"),"utf8"),chunkSize=7*1024*1024,total=Math.max(1,Math.ceil(transcript.length/chunkSize)),base=safeName(interaction.channel.name),summary=new EmbedBuilder().setColor(0x00e5ff).setTitle("TICKET TRANSCRIPT").addFields({name:"Source Server",value:interaction.guild.name,inline:true},{name:"Ticket",value:`#${interaction.channel.name}`,inline:true},{name:"Type",value:record.typeName||"Support",inline:true},{name:"Opened By",value:`<@${record.userId}>`,inline:true},{name:"Closed By",value:`${interaction.user.tag}`,inline:true},{name:"Messages",value:String(messages.length),inline:true}).setTimestamp();
  for(let index=0;index<total;index++){const file=new AttachmentBuilder(transcript.subarray(index*chunkSize,Math.min(transcript.length,(index+1)*chunkSize)),{name:`${base}-${interaction.channelId}${total>1?`-part-${index+1}-of-${total}`:""}.txt`});await log.send({...(index===0?{embeds:[summary]}:{content:`Transcript continuation ${index+1}/${total} for **#${interaction.channel.name}**`}),files:[file],allowedMentions:{parse:[]}});}return true;
}

export async function handleTicketCommand(interaction, settings) {
  if (!interaction.inGuild()) return interaction.reply({ content: "Tickets are only available inside the MPCS Discord server.", flags: MessageFlags.Ephemeral });
  const subcommand = interaction.commandName === "add" ? "add" : interaction.commandName === "close" ? "close" : interaction.commandName === "closerequest" ? "request-close" : interaction.options.getSubcommand();
  if (subcommand === "add") return addTicketMember(interaction, settings);
  if (subcommand === "close") return requestClose(interaction, settings);
  if (subcommand === "request-close") return requestOwnerClose(interaction, settings);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server permission to open the ticket control panel.", flags: MessageFlags.Ephemeral });
  if(subcommand==="restrict"||subcommand==="unrestrict"){const config=settings.ticketConfig[interaction.guildId]||={enabled:true},role=interaction.options.getRole("role",true),roles=new Set(config.restrictedRoleIds||[]),restricted=subcommand==="restrict";if(restricted)roles.add(role.id);else roles.delete(role.id);config.restrictedRoleIds=[...roles];await settings.save();await interaction.deferReply({flags:MessageFlags.Ephemeral});const updated=await applyGlobalTicketRestriction(interaction,settings,role,restricted);return interaction.editReply({content:restricted?`${role} is now restricted from every ticket and access was removed from ${updated} open ticket channel${updated===1?"":"s"}. This overrides support-role access.`:`${role} is no longer globally restricted. Access was recalculated for ${updated} open ticket channel${updated===1?"":"s"}.`,allowedMentions:{parse:[]}});}
  if(subcommand==="logs"){const channel=interaction.options.getChannel("channel",true),me=interaction.guild.members.me;if(!channel.isTextBased()||!channel.isSendable())return interaction.reply({content:"Choose a text channel the bot can send to.",flags:MessageFlags.Ephemeral});if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]))return interaction.reply({content:"I need View Channel, Send Messages, Attach Files, and Embed Links there.",flags:MessageFlags.Ephemeral});settings.ticketConfig._transcriptLogChannelId=channel.id;await settings.save();return interaction.reply({content:`Ticket transcripts from the main Discord will now be sent to ${channel} in the staff Discord.`,flags:MessageFlags.Ephemeral});}
  if (subcommand === "edit") {
    const messageId = interaction.options.getString("message-id", true).trim(), config = settings.ticketConfig[interaction.guildId] ||= { enabled: true }; let saved = config.panels?.[messageId];
    if (!/^\d{17,20}$/.test(messageId)) return interaction.reply({ content: "Enter a valid Discord message ID.", flags: MessageFlags.Ephemeral });
    if (!saved && config.livePanel?.messageId === messageId) { saved = { channelId: config.livePanel.channelId, snapshot: snapshot(config) }; config.panels ||= {}; config.panels[messageId] = saved; }
    if (!saved) return interaction.reply({ content: "I do not recognize that ticket panel. Use the message ID of a panel posted by this bot after the multi-panel update.", flags: MessageFlags.Ephemeral });
    applySnapshot(config, saved.snapshot); config.livePanel = { channelId: saved.channelId, messageId }; await settings.save();
    return interaction.reply({ ...controlPanel(settings, interaction.guildId, `Editing panel message **${messageId}**. Make changes, then click **Update Live**.`), flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ ...controlPanel(settings, interaction.guildId), flags: MessageFlags.Ephemeral });
}

export async function handleTicketComponent(interaction, settings) {
  let [, action, targetId, sourcePanelId] = interaction.customId.split(":");
  if (action === "open-select") { action = "open"; targetId = interaction.values[0]; }
  if (["config-panel", "config-category", "config-role", "edit-appearance", "save-appearance", "manage-buttons", "layout", "type-select", "type-role", "type-category", "add-type", "edit-type", "save-type", "edit-questions", "save-questions", "type-style", "delete-type", "back-control", "post-panel", "update-panel", "toggle", "refresh"].includes(action)) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: "You need Manage Server permission to use this control panel.", flags: MessageFlags.Ephemeral });
    const config = settings.ticketConfig[interaction.guildId] ||= { enabled: true };
    if (action === "edit-appearance") {
      const look = appearance(config), input = (id, label, value, style, max) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setValue(value).setStyle(style).setRequired(true).setMaxLength(max));
      return interaction.showModal(new ModalBuilder().setCustomId("ticket:save-appearance").setTitle("Customize Ticket Panel").addComponents(input("title", "Panel title", look.title, TextInputStyle.Short, 256), input("description", "Panel message", look.description, TextInputStyle.Paragraph, 4000), input("footer", "Panel footer", look.footer, TextInputStyle.Short, 2048)));
    }
    if (action === "save-appearance") {
      config.appearance = { ...appearance(config), title: interaction.fields.getTextInputValue("title").trim(), description: interaction.fields.getTextInputValue("description").trim(), footer: interaction.fields.getTextInputValue("footer").trim() };
      await settings.save(); return interaction.update(controlPanel(settings, interaction.guildId, "✅ Ticket panel text saved."));
    }
    if (action === "manage-buttons") return interaction.update(typeManager(config));
    if (action === "layout") { config.layout = config.layout === "dropdown" ? "buttons" : "dropdown"; await settings.save(); return interaction.update(typeManager(config, null, `✅ Public ticket layout changed to ${config.layout === "dropdown" ? "a dropdown" : "individual buttons"}.`)); }
    if (action === "back-control") return interaction.update(controlPanel(settings, interaction.guildId));
    if (action === "type-select") return interaction.update(typeManager(config, interaction.values[0], "Selected. Use the controls below to edit this button."));
    if (action === "type-role") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); type.pingRoleId = interaction.values[0]; await settings.save(); return interaction.update(typeManager(config, type.id, "✅ Ping and claim role updated.")); }
    if (action === "type-category") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); type.categoryId = interaction.values[0]; await settings.save(); return interaction.update(typeManager(config, type.id, "Ticket category updated. New tickets from this button will open there.")); }
    if (action === "add-type" || action === "edit-type") {
      const existing = action === "edit-type" ? ticketTypes(config).find(type => type.id === targetId) : null;
      if (action === "add-type" && ticketTypes(config).length >= 10) return interaction.reply({ content: "A ticket panel can have at most 10 buttons.", flags: MessageFlags.Ephemeral });
      if (action === "edit-type" && !existing) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral });
      const input = (id, label, value, max) => { const builder = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max); if (value) builder.setValue(value); return row(builder); };
      return interaction.showModal(new ModalBuilder().setCustomId(`ticket:save-type:${existing?.id || "new"}`).setTitle(existing ? "Edit Ticket Button" : "Add Ticket Button").addComponents(input("type-name", "Ticket type / channel name", existing?.name || "", 40), input("button-label", "Button text", existing?.label || "", 80)));
    }
    if (action === "save-type") {
      const name = interaction.fields.getTextInputValue("type-name").trim(), label = interaction.fields.getTextInputValue("button-label").trim(), types = ensureTypes(config), duplicate = types.some(type => type.id !== targetId && type.name.toLowerCase() === name.toLowerCase());
      if (duplicate) return interaction.reply({ content: "A ticket type with that name already exists.", flags: MessageFlags.Ephemeral });
      if (targetId === "new") { const type = { id: randomUUID().slice(0, 8), name, label, style: "Primary", pingRoleId: config.supportRoleId || null, questions: [] }; types.push(type); await settings.save(); return interaction.update(typeManager(config, type.id, "✅ New ticket button added. Select its ping role and optional questions below.")); }
      const type = types.find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral });
      type.name = name; type.label = label; await settings.save(); return interaction.update(typeManager(config, type.id, "✅ Ticket button updated."));
    }
    if (action === "edit-questions") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); const questions = (type.questions || []).join("\n"); const builder = new TextInputBuilder().setCustomId("questions").setLabel("One question per line (maximum 5)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000); if (questions) builder.setValue(questions); return interaction.showModal(new ModalBuilder().setCustomId(`ticket:save-questions:${type.id}`).setTitle("Ticket Intake Questions").addComponents(row(builder))); }
    if (action === "save-questions") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); const questions = interaction.fields.getTextInputValue("questions").split(/\r?\n/).map(value => value.trim()).filter(Boolean); if (questions.length > 5) return interaction.reply({ content: "Use at most five questions, one per line.", flags: MessageFlags.Ephemeral }); if (questions.some(question => question.length > 100)) return interaction.reply({ content: "Each question must be 100 characters or fewer.", flags: MessageFlags.Ephemeral }); type.questions = questions; await settings.save(); return interaction.update(typeManager(config, type.id, `✅ Saved ${questions.length} intake question${questions.length === 1 ? "" : "s"}.`)); }
    if (action === "type-style") { const type = ensureTypes(config).find(entry => entry.id === targetId); if (!type) return interaction.reply({ content: "That ticket button no longer exists.", flags: MessageFlags.Ephemeral }); const names = Object.keys(styles); type.style = names[(names.indexOf(type.style) + 1) % names.length]; await settings.save(); return interaction.update(typeManager(config, type.id, "✅ Button style updated.")); }
    if (action === "delete-type") { const types = ensureTypes(config); if (types.length <= 1) return interaction.reply({ content: "Keep at least one ticket button.", flags: MessageFlags.Ephemeral }); config.ticketTypes = types.filter(type => type.id !== targetId); await settings.save(); return interaction.update(typeManager(config, null, "✅ Ticket button deleted. Existing open tickets were not affected.")); }
    if (action === "config-panel") config.panelChannelId = interaction.values[0];
    if (action === "config-category") config.categoryId = interaction.values[0];
    if (action === "config-role") config.supportRoleId = interaction.values[0];
    if (action === "toggle") config.enabled = config.enabled === false;
    if (["config-panel", "config-category", "config-role", "toggle"].includes(action)) { await settings.save(); return interaction.update(controlPanel(settings, interaction.guildId, "✅ Setting saved.")); }
    if (action === "refresh") return interaction.update(controlPanel(settings, interaction.guildId, "Control panel refreshed."));
    if (action === "update-panel") { const live = config.livePanel, channel = live ? await interaction.guild.channels.fetch(live.channelId).catch(() => null) : null, message = channel?.isTextBased() ? await channel.messages.fetch(live.messageId).catch(() => null) : null; if (!message) { delete config.livePanel; await settings.save(); return interaction.update(controlPanel(settings, interaction.guildId, "❌ The selected panel message no longer exists. Post a new one.")); } const updated = await message.edit(panel(config)).then(() => true).catch(() => false); if(updated){config.panels||={};config.panels[live.messageId]={channelId:live.channelId,snapshot:snapshot(config)};await settings.save();}return interaction.update(controlPanel(settings, interaction.guildId, updated ? `✅ Panel **${live.messageId}** updated.` : "❌ I could not edit that panel. Check my permissions.")); }
    const panelChannel = await interaction.guild.channels.fetch(config.panelChannelId).catch(() => null), category = await interaction.guild.channels.fetch(config.categoryId).catch(() => null), supportRole = interaction.guild.roles.cache.get(config.supportRoleId), me = interaction.guild.members.me;
    if (!panelChannel?.isSendable() || category?.type !== ChannelType.GuildCategory || !supportRole) return interaction.update(controlPanel(settings, interaction.guildId, "❌ One of your selections no longer exists. Select it again."));
    if (!panelChannel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.update(controlPanel(settings, interaction.guildId, "❌ I need Manage Channels plus View Channel, Send Messages, and Embed Links in the selected panel channel."));
    const posted = await panelChannel.send(panel(config)); config.livePanel = { channelId: panelChannel.id, messageId: posted.id }; config.panels ||= {}; config.panels[posted.id] = { channelId: panelChannel.id, snapshot: snapshot(config) }; await settings.save();
    return interaction.update(controlPanel(settings, interaction.guildId, `✅ Ticket panel posted in ${panelChannel}.`));
  }
  if (action === "close") return requestClose(interaction, settings);
  if (action === "claim") {
    const found = ticketInChannel(settings, interaction.channelId);
    if (!found || !(await isTicketStaff(interaction, settings, found[1]))) return interaction.reply({ content: "Only the role assigned to this ticket, or a higher role, can claim it.", flags: MessageFlags.Ephemeral });
    if (found[1].claimedBy) return interaction.reply({ content: `This ticket is already claimed by <@${found[1].claimedBy}>.`, flags: MessageFlags.Ephemeral });
    found[1].claimedBy = interaction.user.id; await settings.save();
    await interaction.update({ components: [ticketActions(found[1])] });
    await interaction.followUp({ content: `✋ ${interaction.user} claimed this ticket.` }); return;
  }
  if (action === "cancel-close") return interaction.update({ content: "Ticket closure cancelled.", components: [] });
  if (action === "decline-request") { const found = ticketInChannel(settings, interaction.channelId); if (!found || found[1].userId !== interaction.user.id) return interaction.reply({ content: "Only the person who opened this ticket can answer.", flags: MessageFlags.Ephemeral }); return interaction.update({ content: "The ticket opener chose to keep this ticket open.", embeds: [], components: [] }); }
  if (action === "accept-request") { const found = ticketInChannel(settings, interaction.channelId); if (!found || found[1].userId !== interaction.user.id) return interaction.reply({ content: "Only the person who opened this ticket can answer.", flags: MessageFlags.Ephemeral }); await interaction.deferUpdate();const archived=await archiveTicket(interaction,settings,found[1]).catch(error=>{console.error("Could not archive accepted ticket:",error);return false;});delete settings.tickets[found[0]];await settings.save();await interaction.editReply({content:`Closure approved. This ticket will be deleted in 5 seconds.${archived?"":" Transcript logging failed or has not been configured."}`,embeds:[],components:[]});setTimeout(()=>void interaction.channel.delete(`Ticket closure approved by ${interaction.user.tag}`).catch(error=>console.error("Could not delete approved ticket channel:",error)),5000);return; }
  if (action === "confirm-close") {
    const found = ticketInChannel(settings, interaction.channelId);
    if (!found || !(await canClose(interaction, settings, found[1]))) return interaction.update({ content: "This ticket no longer exists or you cannot close it.", components: [] });
    await interaction.deferUpdate();
    const archived=await archiveTicket(interaction,settings,found[1]).catch(error=>{console.error("Could not archive ticket:",error);return false;});delete settings.tickets[found[0]]; await settings.save();
    await interaction.editReply({ content: `Ticket closed. This channel will be deleted in 5 seconds.${archived?"":" Transcript logging failed or has not been configured."}`, components: [] });
    setTimeout(() => void interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(error => console.error("Could not delete closed ticket channel:", error)), 5000);
    return;
  }
  if (!["open", "answers"].includes(action)) return;
  const baseConfig = configFor(settings, interaction.guildId), config = panelConfigForMessage(baseConfig, sourcePanelId || interaction.message?.id);
  if (!config || config.enabled === false) return interaction.reply({ content: config?.enabled === false ? "New tickets are currently disabled." : "The ticket system has not been configured yet.", flags: MessageFlags.Ephemeral });
  const type = ticketTypes(config).find(entry => entry.id === targetId) || (!targetId ? ticketTypes(config)[0] : null);
  if (!type) return interaction.reply({ content: "That ticket type is no longer available. Please use the newest ticket panel.", flags: MessageFlags.Ephemeral });
  const openingMember=await interaction.guild.members.fetch(interaction.user.id).catch(()=>null),restrictedRoleIds=new Set(config.restrictedRoleIds||[]),matchedRestriction=[...restrictedRoleIds].find(roleId=>openingMember?.roles.cache.has(roleId));
  if(matchedRestriction)return interaction.reply({content:`You cannot open tickets because you have the restricted <@&${matchedRestriction}> role.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  const questions = type.questions || [];
  if (action === "open" && questions.length) {
    const inputs = questions.map((question, index) => row(new TextInputBuilder().setCustomId(`answer-${index}`).setLabel(`Question ${index + 1}`).setPlaceholder(question).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
    return interaction.showModal(new ModalBuilder().setCustomId(`ticket:answers:${type.id}:${interaction.message.id}`).setTitle(`${type.name} Ticket Questions`.slice(0, 45)).addComponents(...inputs));
  }
  const answers = action === "answers" ? questions.map((question, index) => ({ question, answer: interaction.fields.getTextInputValue(`answer-${index}`).trim() })) : [];
  const key = ticketKey(interaction), existing = settings.tickets[key];
  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    if (channel) return interaction.reply({ content: `You already have an open ticket: ${channel}`, flags: MessageFlags.Ephemeral });
    delete settings.tickets[key]; await settings.save();
  }
  const category = await interaction.guild.channels.fetch(type.categoryId || config.categoryId).catch(() => null), pingRole = interaction.guild.roles.cache.get(type.pingRoleId || config.supportRoleId);
  if (!category || category.type !== ChannelType.GuildCategory || !pingRole) return interaction.reply({ content: "The ticket configuration is no longer valid. Please notify an administrator.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const ticketNumber = nextTicketNumber(settings,interaction.guildId,baseConfig,type);
    const channelName = `${safeName(type.name).slice(0, 85)}-${ticketNumber}`;
    const guildMembers=restrictedRoleIds.size?await interaction.guild.members.fetch():null,restrictedMembers=guildMembers?[...guildMembers.values()].filter(member=>member.id!==interaction.client.user.id&&member.id!==interaction.user.id&&[...restrictedRoleIds].some(roleId=>member.roles.cache.has(roleId))):[];
    const permittedIds = new Set([interaction.guild.roles.everyone.id, interaction.user.id, pingRole.id, interaction.client.user.id,...restrictedRoleIds,...restrictedMembers.map(member=>member.id)]);
    const accessOverwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
      ...(restrictedRoleIds.has(pingRole.id)?[]:[{ id: pingRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] }]),
      ...[...restrictedRoleIds].map(roleId=>({id:roleId,deny:[PermissionFlagsBits.ViewChannel]})),
      ...restrictedMembers.map(member=>({id:member.id,deny:[PermissionFlagsBits.ViewChannel]})),
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
    ];
    for (const overwrite of category.permissionOverwrites.cache.values()) if (!permittedIds.has(overwrite.id)) accessOverwrites.push({ id: overwrite.id, deny: [PermissionFlagsBits.ViewChannel] });
    const channel = await interaction.guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, topic: `${type.name} ticket opened by ${interaction.user.tag} (${interaction.user.id})`, permissionOverwrites: accessOverwrites, reason: `Ticket opened by ${interaction.user.tag}` });
    const record = { channelId: channel.id, userId: interaction.user.id, typeId: type.id, typeName: type.name, pingRoleId: pingRole.id, number: ticketNumber, claimedBy: null, openedAt: new Date().toISOString() }; settings.tickets[key] = record; await settings.save();
    const opened = new EmbedBuilder().setColor(0x00e5ff).setTitle(`${type.name.toUpperCase()} TICKET OPENED`).setDescription("Describe anything else staff should know below.").addFields({ name: "Ticket Type", value: type.name, inline: true }, { name: "Ticket Number", value: `#${ticketNumber}`, inline: true }, ...answers.map(item => ({ name: item.question, value: item.answer || "No answer" }))).setFooter({ text: `Opened by ${interaction.user.tag}` }).setTimestamp();
    await channel.send({ content: `${interaction.user} ${pingRole}`, embeds: [opened], components: [ticketActions(record)], allowedMentions: { users: [interaction.user.id], roles: [pingRole.id] } });
    await interaction.editReply(`Your private ticket is ready: ${channel}`);
  } catch (error) {
    console.error("Could not create ticket:", error);
    await interaction.editReply("I could not create your ticket. Check my channel and role permissions, then try again.");
  }
}
