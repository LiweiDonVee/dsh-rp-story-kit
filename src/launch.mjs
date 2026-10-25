import {copy,fail,identifier,normalizeBindings,object,version,StoryKitError} from './assets.mjs'
import {storageKey} from './store.mjs'
import {validateStorySeed} from './seeds.mjs'
import {semanticHash} from './identity.mjs'
import {isDeepStrictEqual} from 'node:util'

function assetRef(value){if(!object(value)||Object.keys(value).some(key=>!['assetId','version'].includes(key)))fail('INVALID_REQUEST','需要明确资产 ID 与版本。');return{assetId:identifier(value.assetId),version:version(value.version)}}
export function validateReviewedLaunch(record){
  const check=(value,required,optional=[])=>{if(!object(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail('LAUNCH_CONFLICT','保存的启动字段不符合审阅合同。',409)}
  check(record,['launchId','fingerprint','request','status','createdAt'],['sessionId','errorCode'])
  const request=record.request
  check(request,['launchId','title','character','persona','opening','examples','sources','initialScene','initialFacts'],['profile'])
  check(request.character,['assetId','version','name'],['description','personality','scenario']);check(request.persona,['assetId','version','name','description']);check(request.opening,['id','text'])
  for(const item of [request.character,request.persona]){identifier(item.assetId);version(item.version);if(['name','description','personality','scenario'].some(key=>item[key]!==undefined&&typeof item[key]!=='string'))fail('LAUNCH_CONFLICT','保存的资产上下文类型无效。',409)}
  if(record.launchId!==request.launchId||semanticHash(request)!==record.fingerprint||typeof request.title!=='string'||typeof request.examples!=='string'||typeof request.opening.id!=='string'||typeof request.opening.text!=='string'||!isDeepStrictEqual(request.sources,normalizeBindings(request.sources)))fail('LAUNCH_CONFLICT','保存的启动审阅配置校验失败。',409)
  if(request.profile!==undefined){check(request.profile,['profileId','version']);identifier(request.profile.profileId);version(request.profile.version)}
  validateStorySeed(request)
  return copy(record)
}
export function createLaunchService({store,getGM,getDatabase,getLastStep}){
  const inFlight=new Map()
  const available=()=>getGM()?.apiVersion===1&&typeof getGM()?.startStory==='function'&&typeof getGM()?.binding==='function'&&getDatabase()?.apiVersion===2&&['database','bindSources','initializeStoryState'].every(name=>typeof getDatabase()?.[name]==='function')&&['profile','bindSession','ensureBuiltinProfile'].every(name=>typeof getLastStep()?.[name]==='function')
  async function verifySourcesAndProfile(request,signal){
    if(!available())fail('CAPABILITY_UNAVAILABLE','需要可用的 GM、Database v2 与 LastStep 启动服务。',409)
    for(const source of request.sources){const result=await getDatabase().database({databaseId:source.databaseId,version:source.version,signal});if(result?.database?.id!==source.databaseId||result.database.version!==source.version)fail('SOURCE_VERSION_UNAVAILABLE','所选资料版本不可用。',409)}
    if(request.profile){
      let result
      try{result=await getLastStep().profile(copy(request.profile),signal)}catch(error){if(error?.name==='AbortError')throw error;fail('PROFILE_NOT_FOUND','找不到所选预设版本，请明确选择可用版本或 GM 默认预设。',409)}
      if(result?.profile?.id!==request.profile.profileId||result.profile.version!==request.profile.version)fail('PROFILE_NOT_FOUND','找不到所选预设版本。',409)
      if(result.profile.status!=='ready')fail('PROFILE_NOT_READY','所选预设仍待审阅；请先在 LastStep 明确设为就绪。',409)
    }
    signal?.throwIfAborted()
  }
  async function progress(launchId,update){return store.updateInternal(data=>{const key=storageKey(launchId),record=data.launches?.[key];if(!record)fail('LAUNCH_NOT_FOUND','找不到保存的启动审阅记录。',404);const next={...record,...update};if(['starting','active'].includes(update.status))delete next.errorCode;const changed=semanticHash(next)!==semanticHash(record);if(changed)data.launches[key]=next;return{changed,result:{record:next}}})}
  async function dispatch(launchId,signal){
    const existing=inFlight.get(launchId);if(existing)return existing
    const promise=(async()=>{
      const record=(await store.rawState()).launches?.[storageKey(launchId)]
      if(!record)fail('LAUNCH_NOT_FOUND','找不到保存的启动审阅记录。',404)
      const request=validateReviewedLaunch(record).request
      if(request.launchId!==launchId)fail('LAUNCH_CONFLICT','保存的启动 ID 不同。',409)
      try{
        for(const kind of ['character','persona'])await store.asset({kind,assetId:request[kind].assetId,version:request[kind].version})
        await verifySourcesAndProfile(request,signal)
        if(record.sessionId){const binding=await getGM().binding({sessionId:record.sessionId,signal});if(binding?.launchId===launchId&&binding.status==='active'){await progress(launchId,{status:'active',sessionId:binding.sessionId});return{sessionId:binding.sessionId,binding,status:'active'}}}
        await progress(launchId,{status:'starting'})
        const result=await getGM().startStory({...request,signal})
        if(typeof result?.sessionId!=='string'||!['prepared','starting','active','failed'].includes(result.status)||!object(result.binding)||result.binding.launchId!==launchId)fail('UNAVAILABLE','GM 启动响应不完整。',503)
        await progress(launchId,{status:result.status,sessionId:result.sessionId})
        return copy(result)
      }catch(error){const code=typeof error?.code==='string'&&/^[A-Z0-9_-]+$/u.test(error.code)?error.code:error?.name==='AbortError'?'CANCELLED':'LAUNCH_FAILED';await progress(launchId,{status:'failed',errorCode:code});if(error?.name==='AbortError')throw error;throw new StoryKitError(code,'故事尚未完成启动；已保留审阅配置，可从待继续列表重试。',error?.status??503)}
    })()
    inFlight.set(launchId,promise)
    try{return await promise}finally{if(inFlight.get(launchId)===promise)inFlight.delete(launchId)}
  }
  return{
    available,
    async launch(input){
      const launchId=identifier(input.launchId,'启动 ID'),selectedCharacter=assetRef(input.character),selectedPersona=assetRef(input.persona),seed=validateStorySeed(input)
      if(!Array.isArray(input.sources))fail('INVALID_REQUEST','需要明确的资料来源数组。')
      const character=(await store.asset({kind:'character',...selectedCharacter})).asset,persona=(await store.asset({kind:'persona',...selectedPersona})).asset,opening=character.openings.find(item=>item.id===input.openingId)
      if(!opening)fail('OPENING_NOT_FOUND','所选资产版本没有该开场。',409)
      const choice=Object.hasOwn(input,'profile')?input.profile:character.profileRef??null
      let profile
      if(choice!==null){if(!object(choice)||Object.keys(choice).some(key=>!['profileId','version'].includes(key)))fail('INVALID_REQUEST','预设选择无效。');profile={profileId:identifier(choice.profileId),version:version(choice.version)}}
      const request={launchId,title:character.name,character:{...selectedCharacter,name:character.name,description:character.description,personality:character.personality,scenario:character.scenario},persona:{...selectedPersona,name:persona.name,description:persona.description},opening:{id:opening.id,text:opening.text},examples:character.examples,sources:normalizeBindings(input.sources),...profile?{profile}:{},...seed},fingerprint=semanticHash(request)
      await verifySourcesAndProfile(request,input.signal)
      await store.updateInternal(data=>{data.launches??={};const key=storageKey(launchId),existing=data.launches[key];if(existing){if(existing.fingerprint!==fingerprint)fail('LAUNCH_CONFLICT','launchId 已用于不同审阅配置；请创建新的启动。',409);return{changed:false}}data.launches[key]={launchId,fingerprint,request:copy(request),status:'prepared',createdAt:new Date().toISOString()};return{}},{signal:input.signal})
      return dispatch(launchId,input.signal)
    },
    resumeLaunch:({launchId,signal})=>dispatch(identifier(launchId),signal),
    async pendingLaunches({signal}={}){
      const records=Object.values((await store.rawState()).launches??{}),result=[]
      for(let record of records){signal?.throwIfAborted();if(record.status==='active')continue;if(record.sessionId&&typeof getGM()?.binding==='function'){try{const binding=await getGM().binding({sessionId:record.sessionId,signal});if(binding?.launchId===record.launchId&&binding.status==='active'){await progress(record.launchId,{status:'active'});continue}}catch(error){if(error?.name==='AbortError')throw error;record={...record,errorCode:typeof error?.code==='string'&&/^[A-Z0-9_-]+$/u.test(error.code)?error.code:'UNAVAILABLE'}}}
        result.push({launchId:record.launchId,title:record.request.title,status:['prepared','starting','failed'].includes(record.status)?record.status:'failed',...record.sessionId?{sessionId:record.sessionId}:{},...record.errorCode?{errorCode:record.errorCode}:{},createdAt:record.createdAt})
      }
      return result
    },
  }
}
