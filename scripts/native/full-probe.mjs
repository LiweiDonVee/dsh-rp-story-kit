import {randomUUID} from 'node:crypto'
import {createFullModels} from './full-models.mjs'
export const name='story-kit-full-native-probe'
export const inject=['connection','llm','agents','tools','typertGateway','sessionQuery','sessionPersistence','agentPresets']
export function apply(ctx){
  const local=createFullModels(),executions=[],disposers=[]
  const adapter={providerInfo:id=>({id,name:'Local Story Kit final acceptance'}),providerRetryPolicy:()=>undefined,imageRequestPricing:()=>undefined,imageRequestTarget:(_p,_m,value)=>value,listModels:async provider=>['main','writer','writer-alt'].map(id=>({provider,id,name:id})),resolveModel:async(provider,id)=>{if(provider!=='story-kit-full-local'||!['main','writer','writer-alt'].includes(id))throw Error('LOCAL_MODEL_UNKNOWN');return{provider,id,name:id}},async prepareCall(provider,id){return{model:await this.resolveModel(provider,id),stream:options=>local.stream(id,options)}}}
  disposers.push(ctx.llm.registerAdapter(['story-kit-full-local'],adapter))
  disposers.push(ctx.on('tools/execute',async(exec,next)=>{const result=await next();executions.push({sessionId:exec.agent.session.id,name:exec.name,isError:result.isError,value:result.value});return result}))
  const get=name=>ctx.get(name),invoke=(method,request,signal)=>ctx.typertGateway.invoke({namespace:'session',method,args:{request},peer:ctx.connection.browserPeer,signal})
  async function observed(sessionId){const view=await ctx.sessionQuery.observeSession(sessionId);try{return{header:view.header,events:view.events,inheritedEventCount:view.inheritedEventCount,live:!!ctx.agents.get(sessionId),inbox:structuredClone(view.projections?.values?.inbox??null)}}finally{view[Symbol.dispose]()}}
  async function snapshot(sessionId){
    const result=await observed(sessionId)
    for(const[key,read]of [['gm',()=>get('rpGM').storyState({sessionId})],['database',()=>get('rpDatabase').effectiveV2({sessionId})],['lastStep',()=>get('rpLastStep').state(sessionId)],['narratives',()=>get('rpLastStep').narratives({sessionId})],['context',()=>get('rpContext')?.state({sessionId})],['loop',()=>ctx.agents.get(sessionId)?get('loopStudio')?.inspect(sessionId):null]]){try{result[key]=await read()}catch(error){result[key]={error:{code:error.code,message:error.message}}}}
    return result
  }
  async function revisions(){const result={};for(const[name,key]of [['database','rpDatabase'],['lastStep','rpLastStep'],['context','rpContext'],['gm','rpGM'],['storyKit','rpStoryKit']])if(get(key))result[name]=await get(key).contentRevision();return result}
  const actions={ready:[],counters:[],snapshot:['sessionId'],idle:['sessionId'],prompt:['sessionId','text'],profiles:[],routes:['sessionId','policy'],fork:['sessionId','atSeq'],rollback:['sessionId'],failWriter:[],illegalRetry:[],restoreAbort:['snapshot','restoreId'],occupy:['session'],revisions:[],lastStepRevision:[],material:['sessionId','presentationId'],transferDiagnostics:['sessionIds'],persistence:['sessionIds'],preflightOwners:['sessionIds','state'],audit:['sessionIds']}
  disposers.push(ctx.connection.fetch.register({path:'/api/story-kit-full-probe',methods:['POST'],requestBody:'buffered',fetch:async request=>{
    try{
      const input=await request.json();if(!input||!Object.hasOwn(actions,input.action)||Object.keys(input).some(key=>key!=='action'&&!actions[input.action].includes(key)))throw Error('PROBE_REQUEST_INVALID')
      let result
      if(input.action==='ready')result={capabilities:(await get('rpStoryKit').state({signal:request.signal})).capabilities,gm:get('rpGM').apiVersion,database:get('rpDatabase').apiVersion,context:!!get('rpContext'),loop:!!get('loopStudio'),presets:(await ctx.agentPresets.list()).filter(item=>item.id==='rp-gm')}
      else if(input.action==='counters')result={...local.stats(),executions:structuredClone(executions)}
      else if(input.action==='revisions')result=await revisions()
      else if(input.action==='lastStepRevision')result=await get('rpLastStep').contentRevision()
      else if(input.action==='audit')result=(await get('rpStoryKit').exportState({sessionIds:input.sessionIds,signal:request.signal})).payload.journalAudit
      else if(input.action==='persistence'){result=[];for(const id of input.sessionIds){const handle=await ctx.sessionPersistence.open(id,'read',{signal:request.signal});try{const value=await handle.read(0,undefined,{signal:request.signal});result.push({header:handle.header,inheritedEventCount:handle.inheritedEventCount,events:value.events})}finally{await handle.close()}}}
      else if(input.action==='preflightOwners'){result={};for(const[name,key]of [['database','rpDatabase'],['lastStep','rpLastStep'],['context','rpContext'],['gm','rpGM'],['storyKit','rpStoryKit']])if(input.state[name]!==null){try{result[name]=await get(key).preflightRestore({sessionIds:input.sessionIds,state:input.state[name],signal:request.signal})}catch(error){result[name]={error:{code:error.code,message:error.message}}}}}
      else if(input.action==='transferDiagnostics'){
        const sessionIds=[...input.sessionIds].sort(),context=get('rpContext');result={};for(const held of [false,true]){const work=()=>context.exportState({sessionIds,signal:request.signal}),take=index=>index===sessionIds.length?work():ctx.agents.get(sessionIds[index]).runMaintenance(()=>take(index+1));try{const value=await(held?take(0):work());result[held?'underCoordinatorMaintenance':'standalone']={success:true,revision:value.revision}}catch(error){result[held?'underCoordinatorMaintenance':'standalone']={success:false,code:error.code,message:error.message,stack:error.stack}}}
      }
      else if(input.action==='snapshot')result=await snapshot(input.sessionId)
      else if(input.action==='idle'){await ctx.agents.get(input.sessionId)?.whenIdle();await ctx.sessionPersistence.flush();result=await snapshot(input.sessionId)}
      else if(input.action==='prompt'){const receipt=await invoke('prompt',{sessionId:input.sessionId,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:input.text}]},request.signal);await ctx.agents.get(input.sessionId).whenIdle();result={receipt,...await snapshot(input.sessionId)}}
      else if(input.action==='failWriter'){local.failWriterOnce();result={armed:true}}
      else if(input.action==='illegalRetry'){local.illegalRetryOnce();result={armed:true}}
      else if(input.action==='profiles'){
        result={};for(const label of ['A','B','C','D']){
          const last=get('rpLastStep'),rawText=JSON.stringify({prompts:[{identifier:'style',name:`公开风格 ${label}`,role:'system',content:`STYLE_${label}：公开合成叙事，严格保留事实与玩家控制。`}],prompt_order:[{character_id:100001,order:[{identifier:'style',enabled:true}]}]}),imported=await last.importSillyTavern({rawText,name:`公开风格 ${label}`,expectedRevision:(await last.contentRevision()).revision}),original=(await last.profile({profileId:imported.profileId,version:1})).profile
          const chosen=label==='C'?{profileId:original.id,version:1}:await last.saveProfile({profile:{...original,status:'ready',entries:original.entries.map(entry=>({...entry,phase:'render'}))},expectedRevision:imported.revision})
          result[label]={profileId:original.id,version:chosen.version,sourceId:original.sourceId,rawText}
        }
      }else if(input.action==='routes'){const loop=get('loopStudio'),state=await loop.inspect(input.sessionId,request.signal);result=await loop.savePolicy({sessionId:input.sessionId,scope:'session',expectedRevision:state.revision,policy:input.policy},request.signal)}
      else if(input.action==='fork')result=await get('rpGM').forkStory({sessionId:input.sessionId,...input.atSeq===undefined?{}:{atSeq:input.atSeq},signal:request.signal})
      else if(input.action==='rollback')result=await get('rpGM').rollbackStory({sessionId:input.sessionId,signal:request.signal})
      else if(input.action==='material')result=await get('rpLastStep').material({sessionId:input.sessionId,presentationId:input.presentationId,signal:request.signal})
      else if(input.action==='occupy'){
        const session=input.session,handle=await ctx.sessionPersistence.create(session.header,{inheritedEventCount:session.inheritedEventCount});try{await handle.append(session.events);await handle.flush()}finally{await handle.close()}result={session:await observed(session.header.id),revisions:await revisions(),counts:local.stats().counts}
      }else if(input.action==='restoreAbort'){
        const controller=new AbortController(),ids=input.snapshot.sessions.map(item=>item.header.id);let stoppedAt=null,checking=false
        const timer=setInterval(()=>{if(checking||stoppedAt)return;checking=true;void(async()=>{for(const sessionId of ids)if(ctx.agents.get(sessionId)&&(await get('rpGM').binding({sessionId})).status==='restoring'){stoppedAt={sessionId,phase:'actual-Agent-exists; GM-still-restoring; before-activation'};controller.abort(new DOMException('Controlled native pending checkpoint','AbortError'));break}})().catch(()=>{}).finally(()=>{checking=false})},1)
        try{const outcome=await get('rpStoryKit').restoreSavedStory({snapshot:input.snapshot,restoreId:input.restoreId,signal:AbortSignal.any([request.signal,controller.signal])});result={outcome,stoppedAt,states:await Promise.all(ids.map(snapshot)),counts:local.stats().counts,executions:structuredClone(executions)}}finally{clearInterval(timer)}
      }
      return Response.json({result})
    }catch(error){return Response.json({error:{code:error.code??'PROBE_ERROR',message:String(error.message).slice(0,800),diagnostics:error.diagnostics}},{status:error.status??503})}
  }}))
  ctx.effect(()=>async()=>{for(const dispose of disposers.reverse())await dispose?.()},'Story Kit full native observation')
}
