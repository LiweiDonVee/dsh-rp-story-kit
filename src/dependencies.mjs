import {copy,fail,identifier,normalizeBindings,object,version} from './assets.mjs'

const key=(id,version)=>JSON.stringify([id,version])
const ordered=map=>[...map.entries()].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([,value])=>value)
export function mergeProfileRefs(...lists){const found=new Map();for(const ref of lists.flat()){const value={profileId:identifier(ref.profileId),version:version(ref.version)};found.set(key(value.profileId,value.version),value)}return ordered(found)}
export function collectAssetDependencies(state){
  const payload=state.payload,databases=new Map(),profiles=[]
  const sources=refs=>{for(const binding of normalizeBindings(refs)){const ref={databaseId:binding.databaseId,version:binding.version};databases.set(key(ref.databaseId,ref.version),ref)}}
  for(const character of payload.characters){sources(character.databaseRefs);if(character.profileRef)profiles.push(character.profileRef)}
  // These are the included immutable reviewed templates, not arbitrary provenance or library scans.
  for(const launch of payload.launches){sources(launch.request.sources);if(launch.request.profile)profiles.push(launch.request.profile)}
  return{additionalDatabaseRefs:ordered(databases),additionalProfileRefs:mergeProfileRefs(profiles)}
}
export function buildDependencySummary(defaults,current){
  const databases=new Map(),profiles=new Map()
  function add(map,ref,idField,use){const id=identifier(ref[idField]),number=version(ref.version),identity=key(id,number),row=map.get(identity)??{[idField]:id,version:number,uses:[]};if(!row.uses.includes(use))row.uses.push(use);row.uses=['current-binding','asset-default'].filter(value=>row.uses.includes(value));map.set(identity,row)}
  for(const ref of defaults.additionalDatabaseRefs)add(databases,ref,'databaseId','asset-default')
  for(const ref of defaults.additionalProfileRefs)add(profiles,ref,'profileId','asset-default')
  for(const ref of current.sources)add(databases,ref,'databaseId','current-binding')
  add(profiles,current.profile,'profileId','current-binding')
  return{databases:ordered(databases),profiles:ordered(profiles)}
}
export function validateDependencySummary(value){
  if(!object(value)||Object.keys(value).some(key=>!['databases','profiles'].includes(key))||!Array.isArray(value.databases)||!Array.isArray(value.profiles))fail('RESTORE_PAYLOAD_INVALID','依赖用途摘要结构无效。')
  for(const[name,idField]of[['databases','databaseId'],['profiles','profileId']]){const seen=new Set();for(const row of value[name]){if(!object(row)||Object.keys(row).some(key=>![idField,'version','uses'].includes(key))||typeof row[idField]!=='string'||!row[idField]||!Number.isSafeInteger(row.version)||row.version<1||!Array.isArray(row.uses)||row.uses.some(use=>!['current-binding','asset-default'].includes(use))||new Set(row.uses).size!==row.uses.length||seen.has(key(row[idField],row.version)))fail('RESTORE_PAYLOAD_INVALID','依赖用途摘要条目无效。');seen.add(key(row[idField],row.version))}}
  return copy(value)
}
