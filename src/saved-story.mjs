import {isDeepStrictEqual} from 'node:util'
import {copy,fail,normalizeBindings,object,StoryKitError} from './assets.mjs'
import {storageKey} from './store.mjs'
import {headerIdentity,headersEqual,semanticHash,serializableData,sessionIds,transferData} from './identity.mjs'
import {buildDependencySummary,collectAssetDefaults,collectAssetDependencies,mergeDatabaseRefs,mergeProfileRefs,validateDependencySummary} from './dependencies.mjs'

const ownerNames=['database','lastStep','gm','storyKit'],restoreOrder=['database','lastStep','context','gm','storyKit']
const packages={database:'dsh-rp-database',lastStep:'dsh-rp-last-step',context:'dsh-rp-context',gm:'dsh-rp-gm',storyKit:'dsh-rp-story-kit',loop:'dsh-loop-studio'}
const stages=new Set(['host.first','host.continuation','rp-gm.revise','rp-context.prepare','rp-context.summarize','rp-last-step.migrate','rp-last-step.assemble','rp-last-step.render'])
const queues=new Map()
function validationView(input){let view;try{view=copy(input)}catch{fail('RESTORE_PAYLOAD_INVALID','存档不能包含不可序列化内容。')}for(const row of Array.isArray(view?.sessions)?view.sessions:[])if(object(row?.header)&&Object.hasOwn(row.header,'delegationDepth')&&row.header.delegationDepth===undefined)delete row.header.delegationDepth;return view}
function minimalSnapshot(input){if(!object(input)||!Number.isSafeInteger(input.schemaVersion)||input.schemaVersion<1||typeof input.format!=='string'||typeof input.identityMode!=='string'||typeof input.exportedAt!=='string'||typeof input.selectedSessionId!=='string'||!input.selectedSessionId||!Array.isArray(input.sessions)||!object(input.pluginState)||!Array.isArray(input.resources)||!Array.isArray(input.requirements)||input.sessions.some(row=>!object(row)||!object(row.header)||typeof row.header.id!=='string'))fail('RESTORE_PAYLOAD_INVALID','存档传输 envelope 无效。');sessionIds(input.sessions.map(row=>row.header.id));serializableData(validationView(input))}
function snapshotFingerprint(input){const value=copy(input);value.pluginState.context??=null;value.sessions=value.sessions.map(row=>({...row,header:headerIdentity(row.header)})).sort((a,b)=>a.header.id.localeCompare(b.header.id));if(Array.isArray(value.loopPolicies))value.loopPolicies.sort((a,b)=>String(a.sessionId).localeCompare(String(b.sessionId)));return semanticHash(value)}
const sameSnapshots=(left,right)=>left.length===right.length&&left.every((row,index)=>headersEqual(row.header,right[index]?.header)&&row.inheritedEventCount===right[index]?.inheritedEventCount&&isDeepStrictEqual(row.events,right[index]?.events))
function fields(value,required,optional=[]){if(!object(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail('RESTORE_PAYLOAD_INVALID','存档字段不符合冻结合同。')}
function policy(value){fields(value,['enabled','routes']);if(typeof value.enabled!=='boolean'||!object(value.routes))fail('RESTORE_PAYLOAD_INVALID','Loop policy 无效。');for(const[nodeId,route]of Object.entries(value.routes)){fields(route,['provider','model'],['reasoningEffort','maxTokens']);if(!nodeId||typeof route.provider!=='string'||!route.provider||typeof route.model!=='string'||!route.model||route.reasoningEffort!==undefined&&(typeof route.reasoningEffort!=='string'||!route.reasoningEffort)||route.maxTokens!==undefined&&(!Number.isSafeInteger(route.maxTokens)||route.maxTokens<1))fail('RESTORE_PAYLOAD_INVALID','Loop route 无效。')}return copy(value)}
export function validateSavedStory(input){
  fields(input,['format','schemaVersion','identityMode','exportedAt','selectedSessionId','sessions','pluginState','resources','requirements'],['loopPolicies','dependencySummary'])
  if(input.format!=='dsh-rp-saved-story'||input.schemaVersion!==1||input.identityMode!=='preserve'||typeof input.exportedAt!=='string'||typeof input.selectedSessionId!=='string'||!Array.isArray(input.sessions)||!Array.isArray(input.resources)||!Array.isArray(input.requirements)||input.requirements.some(item=>typeof item!=='string'||!item))fail('RESTORE_PAYLOAD_INVALID','需要 exact-ID schemaVersion 1 的故事存档。')
  transferData(validationView(input))
  const snapshot=copy(input);fields(snapshot.pluginState,['database','lastStep','gm','storyKit'],['context']);snapshot.pluginState.context??=null
  for(const[name,state]of Object.entries(snapshot.pluginState))if(!(name==='context'&&state===null)&&(!object(state)||state.schemaVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!object(state.payload)))fail('RESTORE_PAYLOAD_INVALID','插件存档状态无效。')
  const byId=new Map()
  for(const session of snapshot.sessions){
    fields(session,['header','events','inheritedEventCount'])
    if(!object(session.header)||typeof session.header.id!=='string'||!session.header.id||byId.has(session.header.id)||!Array.isArray(session.events)||!Number.isSafeInteger(session.inheritedEventCount)||session.inheritedEventCount<0||session.inheritedEventCount>session.events.length)fail('RESTORE_PAYLOAD_INVALID','Session 身份或 inheritedEventCount 无效。')
    for(const[eventIndex,event]of session.events.entries())if(!object(event)||event.seq!==eventIndex||typeof event.type!=='string'||!event.type||event.sourceEventSeqs!==undefined&&(!Array.isArray(event.sourceEventSeqs)||event.sourceEventSeqs.some(seq=>!Number.isSafeInteger(seq)||seq<0||seq>=eventIndex)||new Set(event.sourceEventSeqs).size!==event.sourceEventSeqs.length))fail('RESTORE_PAYLOAD_INVALID','Session 事件序列或来源无效。')
    byId.set(session.header.id,session)
  }
  const ordered=[],seen=new Set();let id=snapshot.selectedSessionId
  while(id!=null){if(typeof id!=='string'||!id||seen.has(id)||!byId.has(id))fail('RESTORE_PAYLOAD_INVALID','缺少必需祖先会话，或 ancestry 存在循环。');seen.add(id);const session=byId.get(id);ordered.unshift(session);id=session.header.parentSession??null}
  if(seen.size!==byId.size)fail('RESTORE_PAYLOAD_INVALID','存档包含所选故事 ancestry 之外的 Session。')
  snapshot.sessions=ordered
  if(snapshot.loopPolicies!==undefined){if(!Array.isArray(snapshot.loopPolicies))fail('RESTORE_PAYLOAD_INVALID','Loop policy 列表无效。');const ids=new Set();for(const row of snapshot.loopPolicies){fields(row,['sessionId','policy']);if(!seen.has(row.sessionId)||ids.has(row.sessionId))fail('RESTORE_PAYLOAD_INVALID','Loop policy 的会话范围无效。');ids.add(row.sessionId);row.policy=policy(row.policy)}}
  if(snapshot.dependencySummary!==undefined)validateDependencySummary(snapshot.dependencySummary)
  return snapshot
}
const safeCode=error=>typeof error?.code==='string'&&/^[A-Z0-9_-]+$/u.test(error.code)?error.code:error?.name==='AbortError'?'CANCELLED':'UNAVAILABLE'
export function createSavedStoryCoordinator({store,host,getOwner}){
  const has=(name,methods)=>{const service=getOwner(name);return!!service&&methods.every(method=>typeof service[method]==='function')&&service.available?.()!==false}
  const compatible=()=>getOwner('database')?.apiVersion===2&&getOwner('gm')?.apiVersion===1
  const exportAvailable=()=>compatible()&&host.readable()&&ownerNames.every(name=>has(name,['exportState','contentRevision']))&&(!getOwner('context')||has('context',['exportState','contentRevision']))&&(!getOwner('loop')||has('loop',['inspect','savePolicy']))&&has('gm',['binding'])
  const restoreAvailable=()=>compatible()&&host.restorable()&&ownerNames.every(name=>has(name,['preflightRestore','restoreState','contentRevision']))&&has('gm',['binding','reserveRestore','activateRestored'])&&has('lastStep',['profile'])
  async function initialDependencies(ids,signal,code){const profiles=[],databases=[];for(const sessionId of ids){const binding=await getOwner('gm').binding({sessionId,signal}),profile=binding?.profile;if(typeof profile?.profileId!=='string'||!profile.profileId||!Number.isSafeInteger(profile.version)||profile.version<1||!Array.isArray(binding.sources))throw new StoryKitError(code,'缺少可解析的 GM 初始资料或文风引用。',409,[{owner:'gm',ref:{sessionId}}]);profiles.push(profile);databases.push(...normalizeBindings(binding.sources))}return{additionalProfileRefs:mergeProfileRefs(profiles),additionalDatabaseRefs:mergeDatabaseRefs(databases)}}
  async function summary(defaults,sessionId,signal){if(!has('database',['effectiveV2'])||!has('lastStep',['state']))return undefined;try{const database=await getOwner('database').effectiveV2({sessionId,signal}),lastStep=await getOwner('lastStep').state(sessionId,signal);if(!Array.isArray(database.binding?.sources)||typeof lastStep.binding?.profileId!=='string'||!Number.isSafeInteger(lastStep.binding?.version))return undefined;return buildDependencySummary(defaults,{sources:database.binding.sources,profile:{profileId:lastStep.binding.profileId,version:lastStep.binding.version}})}catch(error){if(error?.name==='AbortError')throw error;return undefined}}
  async function verifyLibraries(dependencies,ids,signal){
    const initial=await initialDependencies(ids,signal,'RESTORE_REQUIREMENT_MISSING'),profiles=mergeProfileRefs(dependencies.additionalProfileRefs,initial.additionalProfileRefs),databases=mergeDatabaseRefs(dependencies.additionalDatabaseRefs,initial.additionalDatabaseRefs)
    const missing=(owner,ref)=>new StoryKitError('RESTORE_REQUIREMENT_MISSING','固定资产或初始来源的精确库版本尚未恢复或暂不可读。',409,[{owner,ref:copy(ref)}])
    for(const ref of databases){
      if(!has('database',['database']))throw missing('database',ref)
      let result
      try{result=await getOwner('database').database({...ref,signal})}catch(error){if(error?.name==='AbortError')throw error;throw missing('database',ref)}
      if(result?.database?.id!==ref.databaseId||result.database.version!==ref.version)throw missing('database',ref)
    }
    for(const ref of profiles){
      if(!has('lastStep',['profile']))throw missing('lastStep',ref)
      let result
      try{result=await getOwner('lastStep').profile(copy(ref),signal)}catch(error){if(error?.name==='AbortError')throw error;throw missing('lastStep',ref)}
      if(result?.profile?.id!==ref.profileId||result.profile.version!==ref.version)throw missing('lastStep',ref)
    }
  }
  async function exportOwner(name,args,refs){try{return await getOwner(name).exportState(args)}catch(error){if(error?.code!=='EXPORT_REQUIREMENT_MISSING')throw error;const idField=name==='database'?'databaseId':'profileId',candidate=error.ref??error,safe=typeof candidate?.[idField]==='string'&&Number.isSafeInteger(candidate.version)&&candidate.version>0?[{[idField]:candidate[idField],version:candidate.version}]:refs;throw new StoryKitError('EXPORT_REQUIREMENT_MISSING','缺少明确引用的固定库版本；未替换为其他版本。',409,(safe.length?safe:[null]).map(ref=>({code:'EXPORT_REQUIREMENT_MISSING',owner:name,...ref?{ref}:{}})))}}
  async function readChain(sessionId,signal){const result=[],seen=new Set();let id=sessionId;while(id!=null){if(seen.has(id))fail('RESTORE_PAYLOAD_INVALID','会话 ancestry 循环。');seen.add(id);const observed=await host.readSession({sessionId:id,signal}),inbox=observed.projections?.values?.inbox;if(inbox?.['next-turn']?.length||inbox?.['next-step']?.length)fail('EXPORT_CHANGED','故事仍有待执行输入，请处理后显式重试。',409);if(!Number.isSafeInteger(observed.inheritedEventCount)||observed.inheritedEventCount<0||observed.inheritedEventCount>observed.events.length)fail('EXPORT_SOURCE_METADATA_MISSING','缺少权威 inheritedEventCount。',409);result.unshift({header:copy(observed.header),events:copy(observed.events),inheritedEventCount:observed.inheritedEventCount});id=observed.header.parentSession??null}return result}
  const journal=async()=>Object.values((await store.rawState()).restoreJobs??{})
  async function inspect(input,{restoreId,signal}={}){
    let snapshot
    try{snapshot=validateSavedStory(input)}catch(error){return{supported:false,conflicts:[{code:safeCode(error),id:'snapshot'}],requirements:[],identityMode:'preserve',deferredChecks:[]}}
    const ids=snapshot.sessions.map(item=>item.header.id),fingerprint=snapshotFingerprint(snapshot),jobs=await journal(),job=restoreId?jobs.find(item=>item.restoreId===restoreId):jobs.find(item=>item.fingerprint===fingerprint&&item.status!=='complete'),conflicts=[],requirements=[],deferredChecks=[]
    if(job&&job.fingerprint!==fingerprint)conflicts.push({code:'RESTORE_ID_CONFLICT',id:restoreId??job.restoreId})
    if(!host.restorable())requirements.push('host-session-restore')
    if(getOwner('database')?.apiVersion!==2)requirements.push(packages.database+':api-v2')
    if(getOwner('gm')?.apiVersion!==1)requirements.push(packages.gm+':api-v1')
    for(const name of ownerNames)if(!has(name,['preflightRestore','restoreState','contentRevision']))requirements.push(packages[name])
    if(!has('gm',['reserveRestore','activateRestored','binding']))requirements.push(packages.gm)
    if(!has('lastStep',['profile']))requirements.push(packages.lastStep+':profile-read')
    let dependencies
    try{dependencies=collectAssetDependencies(snapshot.pluginState.storyKit)}catch{conflicts.push({code:'RESTORE_PAYLOAD_INVALID',id:'storyKit-defaults'})}
    if(dependencies?.additionalDatabaseRefs.length&&!has('database',['database']))requirements.push(packages.database+':library-read')
    const knownPackages=new Set([...ownerNames.map(name=>packages[name]),...getOwner('context')?[packages.context]:[],...getOwner('loop')?[packages.loop]:[]])
    for(const name of snapshot.requirements)if(!knownPackages.has(name))requirements.push(name)
    for(const session of snapshot.sessions){
      signal?.throwIfAborted();const other=jobs.find(item=>item.restoreId!==(job?.restoreId??restoreId)&&item.sessionIds?.includes(session.header.id))
      if(other){conflicts.push({code:'RESTORE_ID_CONFLICT',id:session.header.id});continue}
      const existing=await host.statSession({sessionId:session.header.id,signal})
      if(existing&&(!job?.createdIds?.includes(session.header.id)||typeof host.checkExisting==='function'&&!await host.checkExisting({session,signal,allowSuffix:job.resumeStarted?.includes(session.header.id)||job.resumed?.includes(session.header.id)||job.activationStarted===true}))){conflicts.push({code:'RESTORE_ID_CONFLICT',id:session.header.id});continue}
      try{requirements.push(...(await host.analyzeSession({session,signal})).requirements)}catch(error){conflicts.push({code:safeCode(error),id:session.header.id})}
    }
    const finalizing=job?.activationStarted===true&&ownerNames.every(name=>job.plugins?.includes(name))&&(snapshot.pluginState.context===null||job.plugins?.includes('context'))
    for(const name of restoreOrder){
      const state=snapshot.pluginState[name]
      if(state===null){if(getOwner('context')&&!has('context',['state','configure']))requirements.push(packages.context+':configure');continue}
      if(!has(name,['preflightRestore','restoreState','contentRevision'])){requirements.push(packages[name]);continue}
      if(finalizing)continue
      try{const result=await getOwner(name).preflightRestore({sessionIds:ids,state,signal});conflicts.push(...result.conflicts??[]);requirements.push(...result.requirements??[]);if(result.supported!==true&&!(result.conflicts?.length||result.requirements?.length))conflicts.push({code:'RESTORE_PAYLOAD_INVALID',id:name})}catch(error){conflicts.push({code:safeCode(error),id:name})}
    }
    for(const resource of snapshot.resources){const same=snapshot.pluginState.storyKit.payload.resources?.find(item=>item.id===resource.id);if(!same||!isDeepStrictEqual(same,resource))requirements.push(`resource-owner:${resource?.id??'missing'}`)}
    for(const row of snapshot.loopPolicies??[]){
      if(!has('loop',['inspect','savePolicy']))requirements.push(packages.loop)
      const nodeIds=Object.keys(row.policy.routes)
      for(const node of nodeIds){if(!stages.has(node))requirements.push(`loop-node:${node}`);else if(node.startsWith('rp-context.')&&!getOwner('context'))requirements.push(packages.context);else if(node.startsWith('rp-last-step.')&&!getOwner('lastStep'))requirements.push(packages.lastStep);requirements.push(...await host.modelRequirements(row.policy.routes[node],signal))}
      if(nodeIds.length)deferredChecks.push({code:'LOOP_NODE_VALIDATION',sessionId:row.sessionId,nodeIds})
    }
    return{supported:!conflicts.length&&!requirements.length,conflicts,requirements:[...new Set(requirements)],identityMode:'preserve',deferredChecks,snapshot,ids,fingerprint,job}
  }
  async function mark(restoreId,fingerprint,update){const result=await store.updateInternal(data=>{const job=data.restoreJobs?.[storageKey(restoreId)];if(!job||job.fingerprint!==fingerprint)fail('RESTORE_ID_CONFLICT','恢复任务身份不同。',409);Object.assign(job,copy(update));return{result:{job}}});return result.job}
  async function execute({snapshot:input,restoreId,signal}){
    if(typeof restoreId!=='string'||!restoreId.trim())fail('RESTORE_PAYLOAD_INVALID','需要明确的恢复任务 ID。')
    minimalSnapshot(input)
    const fingerprint=snapshotFingerprint(input),key=storageKey(restoreId),prior=(await store.rawState()).restoreJobs?.[key]
    if(prior&&prior.fingerprint!==fingerprint)fail('RESTORE_ID_CONFLICT','restoreId 已用于不同内容或会话集合。',409)
    if(prior?.status==='complete'){if(input.sessions.some(session=>!prior.createdIds?.includes(session.header.id)))fail('RESTORE_ID_CONFLICT','旧任务没有可验证的 Session 创建记录，不能认领既有 ID。',409);return{status:'complete',sessionId:input.selectedSessionId,diagnostics:[]}}
    const snapshot=validateSavedStory(input),ids=snapshot.sessions.map(item=>item.header.id)
    const preview=await inspect(snapshot,{restoreId,signal})
    if(!preview.supported){const code=preview.conflicts[0]?.code??'RESTORE_REQUIREMENT_MISSING';throw new StoryKitError(code,'存档尚未通过身份、内容或依赖预检；目标未开始导入。',409,[...preview.conflicts,...preview.requirements.map(requirement=>({code:'RESTORE_REQUIREMENT_MISSING',requirement}))])}
    let job=(await store.updateInternal(data=>{data.restoreJobs??={};const previous=data.restoreJobs[key];if(previous)return{changed:false,result:{job:previous}};const next={restoreId,fingerprint,sessionIds:ids,selectedSessionId:snapshot.selectedSessionId,status:'pending',createdIds:[],imported:[],validated:[],plugins:[],resumeStarted:[],resumed:[],loopApplied:[],contextDisabled:[],reserved:false,activationStarted:false,createdAt:new Date().toISOString()};data.restoreJobs[key]=next;return{result:{job:next}}})).job
    const add=async(field,value)=>{job=await mark(restoreId,fingerprint,{[field]:[...new Set([...(job[field]??[]),value])]})}
    try{
      signal?.throwIfAborted()
      if(!job.reserved){await getOwner('gm').reserveRestore({restoreId,sessionIds:ids,signal});job=await mark(restoreId,fingerprint,{reserved:true})}
      for(const session of snapshot.sessions){const id=session.header.id;signal?.throwIfAborted();const existing=await host.statSession({sessionId:id,signal});if(!job.imported.includes(id)||!existing){await host.writeSession({session,owned:job.createdIds?.includes(id)===true,signal,onCreated:()=>add('createdIds',id)});await add('imported',id)}if(!job.validated.includes(id)){await host.coldValidate({session,signal});await add('validated',id)}}
      for(const name of restoreOrder){if(snapshot.pluginState[name]===null||job.plugins.includes(name))continue;signal?.throwIfAborted();const owner=getOwner(name),{revision}=await owner.contentRevision({signal}),result=await owner.restoreState({restoreId,sessionIds:ids,state:snapshot.pluginState[name],expectedRevision:revision,signal});if(!Array.isArray(result.restoredSessionIds)||ids.some(id=>!result.restoredSessionIds.includes(id)))fail('RESTORE_REQUIREMENT_MISSING','插件尚未确认全部目标会话状态。',409);await add('plugins',name)}
      await verifyLibraries(collectAssetDependencies(snapshot.pluginState.storyKit),ids,signal)
      if(snapshot.pluginState.context===null&&getOwner('context'))for(const id of ids){if(job.contextDisabled.includes(id))continue;const context=getOwner('context'),state=await context.state({sessionId:id,signal});if(!object(state.settings)||!Number.isSafeInteger(state.revision))fail('RESTORE_REQUIREMENT_MISSING','Context 配置响应无效。',409);if(state.settings.enabled!==false)await context.configure({sessionId:id,settings:{...state.settings,enabled:false},expectedRevision:state.revision,signal});await add('contextDisabled',id)}
      for(const session of snapshot.sessions){signal?.throwIfAborted();if(!job.resumeStarted?.includes(session.header.id))await add('resumeStarted',session.header.id);await host.resumeSession({session,signal});if(!job.resumed.includes(session.header.id))await add('resumed',session.header.id)}
      for(const row of snapshot.loopPolicies??[]){
        signal?.throwIfAborted();const loop=getOwner('loop'),view=await loop.inspect(row.sessionId,signal)
        if(Object.keys(row.policy.routes).some(id=>!view.graph?.nodes?.some(node=>node.id===id&&node.control==='route')))fail('RESTORE_REQUIREMENT_MISSING','恢复后的实际执行图不支持保存的 route；配置已保留，尚未激活。',409)
        if(!isDeepStrictEqual(view.policies?.session,row.policy))await loop.savePolicy({sessionId:row.sessionId,scope:'session',policy:row.policy,expectedRevision:view.revision},signal)
        if(!job.loopApplied.includes(row.sessionId))await add('loopApplied',row.sessionId)
      }
      const confirmed=async()=>{for(const id of ids){const binding=await getOwner('gm').binding({sessionId:id,signal}),association=snapshot.pluginState.storyKit.payload.sessionAssets?.find(item=>item.sessionId===id);if(!binding||binding.sessionId!==id||binding.status==='restoring'||!association||['character','persona'].some(kind=>binding[kind]?.assetId!==association[kind]?.assetId||binding[kind]?.version!==association[kind]?.version))return false}return true}
      signal?.throwIfAborted();const alreadyActivated=job.activationStarted&&await confirmed();job=await mark(restoreId,fingerprint,{activationStarted:true})
      if(!alreadyActivated)await getOwner('gm').activateRestored({restoreId,sessionIds:ids,signal})
      if(!await confirmed())fail('RESTORE_REQUIREMENT_MISSING','GM 尚未确认恢复激活。',409)
      await mark(restoreId,fingerprint,{status:'complete',errorCode:null})
      return{status:'complete',sessionId:snapshot.selectedSessionId,diagnostics:[]}
    }catch(error){const code=safeCode(error),status=code==='RESTORE_PAYLOAD_INVALID'?'failed':'pending';await mark(restoreId,fingerprint,{status,errorCode:code});if(code==='RESTORE_ID_CONFLICT')throw new StoryKitError(code,'目标 ID 没有本任务的创建证据，或已被其他操作占用；未认领该 Session。',409);return{status,sessionId:snapshot.selectedSessionId,diagnostics:[{code,message:'恢复进度已保留，故事尚未完成激活；请修复明确依赖后使用同一恢复任务 ID 继续。'}]}}
  }
  return{
    exportAvailable,previewAvailable:restoreAvailable,restoreAvailable,
    async exportSavedStory({sessionId,signal}){
      if(!exportAvailable())fail('RESTORE_REQUIREMENT_MISSING','缺少完整的故事状态导出服务。',409)
      const first=await readChain(sessionId,signal),ids=first.map(item=>item.header.id),binding=await getOwner('gm').binding({sessionId,signal})
      if(!binding||binding.status!=='active')fail('EXPORT_CHANGED','仅可导出空闲且已正式开始的通用 GM 故事。',409)
      return host.withIdleSessions({sessionIds:ids,signal},async maintainedSignal=>{
        const combined=signal?AbortSignal.any([signal,maintainedSignal]):maintainedSignal,sessions=await readChain(sessionId,combined)
        if(!isDeepStrictEqual(ids,sessions.map(item=>item.header.id)))fail('EXPORT_CHANGED','故事 ancestry 在导出时变化。',409)
        const names=[...ownerNames,...getOwner('context')?['context']:[]],before={},pluginState={context:null}
        for(const name of names)before[name]=(await getOwner(name).contentRevision({signal:combined})).revision
        const loopPolicies=[],loopRevisions={}
        if(getOwner('loop')){if(!has('loop',['inspect','savePolicy']))fail('RESTORE_REQUIREMENT_MISSING','Loop policy 服务不完整。',409);for(const id of ids){const view=await getOwner('loop').inspect(id,combined);loopPolicies.push({sessionId:id,policy:policy(view.effectivePolicy)});loopRevisions[id]=view.revision}}
        pluginState.storyKit=await getOwner('storyKit').exportState({sessionIds:ids,signal:combined})
        const dependencies=collectAssetDependencies(pluginState.storyKit),initial=await initialDependencies(ids,combined,'EXPORT_REQUIREMENT_MISSING'),additionalDatabaseRefs=mergeDatabaseRefs(dependencies.additionalDatabaseRefs,initial.additionalDatabaseRefs),additionalProfileRefs=mergeProfileRefs(dependencies.additionalProfileRefs,initial.additionalProfileRefs),dependencySummary=await summary(collectAssetDefaults(pluginState.storyKit),sessionId,combined)
        for(const name of names){if(name==='storyKit')continue;const args={sessionIds:ids,signal:combined,...name==='database'?{additionalDatabaseRefs}:name==='lastStep'?{additionalProfileRefs}:{}};pluginState[name]=await exportOwner(name,args,name==='database'?additionalDatabaseRefs:name==='lastStep'?additionalProfileRefs:[])}
        for(const name of names){const after=(await getOwner(name).contentRevision({signal:combined})).revision;if(after!==before[name]||pluginState[name].revision!==after)fail('EXPORT_CHANGED','故事内容在导出期间变化，请显式重试。',409)}
        if(!sameSnapshots(sessions,await readChain(sessionId,combined)))fail('EXPORT_CHANGED','会话事件在导出期间变化，请显式重试。',409)
        if(getOwner('loop'))for(const row of loopPolicies){const view=await getOwner('loop').inspect(row.sessionId,combined);if(view.revision!==loopRevisions[row.sessionId]||!isDeepStrictEqual(view.effectivePolicy,row.policy))fail('EXPORT_CHANGED','Loop policy 在导出期间变化。',409)}
        const snapshot=validateSavedStory({format:'dsh-rp-saved-story',schemaVersion:1,identityMode:'preserve',exportedAt:new Date().toISOString(),selectedSessionId:sessionId,sessions,pluginState,resources:[],requirements:[...names.map(name=>packages[name]),...getOwner('loop')?[packages.loop]:[]],...getOwner('loop')?{loopPolicies}:{},...dependencySummary?{dependencySummary}:{}})
        return{snapshot}
      })
    },
    async previewSavedStory({snapshot,signal}){const result=await inspect(snapshot,{signal});return{...Object.fromEntries(['supported','conflicts','requirements','identityMode','deferredChecks'].map(key=>[key,result[key]])),...result.snapshot?.dependencySummary?{dependencySummary:copy(result.snapshot.dependencySummary)}:{}}},
    async restoreSavedStory(input){const pending=(queues.get(store.storageKey)??Promise.resolve()).then(()=>execute(input)),settled=pending.then(()=>{},()=>{});queues.set(store.storageKey,settled);void settled.then(()=>{if(queues.get(store.storageKey)===settled)queues.delete(store.storageKey)});return pending},
  }
}
