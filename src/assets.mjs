import {randomUUID} from 'node:crypto'

export class StoryKitError extends Error {
  constructor(code,message,status=400,diagnostics=[]) { super(message);this.name='StoryKitError';this.code=code;this.status=status;this.diagnostics=diagnostics }
}
export const fail=(code,message,status=400)=>{throw new StoryKitError(code,message,status)}
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
export const copy=value=>structuredClone(value)
export function text(value,label,{empty=true}={}) { if(typeof value!=='string'||!empty&&!value.trim())fail('INVALID_ASSET',`${label} 必须是${empty?'':'非空'}文本。`);return value }
export function identifier(value,label='ID') { const id=text(value,label,{empty:false});if(id.length>256)fail('INVALID_ASSET',`${label} 过长。`);return id }
export function version(value) { if(!Number.isSafeInteger(value)||value<1)fail('INVALID_ASSET','版本必须是正整数。');return value }
export function revision(value) { if(!Number.isSafeInteger(value)||value<0)fail('EXPECTED_REVISION_REQUIRED','需要非负 expectedRevision。');return value }
export function normalizeBindings(value=[]) {
  if(!Array.isArray(value))fail('INVALID_ASSET','databaseRefs 必须是数组。')
  const keys=new Set()
  return value.map(binding=>{if(!object(binding))fail('INVALID_ASSET','资料来源绑定必须是对象。');const key=identifier(binding.key,'来源槽位');if(key==='@session'||keys.has(key))fail('INVALID_ASSET','来源槽位必须唯一，且不能使用 @session。');keys.add(key);return{key,databaseId:identifier(binding.databaseId),version:version(binding.version)}})
}
export function normalizeCharacter(input) {
  if(!object(input))fail('INVALID_ASSET','角色资产必须是对象。')
  if(!Array.isArray(input.openings))fail('INVALID_ASSET','开场必须是数组。')
  const seen=new Set(),openings=input.openings.map(opening=>{if(!object(opening))fail('INVALID_ASSET','开场必须是对象。');const id=identifier(opening.id);if(seen.has(id))fail('INVALID_ASSET','开场 ID 不能重复。');seen.add(id);return{id,name:text(opening.name,'开场名称'),text:text(opening.text,'开场文本')}})
  if(!object(input.creator??{}))fail('INVALID_ASSET','作者信息必须是对象。')
  const creator={}
  for(const key of ['name','notes','version'])if(input.creator?.[key]!==undefined)creator[key]=text(input.creator[key],`作者 ${key}`)
  if(input.creator?.tags!==undefined){if(!Array.isArray(input.creator.tags)||input.creator.tags.some(tag=>typeof tag!=='string'))fail('INVALID_ASSET','作者标签必须是文本数组。');creator.tags=[...input.creator.tags]}
  const result={id:identifier(input.id??randomUUID()),version:version(input.version??1),name:text(input.name,'资产名称',{empty:false}),description:text(input.description??'','描述'),personality:text(input.personality??'','性格'),scenario:text(input.scenario??'','情境'),openings,examples:text(input.examples??'','示例对话'),creator,databaseRefs:normalizeBindings(input.databaseRefs)}
  for(const key of ['sourceId','avatarResourceId'])if(input[key]!==undefined)result[key]=identifier(input[key],key)
  if(input.profileRef!==undefined){if(!object(input.profileRef))fail('INVALID_ASSET','预设引用必须是对象。');result.profileRef={profileId:identifier(input.profileRef.profileId),version:version(input.profileRef.version)}}
  return result
}
export function normalizePersona(input) {
  if(!object(input))fail('INVALID_ASSET','玩家身份必须是对象。')
  const result={id:identifier(input.id??randomUUID()),version:version(input.version??1),name:text(input.name,'玩家身份名称',{empty:false}),description:text(input.description??'','玩家身份描述')}
  for(const key of ['sourceId','avatarResourceId'])if(input[key]!==undefined)result[key]=identifier(input[key],key)
  return result
}
