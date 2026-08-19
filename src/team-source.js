export function websiteTeams(settings){
  const deleted=new Set((settings.teamActions||[]).filter(action=>action.type==="delete").map(action=>action.id)),teams=new Map();
  for(const team of settings.teamSnapshot?.teams||[])if(team?.id&&!deleted.has(team.id))teams.set(team.id,team);
  const previews=Object.values(settings.approvedSignupMessages||{}).filter(record=>record?.status==="approved"&&record.preview).map(record=>record.preview);
  const queued=(settings.teamActions||[]).filter(action=>action.type==="create");
  for(const team of [...previews,...queued])if(team?.id&&!deleted.has(team.id)&&!teams.has(team.id))teams.set(team.id,team);
  return[...teams.values()];
}
