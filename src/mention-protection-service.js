import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const mentionProtectCommand = new SlashCommandBuilder()
  .setName("mentionprotect").setDescription("Prevent members from mentioning selected people")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(command => command.setName("add").setDescription("Protect a member from mentions").addUserOption(option => option.setName("member").setDescription("Member whose mentions should be blocked").setRequired(true)))
  .addSubcommand(command => command.setName("remove").setDescription("Stop protecting a member from mentions").addUserOption(option => option.setName("member").setDescription("Member to remove from protection").setRequired(true)))
  .addSubcommand(command => command.setName("list").setDescription("List mention-protected members"));

export class MentionProtectionService {
  constructor(settings) { this.settings=settings; }
  protectedIds(guildId) { this.settings.protectedMentions||={};const ids=this.settings.protectedMentions[guildId];return this.settings.protectedMentions[guildId]=Array.isArray(ids)?[...new Set(ids.filter(id=>typeof id==="string"))]:[]; }
  async command(interaction) {
    if(!interaction.inGuild()||!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))return interaction.reply({content:"You need Administrator permission.",flags:MessageFlags.Ephemeral});
    const action=interaction.options.getSubcommand(),ids=this.protectedIds(interaction.guildId);
    if(action==="list")return interaction.reply({embeds:[new EmbedBuilder().setColor(0xaa55ff).setTitle("Mention protection").setDescription(ids.length?ids.map(id=>`<@${id}>`).join("\n"):"Nobody is currently protected from mentions.")],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
    const user=interaction.options.getUser("member",true);
    if(action==="add"&&!ids.includes(user.id))ids.push(user.id);else if(action==="remove")this.settings.protectedMentions[interaction.guildId]=ids.filter(id=>id!==user.id);
    await this.settings.save();
    return interaction.reply({content:action==="add"?`${user} is now protected. Direct mentions will be deleted and punished with a one-minute timeout.`:`${user} is no longer mention-protected.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  }
  async message(message) {
    if(!message.inGuild()||message.author.bot||!message.member)return false;
    const protectedId=this.protectedIds(message.guildId).find(id=>message.mentions.users.has(id));if(!protectedId)return false;
    const content=message.content;await message.delete().catch(()=>null);let timedOut=false;
    if(message.member.moderatable)timedOut=await message.member.timeout(60_000,`Mentioned protected member ${protectedId}`).then(()=>true).catch(()=>false);
    const notice=await message.channel.send({content:`<@${message.author.id}>, mentioning that member is blocked.${timedOut?" You have been timed out for one minute.":" Your message was removed."}`,allowedMentions:{users:[message.author.id]}}).catch(()=>null);
    if(notice)setTimeout(()=>void notice.delete().catch(()=>null),7_500);
    console.log(`Mention protection: ${message.author.tag} (${message.author.id}) mentioned ${protectedId}; deleted=true timeout=${timedOut} content=${JSON.stringify(content.slice(0,300))}`);return true;
  }
}
