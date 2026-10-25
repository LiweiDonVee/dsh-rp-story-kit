import {isDeepStrictEqual} from 'node:util'
import {copy,fail,object} from './assets.mjs'
import {headersEqual} from './identity.mjs'

function resumeSuffix(events,count){if(events.length===count)return true;if(events.length!==count+1)return false;const event=events[count];return event.seq===count&&event.type==='session/end-seed'&&Number.isFinite(event.time)&&isDeepStrictEqual(event.data,{})&&Object.keys(event).every(key=>['seq','type','time','data'].includes(key))}

export function createNativeSessionAdapter(ctx){
  const get=name=>ctx.get?.(name)??ctx[name],handles=new Map()
  const readable=()=>typeof get('sessionQuery')?.observeSession==='function'&&typeof get('typertGateway')?.stream==='function'&&!!get('connection')?.browserPeer
  const restorable=()=>readable()&&['create','open','stat'].every(name=>typeof get('sessionPersistence')?.[name]==='function')&&typeof get('sessions')?.prepare==='function'&&typeof get('sessionProjections')?.hydrate==='function'&&typeof get('agents')?.resume==='function'&&typeof get('agentPresets')?.mount==='function'&&typeof get('agentPresets')?.list==='function'&&typeof get('llm')?.prepareCall==='function'
  async function authorize(sessionId,signal){
    if(!readable())fail('RESTORE_REQUIREMENT_MISSING','宿主缺少授权的会话读取能力。',409)
    signal?.throwIfAborted();let iterator
    try{const stream=await get('typertGateway').stream({namespace:'session',method:'follow',args:{request:{address:{kind:'session',sessionId},maxMessages:1}},peer:get('connection').browserPeer,signal});iterator=stream[Symbol.asyncIterator]();const first=await iterator.next();if(first.done||first.value?.header?.id!==sessionId)fail('SESSION_NOT_FOUND','找不到故事。',404)}catch(error){if(error?.name==='AbortError')throw error;if(['gateway/forbidden','gateway/access-denied'].includes(error?.code)||error?.status===403)fail('FORBIDDEN','没有读取该故事的权限。',403);throw error}finally{await iterator?.return?.()}
  }
  async function readSession({sessionId,signal,authorize:check=true}){
    if(check)await authorize(sessionId,signal)
    const query=get('sessionQuery');if(typeof query?.observeSession!=='function')fail('RESTORE_REQUIREMENT_MISSING','宿主缺少 Session observation。',409)
    signal?.throwIfAborted();const observation=await query.observeSession(sessionId,{signal,projectionMode:'all'})
    try{
      const result={header:copy(observation.header),events:copy(observation.events),inheritedEventCount:observation.inheritedEventCount,...observation.projections?{projections:copy(observation.projections)}:{}}
      if(result.header?.id!==sessionId||!Array.isArray(result.events))fail('RESTORE_PAYLOAD_INVALID','宿主返回的会话内容无效。')
      if(!Number.isSafeInteger(result.inheritedEventCount)||result.inheritedEventCount<0||result.inheritedEventCount>result.events.length)fail('EXPORT_SOURCE_METADATA_MISSING','宿主 observation 缺少有效 inheritedEventCount。',409)
      return result
    }finally{observation[Symbol.dispose]?.()}
  }
  async function modelRequirements(config,signal){
    if(!object(config)||typeof config.provider!=='string'||typeof config.model!=='string')return['model-selection']
    if(typeof get('llm')?.prepareCall!=='function')return['host-model-capabilities']
    try{await get('llm').prepareCall(copy(config),signal);return[]}catch(error){if(error?.name==='AbortError')throw error;return[`model:${config.provider}/${config.model}`]}
  }
  async function analyzeSession({session,signal}){
    if(!restorable())return{requirements:['host-session-restore']}
    signal?.throwIfAborted();let prepared,projections,header
    try{
      const live=get('sessions')?.get?.(session.header.id)
      if(live){const observed=await readSession({sessionId:session.header.id,signal,authorize:false});if(!headersEqual(observed.header,session.header)||!isDeepStrictEqual(observed.events.slice(0,session.events.length),session.events))fail('RESTORE_ID_CONFLICT','目标 Session 与保留的恢复前缀不同。',409);projections=observed.projections;header=live.requestHeader?.()}
      else{prepared=get('sessions').prepare(session.header.id,{seed:copy(session.events),meta:copy(session.header),inheritedEventCount:session.inheritedEventCount,eventState:'detached'});projections=get('sessionProjections').hydrate(prepared,{},session.events,0);header=prepared.requestHeader?.()}
      const presetId=projections?.values?.agentPreset??session.header.agentPreset,selection=projections?.values?.modelSelection?.next??projections?.values?.modelSelection?.lastUsed??header?.config
      const config=selection?Object.fromEntries(['provider','model','reasoningEffort','maxTokens'].filter(key=>selection[key]!==undefined).map(key=>[key,selection[key]])):null
      if(config&&header?.config?.maxTokens!==undefined&&header.adapterDefaults?.maxTokens!==true)config.maxTokens=header.config.maxTokens
      const presets=await get('agentPresets').list(),requirements=[]
      if(typeof presetId!=='string'||!Array.isArray(presets)||!presets.some(preset=>preset.id===presetId&&!preset.broken))requirements.push(`preset:${presetId??'missing'}`)
      const inbox=projections?.values?.inbox
      if(inbox?.['next-turn']?.length||inbox?.['next-step']?.length)requirements.push(`idle-empty-inbox:${session.header.id}`)
      requirements.push(...await modelRequirements(config,signal))
      return{requirements,presetId,...config?{selection:config}:{}}
    }finally{prepared?.[Symbol.dispose]?.()}
  }
  async function statSession({sessionId,signal}){signal?.throwIfAborted();const live=get('sessions')?.get?.(sessionId);if(live)return{header:copy(live.header),live:true};return await get('sessionPersistence')?.stat(sessionId,{signal})??null}
  async function verifyResumed(session,signal){const actual=await readSession({sessionId:session.header.id,signal,authorize:false});if(!headersEqual(actual.header,session.header)||actual.inheritedEventCount!==session.inheritedEventCount||!isDeepStrictEqual(actual.events.slice(0,session.events.length),session.events)||!resumeSuffix(actual.events,session.events.length))fail('RESTORE_PAYLOAD_INVALID','安全 resume 改变了原始前缀，或产生了未验证的额外事件。')}
  return{
    readable,restorable,readSession,analyzeSession,modelRequirements,statSession,
    async withIdleSessions({sessionIds,signal},work){
      const ids=[...sessionIds].sort()
      const enter=async(index,combined)=>{combined.throwIfAborted();if(index===ids.length){await get('sessionPersistence')?.flush?.();return work(combined)}const agent=get('agents')?.get?.(ids[index]);if(!agent)return enter(index+1,combined);if(typeof agent.runMaintenance!=='function'||agent.status==='running'||agent.inbox?.nextTurn?.length||agent.inbox?.nextStep?.length)fail('EXPORT_CHANGED','故事正在运行或有待执行输入，请空闲后重新导出。',409);try{return await agent.runMaintenance(maintenanceSignal=>enter(index+1,AbortSignal.any([combined,maintenanceSignal])))}catch(error){if(error?.name==='AbortError'||error?.code)throw error;fail('EXPORT_CHANGED','故事在导出期间开始了其他操作。',409)}}
      return enter(0,signal??new AbortController().signal)
    },
    async checkExisting({session,signal,allowSuffix=false}){
      const existing=await statSession({sessionId:session.header.id,signal});if(!existing)return true
      let handle
      try{handle=await get('sessionPersistence').open(session.header.id,'read',{signal});const{events}=await handle.read(0,undefined,{signal});return headersEqual(handle.header,session.header)&&handle.inheritedEventCount===session.inheritedEventCount&&Array.isArray(events)&&(events.length<=session.events.length||allowSuffix&&resumeSuffix(events,session.events.length))&&isDeepStrictEqual(events.slice(0,session.events.length),session.events.slice(0,events.length))}finally{await handle?.close()}
    },
    async writeSession({session,owned,signal,onCreated}){
      if(!restorable())fail('RESTORE_REQUIREMENT_MISSING','宿主恢复接口不可用。',409)
      const existing=await statSession({sessionId:session.header.id,signal})
      if(existing&&!owned)fail('RESTORE_ID_CONFLICT','目标已存在相同 Session ID。',409)
      let handle
      try{
        if(existing)handle=await get('sessionPersistence').open(session.header.id,'write',{signal})
        else{
          try{handle=await get('sessionPersistence').create(copy(session.header),{inheritedEventCount:session.inheritedEventCount,signal})}catch(error){if(['SessionAlreadyExistsError','SessionAlreadyOwnedError'].includes(error?.name)||['SESSION_ALREADY_EXISTS','SESSION_ALREADY_OWNED'].includes(error?.code))fail('RESTORE_ID_CONFLICT','目标 ID 在公开 create 前被其他操作占用。',409);throw error}
          await handle.flush()
          await onCreated?.()
        }
        const current=await handle.read(0,undefined,{signal}),events=current.events
        if(!headersEqual(handle.header,session.header)||handle.inheritedEventCount!==session.inheritedEventCount||events.length>session.events.length||!isDeepStrictEqual(events,session.events.slice(0,events.length)))fail('RESTORE_ID_CONFLICT','已有恢复前缀与原始 Session 不同。',409)
        signal?.throwIfAborted();if(events.length<session.events.length)await handle.append(copy(session.events.slice(events.length)))
        await handle.flush()
      }finally{await handle?.close()}
    },
    async coldValidate({session,signal}){
      if(get('agents')?.get?.(session.header.id))fail('RESTORE_ID_CONFLICT','冷验证前目标 Agent 已激活。',409)
      const actual=await readSession({sessionId:session.header.id,signal,authorize:false})
      if(!headersEqual(actual.header,session.header)||!isDeepStrictEqual(actual.events,session.events)||actual.inheritedEventCount!==session.inheritedEventCount)fail('RESTORE_PAYLOAD_INVALID','宿主冷验证与原始 Session 前缀不一致。')
      return actual
    },
    async resumeSession({session,signal}){
      if(get('agents')?.get?.(session.header.id)){await verifyResumed(session,signal);return{sessionId:session.header.id}}
      const analysis=await analyzeSession({session,signal});if(analysis.requirements.length)fail('RESTORE_REQUIREMENT_MISSING','恢复所需 preset 或模型不可用。',409)
      const handle=await get('agents').resume({resumeSessionId:session.header.id,agentOptions:analysis.selection,signal,setup:async agentCtx=>{await get('agentPresets').mount(agentCtx,analysis.presetId)}})
      try{if(handle.agent.id!==session.header.id)fail('RESTORE_ID_CONFLICT','resume 返回了不同 Session 身份。',409);await verifyResumed(session,signal)}catch(error){await handle.dispose();throw error}
      handles.set(session.header.id,handle)
      return{sessionId:handle.agent.id}
    },
    async close(){for(const handle of handles.values())await handle.dispose();handles.clear()},
  }
}
