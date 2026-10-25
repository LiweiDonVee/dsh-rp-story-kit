import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {fail,object} from './assets.mjs'

function canonical(value){if(Array.isArray(value))return value.map(canonical);if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value}
export const semanticHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export function headerIdentity(header){if(!object(header))return header;return{...header,delegationDepth:header.delegationDepth===undefined?0:header.delegationDepth}}
export const headersEqual=(left,right)=>isDeepStrictEqual(headerIdentity(left),headerIdentity(right))
export function sessionIds(value){if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!id.trim())||new Set(value).size!==value.length)fail('RESTORE_PAYLOAD_INVALID','故事会话 ID 集合无效。');return[...value].sort()}
export function serializableData(value,seen=new Set()){
  if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return
  if((!Array.isArray(value)&&(!object(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))))||seen.has(value))fail('RESTORE_PAYLOAD_INVALID','恢复内容只能包含无循环 JSON 数据。')
  seen.add(value);for(const item of Object.values(value))serializableData(item,seen);seen.delete(value)
}
export function transferData(value){serializableData(value);const scan=item=>{if(Array.isArray(item)){item.forEach(scan);return}if(!object(item))return;for(const[key,next]of Object.entries(item)){if(['apikey','accesstoken','refreshtoken','password','credentials','providerconfig'].includes(key.toLowerCase().replaceAll('_','')))fail('RESTORE_PAYLOAD_INVALID','恢复内容不能包含凭据或本机 provider 配置。');scan(next)}};scan(value)}
