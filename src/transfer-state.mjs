import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {copy,fail,object,normalizeCharacter,normalizePersona} from './assets.mjs'
import {selectedAsset,storageKey} from './store.mjs'
import {validateSourcePayload} from './packs.mjs'
import {semanticHash,serializableData,sessionIds,transferData} from './identity.mjs'
import {validateReviewedLaunch} from './launch.mjs'

const pair=(id,version)=>JSON.stringify([id,version])
const sourceView=source=>Object.fromEntries(['id','format','rawText','dataBase64','sha256','provenance'].filter(key=>source[key]!==undefined).map(key=>[key,copy(source[key])]))
function validate(state,ids){
  if(!object(state)||Object.keys(state).some(key=>!['schemaVersion','revision','payload'].includes(key))||state.schemaVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!object(state.payload))fail('RESTORE_PAYLOAD_INVALID','Story Kit 状态版本无效。')
  transferData(state)
  const payload=copy(state.payload),names=['sessionAssets','characters','personas','sources','resources','launches','journalAudit']
  if(Object.keys(payload).some(key=>!names.includes(key))||names.some(key=>!Array.isArray(payload[key])))fail('RESTORE_PAYLOAD_INVALID','Story Kit 状态字段无效。')
  const seen=new Set(),sourceIds=new Set(),resourceIds=new Set()
  for(const source of payload.sources){if(typeof source.id!=='string'||!source.id||sourceIds.has(source.id))fail('RESTORE_PAYLOAD_INVALID','来源 ID 无效。');sourceIds.add(source.id);const{id,...value}=source;try{Object.assign(source,validateSourcePayload(value,{privacy:false}),{id})}catch{fail('RESTORE_PAYLOAD_INVALID','来源原件校验失败。')}}
  for(const resource of payload.resources){if(!object(resource)||Object.keys(resource).some(key=>!['id','mimeType','sha256','dataBase64'].includes(key))||typeof resource.id!=='string'||!resource.id||resourceIds.has(resource.id)||!['image/png','image/jpeg','image/webp','image/gif','application/json','text/plain'].includes(resource.mimeType)||typeof resource.dataBase64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(resource.dataBase64)||resource.sha256!==createHash('sha256').update(Buffer.from(resource.dataBase64,'base64')).digest('hex'))fail('RESTORE_PAYLOAD_INVALID','资源原件校验失败。');resourceIds.add(resource.id)}
  const assets={character:new Map(),persona:new Map()}
  for(const[kind,records,normalize]of[['character',payload.characters,normalizeCharacter],['persona',payload.personas,normalizePersona]])for(const asset of records){
    if(typeof asset?.id!=='string'||!Number.isSafeInteger(asset.version)||asset.version<1)fail('RESTORE_PAYLOAD_INVALID','资产身份无效。')
    let normalized;try{normalized=normalize(asset)}catch{fail('RESTORE_PAYLOAD_INVALID','资产内容无效。')}
    const key=pair(asset.id,asset.version)
    if(assets[kind].has(key)||!isDeepStrictEqual(asset,normalized)||asset.sourceId&&!sourceIds.has(asset.sourceId)||asset.avatarResourceId&&!resourceIds.has(asset.avatarResourceId))fail('RESTORE_PAYLOAD_INVALID','资产引用或内容不完整。')
    assets[kind].set(key,asset)
  }
  const needed={character:new Set(),persona:new Set()},neededSources=new Set(),neededResources=new Set()
  for(const record of payload.sessionAssets){if(!object(record)||!ids.includes(record.sessionId)||seen.has(record.sessionId)||Object.keys(record).some(key=>!['sessionId','character','persona'].includes(key)))fail('RESTORE_PAYLOAD_INVALID','资产会话范围无效。');seen.add(record.sessionId);for(const kind of ['character','persona']){const key=pair(record[kind]?.assetId,record[kind]?.version),asset=assets[kind].get(key);if(!asset)fail('RESTORE_PAYLOAD_INVALID','缺少所选固定资产版本。');needed[kind].add(key);if(asset.sourceId)neededSources.add(asset.sourceId);if(asset.avatarResourceId)neededResources.add(asset.avatarResourceId)}}
  if(ids.some(id=>!seen.has(id)))fail('RESTORE_PAYLOAD_INVALID','缺少故事资产引用。')
  if([...assets.character.keys()].some(key=>!needed.character.has(key))||[...assets.persona.keys()].some(key=>!needed.persona.has(key))||[...sourceIds].some(id=>!neededSources.has(id))||[...resourceIds].some(id=>!neededResources.has(id)))fail('RESTORE_PAYLOAD_INVALID','状态包含所选故事范围外的资产或原件。')
  for(const launch of payload.launches){try{validateReviewedLaunch(launch)}catch{fail('RESTORE_PAYLOAD_INVALID','启动审阅记录无效。')}const request=launch.request,character=assets.character.get(pair(request.character.assetId,request.character.version)),persona=assets.persona.get(pair(request.persona.assetId,request.persona.version));if(!character||!persona||request.title!==character.name||['name','description','personality','scenario'].some(key=>request.character[key]!==character[key])||request.persona.name!==persona.name||request.persona.description!==persona.description||request.examples!==character.examples||!character.openings.some(item=>item.id===request.opening.id&&item.text===request.opening.text)||launch.sessionId!==undefined&&!ids.includes(launch.sessionId))fail('RESTORE_PAYLOAD_INVALID','启动审阅记录与固定资产版本不一致。')}
  for(const audit of payload.journalAudit)if(!object(audit)||Object.keys(audit).some(key=>!['restoreId','fingerprint','sessionIds','status'].includes(key))||typeof audit.restoreId!=='string'||typeof audit.fingerprint!=='string'||!Array.isArray(audit.sessionIds)||audit.sessionIds.some(id=>!ids.includes(id))||!['complete','pending','failed'].includes(audit.status))fail('RESTORE_PAYLOAD_INVALID','恢复审计记录范围无效。')
  transferData(payload);return payload
}
function conflicts(data,payload){
  const result=[],add=id=>result.push({code:'RESTORE_CONTENT_CONFLICT',id})
  for(const[name,records]of[['characters',payload.characters],['personas',payload.personas]])for(const asset of records){const existing=data[name][storageKey(asset.id)]?.find(item=>item.version===asset.version);if(existing&&!isDeepStrictEqual(existing,asset))add(pair(asset.id,asset.version))}
  for(const source of payload.sources){const existing=data.sources[storageKey(source.id)];if(existing&&!isDeepStrictEqual(sourceView(existing),source))add(source.id)}
  for(const resource of payload.resources){const existing=data.resources[storageKey(resource.id)];if(existing&&!isDeepStrictEqual(existing,resource))add(resource.id)}
  for(const launch of payload.launches){const existing=data.launches?.[storageKey(launch.launchId)];if(existing&&existing.fingerprint!==launch.fingerprint)add(launch.launchId)}
  return result
}
export function createStoryKitTransfer({store,getGM,readSession,readerAvailable=()=>true}){
  const available=()=>readerAvailable()&&typeof readSession==='function'&&getGM()?.apiVersion===1&&typeof getGM()?.binding==='function'
  async function bindings(ids,signal){if(!available())fail('RESTORE_REQUIREMENT_MISSING','需要可用的 GM 绑定与宿主会话读取。',409);const records=[];for(const sessionId of ids){await readSession({sessionId,signal});const binding=await getGM().binding({sessionId,signal});if(!binding)fail('RESTORE_REQUIREMENT_MISSING','缺少通用 GM 故事绑定。',409);records.push(binding)}return records}
  return{
    available,
    contentRevision:async({signal}={})=>{signal?.throwIfAborted();return{revision:(await store.snapshot()).revision}},
    async exportState({sessionIds:input,signal}){
      const ids=sessionIds(input),records=await bindings(ids,signal),data=await store.rawState(),characters=new Map(),personas=new Map(),sources=new Map(),resources=new Map(),launches=new Map(),sessionAssets=[]
      for(const binding of records){
        const row={sessionId:binding.sessionId}
        for(const kind of ['character','persona']){const chosen=binding[kind],asset=selectedAsset(data,kind,chosen.assetId,chosen.version);row[kind]={assetId:asset.id,version:asset.version};(kind==='character'?characters:personas).set(pair(asset.id,asset.version),asset);if(asset.sourceId)sources.set(asset.sourceId,sourceView(data.sources[storageKey(asset.sourceId)]));if(asset.avatarResourceId)resources.set(asset.avatarResourceId,data.resources[storageKey(asset.avatarResourceId)])}
        sessionAssets.push(row);const launch=data.launches?.[storageKey(binding.launchId)];if(launch)launches.set(launch.launchId,launch)
      }
      const payload={sessionAssets,characters:[...characters.values()],personas:[...personas.values()],sources:[...sources.values()],resources:[...resources.values()],launches:[...launches.values()],journalAudit:[...(data.transferAudit??[]).filter(audit=>audit.sessionIds?.every(id=>ids.includes(id))),...Object.values(data.restoreJobs??{}).filter(job=>job.sessionIds?.every(id=>ids.includes(id))).map(({restoreId,fingerprint,sessionIds,status})=>({restoreId,fingerprint,sessionIds,status}))]}
      validate({schemaVersion:1,revision:data.revision,payload},ids)
      return{schemaVersion:1,revision:data.revision,payload:copy(payload)}
    },
    async preflightRestore({sessionIds:input,state,signal}){
      signal?.throwIfAborted();let payload,ids
      try{ids=sessionIds(input);payload=validate(state,ids)}catch{return{supported:false,conflicts:[{code:'RESTORE_PAYLOAD_INVALID',id:'storyKit'}],requirements:[]}}
      const found=conflicts(await store.rawState(),payload),requirements=available()?[]:['dsh-rp-gm','host-session-reader']
      return{supported:!found.length&&!requirements.length,conflicts:found,requirements}
    },
    async restoreState({restoreId,sessionIds:input,state,expectedRevision,signal}){
      if(typeof restoreId!=='string'||!restoreId.trim())fail('RESTORE_PAYLOAD_INVALID','需要 restoreId。')
      const ids=sessionIds(input)
      if(!object(state)||!Number.isSafeInteger(state.schemaVersion)||state.schemaVersion<1||!Number.isSafeInteger(state.revision)||state.revision<0||!object(state.payload)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('RESTORE_PAYLOAD_INVALID','恢复传输 envelope 或 revision 无效。')
      serializableData(state)
      const fingerprint=semanticHash({sessionIds:ids,state}),key=storageKey(restoreId)
      return store.updateInternal(async data=>{
        const old=data.restoredStates?.[key];if(old){if(old.fingerprint!==fingerprint)fail('RESTORE_ID_CONFLICT','restoreId 已用于其他内容。',409);return{changed:false,result:{restoredSessionIds:ids}}}
        const payload=validate(state,ids)
        if(data.revision!==expectedRevision)fail('REVISION_CONFLICT','资产库已变化，请重新预览。',409)
        if(conflicts(data,payload).length)fail('RESTORE_CONTENT_CONFLICT','目标已有不同的固定内容。',409)
        const actual=await bindings(ids,signal)
        for(const binding of actual){const association=payload.sessionAssets.find(item=>item.sessionId===binding.sessionId);for(const kind of ['character','persona'])if(!isDeepStrictEqual(association[kind],{assetId:binding[kind]?.assetId,version:binding[kind]?.version}))fail('RESTORE_PAYLOAD_INVALID','实际故事绑定与恢复资产引用不一致。')}
        if(payload.launches.some(launch=>!actual.some(binding=>binding.launchId===launch.launchId)))fail('RESTORE_PAYLOAD_INVALID','启动审阅记录不属于目标故事。')
        for(const[name,records]of[['characters',payload.characters],['personas',payload.personas]])for(const asset of records){const at=storageKey(asset.id),versions=data[name][at]??[];if(!versions.some(item=>item.version===asset.version))data[name][at]=[...versions,copy(asset)].sort((a,b)=>a.version-b.version)}
        for(const source of payload.sources){data.sources[storageKey(source.id)]=copy(source);const sourcePath=object(source.provenance?.data?.character_book)?'data.character_book':object(source.provenance?.character_book)?'character_book':null,book=sourcePath==='data.character_book'?source.provenance.data.character_book:source.provenance.character_book;if(sourcePath&&source.rawText!==undefined)data.descriptors[storageKey(source.id)]=[{id:sourcePath,sourceId:source.id,sourcePath,name:typeof book.name==='string'?book.name:'内嵌世界书',rawText:source.rawText}]}
        for(const resource of payload.resources)data.resources[storageKey(resource.id)]=copy(resource)
        data.launches??={};for(const launch of payload.launches)data.launches[storageKey(launch.launchId)]??=copy(launch)
        data.transferAudit??=[];for(const audit of payload.journalAudit)if(!data.transferAudit.some(old=>semanticHash(old)===semanticHash(audit)))data.transferAudit.push(copy(audit))
        data.restoredStates??={};data.restoredStates[key]={restoreId,fingerprint,sessionIds:ids}
        return{result:{restoredSessionIds:ids}}
      },{signal})
    },
  }
}
