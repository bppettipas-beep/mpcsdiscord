import { websiteTeams } from "./team-source.js";

export async function disbandTeam(settings,client,guild,team,reason,actor="system") {
  settings.deletedTeams||={};
  const current=websiteTeams(settings).find(entry=>entry.id===team.id);
  if(!current)return {deleted:false,notified:0,namesRestored:0};
  const backup={teamSnapshot:structuredClone(settings.teamSnapshot),teamActions:structuredClone(settings.teamActions),schedules:structuredClone(settings.schedules),teamLeaveDeadlines:structuredClone(settings.teamLeaveDeadlines||{}),deletedTeams:structuredClone(settings.deletedTeams||{})};
  const discordIds=[...new Set((current.members||[]).map(uuid=>settings.links[uuid]).filter(Boolean))];
  try {
    settings.teamSnapshot.teams=(settings.teamSnapshot.teams||[]).filter(entry=>entry.id!==current.id);
    settings.teamActions=(settings.teamActions||[]).filter(action=>action.id!==current.id);
    settings.teamActions.push({type:"delete",id:current.id,reason,disbandedBy:actor,disbandedAt:new Date().toISOString()});
    settings.deletedTeams[current.id]={reason,disbandedBy:actor,disbandedAt:new Date().toISOString()};
    const removed=(settings.schedules||[]).filter(match=>match.teamOne===current.id||match.teamTwo===current.id);
    settings.schedules=(settings.schedules||[]).filter(match=>match.teamOne!==current.id&&match.teamTwo!==current.id);
    for(const[key,value]of Object.entries(settings.teamLeaveDeadlines||{}))if(value.teamId===current.id)delete settings.teamLeaveDeadlines[key];
    await settings.save();
    for(const match of removed)if(match.ticketChannelId){const channel=await guild.channels.fetch(match.ticketChannelId).catch(()=>null);await channel?.delete(`Team ${current.name} was disbanded`).catch(()=>{});}
    let namesRestored=0;
    for(const uuid of current.members||[]){const discordId=settings.links[uuid];if(!discordId||!(uuid in settings.originalNicknames))continue;const member=await guild.members.fetch(discordId).catch(()=>null);if(member?.manageable&&await member.setNickname(settings.originalNicknames[uuid]??null,`Team ${current.name} was disbanded`).then(()=>true).catch(()=>false))namesRestored++;}
    let notified=0;
    for(const discordId of discordIds){const user=await client.users.fetch(discordId).catch(()=>null);if(await user?.send(`Your MPCS team **${current.name}** has been disbanded.\n\n**Reason:** ${reason}`).then(()=>true).catch(()=>false))notified++;}
    return {deleted:true,notified,namesRestored};
  } catch(error) {
    settings.teamSnapshot=backup.teamSnapshot;settings.teamActions=backup.teamActions;settings.schedules=backup.schedules;settings.teamLeaveDeadlines=backup.teamLeaveDeadlines;settings.deletedTeams=backup.deletedTeams;throw error;
  }
}
