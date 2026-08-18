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

async function runConcurrent(values, concurrency, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) await operation(values[cursor++]);
  });
  await Promise.all(workers);
}

export async function reconcileAutoRole(guild, roleId, logger = console, { passes = 4, concurrency = 12, roleOptions } = {}) {
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role || !roleIsAssignable(guild, role)) throw new Error(`Automatic role ${roleId} is missing or cannot be managed by the bot.`);
  const firstMembers = await guild.members.fetch(), initiallyMissing = [...firstMembers.values()].filter(member => !member.roles.cache.has(roleId));
  const assigned = new Set();
  for (let pass = 1; pass <= passes; pass++) {
    const members = pass === 1 ? firstMembers : await guild.members.fetch();
    const missing = [...members.values()].filter(member => !member.roles.cache.has(roleId));
    if (!missing.length) break;
    await runConcurrent(missing, concurrency, async member => {
      try { if (await addRoleReliable(member, roleId, "MPCS automatic role reconciliation", roleOptions)) assigned.add(member.id); }
      catch (error) { logger.error(`Role pass ${pass}/${passes} failed for ${member.user.tag}:`, error.message); }
    });
  }
  const verified = await guild.members.fetch(), stillMissing = [...verified.values()].filter(member => !member.roles.cache.has(roleId));
  return { total: verified.size, alreadyHad: firstMembers.size - initiallyMissing.length, added: assigned.size, failed: stillMissing.length, missingIds: stillMissing.map(member => member.id) };
}

export async function handleRoleAllCommand(interaction) {
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: "You need Manage Roles permission.", flags: MessageFlags.Ephemeral });
  const role = interaction.options.getRole("role", true);
  if (!roleIsAssignable(interaction.guild, role)) return interaction.reply({ content: "I cannot give that role. Choose a normal role below my highest role and make sure I have Manage Roles.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await reconcileAutoRole(interaction.guild, role.id);
    if (result.failed) return interaction.editReply(`Role assignment finished for ${role}, but **${result.failed} member(s) are still missing it** after four verified passes. Added: **${result.added}**; already assigned: **${result.alreadyHad}**. Missing IDs: ${result.missingIds.slice(0,25).map(id=>`\`${id}\``).join(", ")}${result.missingIds.length>25?" …":""}`);
    return interaction.editReply(`Role assignment verified for ${role}: **everyone has it**. Added: **${result.added}**; already assigned: **${result.alreadyHad}**; total members: **${result.total}**.`);
  } catch (error) {
    return interaction.editReply(`Could not complete the role assignment: ${error.message}`);
  }
}
