import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const roleAllCommand = new SlashCommandBuilder()
  .setName("roleall")
  .setDescription("Give a role to every member who does not already have it")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addRoleOption(option => option.setName("role").setDescription("Role to give everyone").setRequired(true));

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function retry(action, { attempts = 4, delays = [1000, 3000, 8000], sleep = pause } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await action(); }
    catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(delays[Math.min(attempt, delays.length - 1)] ?? 1000);
    }
  }
  throw lastError;
}

export function roleIsAssignable(guild, role) {
  const me = guild.members.me;
  return role.id !== guild.id && !role.managed && Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles)) && role.position < me.roles.highest.position;
}

export async function addRoleReliable(member, roleId, reason, options) {
  if (member.roles.cache.has(roleId)) return false;
  await retry(async () => {
    const current = await member.guild.members.fetch(member.id);
    if (!current.roles.cache.has(roleId)) await current.roles.add(roleId, reason);
  }, options);
  return true;
}

export async function reconcileAutoRole(guild, roleId, logger = console) {
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role || !roleIsAssignable(guild, role)) throw new Error(`Automatic role ${roleId} is missing or cannot be managed by the bot.`);
  const members = await guild.members.fetch(), missing = [...members.values()].filter(member => !member.roles.cache.has(roleId));
  let added = 0, failed = 0, cursor = 0;
  const worker = async () => { while (cursor < missing.length) { const member = missing[cursor++]; try { if (await addRoleReliable(member, roleId, "MPCS automatic role reconciliation")) added++; } catch (error) { failed++; logger.error(`Could not reconcile automatic role for ${member.user.tag}:`, error.message); } } };
  await Promise.all(Array.from({ length: Math.min(3, missing.length) }, worker));
  return { total: members.size, alreadyHad: members.size - missing.length, added, failed };
}

export async function handleRoleAllCommand(interaction) {
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: "You need Manage Roles permission.", flags: MessageFlags.Ephemeral });
  const role = interaction.options.getRole("role", true);
  if (!roleIsAssignable(interaction.guild, role)) return interaction.reply({ content: "I cannot give that role. Choose a normal role below my highest role and make sure I have Manage Roles.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await reconcileAutoRole(interaction.guild, role.id);
    return interaction.editReply(`Role assignment complete for ${role}: **${result.added} added**, **${result.alreadyHad} already had it**, **${result.failed} failed** out of ${result.total} members.`);
  } catch (error) {
    return interaction.editReply(`Could not complete the role assignment: ${error.message}`);
  }
}
