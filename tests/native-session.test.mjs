import test from 'node:test'
import assert from 'node:assert/strict'

const api=await import('../src/native-session.mjs').catch(()=>({}))
function fixture(){const stored=new Map(),live=new Map(),log=[],services={connection:{browserPeer:{kind:'owner'}},typertGateway:{stream:async input=>{log.push(['authorize',input.args.request.address.sessionId]);return{async *[Symbol.asyncIterator](){yield{type:'snapshot',header:{id:input.args.request.address.sessionId}}}}}},sessionQuery:{observeSession:async id=>{const source=stored.get(id);if(!source)throw Object.assign(new Error('not found'),{code:'SESSION_QUERY_SESSION_NOT_FOUND'});log.push(['cold',id]);return{...structuredClone(source),projections:{values:{agentPreset:'rp-gm',modelSelection:{next:{provider:'local',model:'story'}}}},[Symbol.dispose](){log.push(['dispose-observation',id])}}}},sessionPersistence:{stat:async id=>stored.has(id)?{header:stored.get(id).header}:undefined,flush:async()=>{},create:async(header,{inheritedEventCount})=>{if(stored.has(header.id))throw new Error('occupied');stored.set(header.id,{header:structuredClone(header),events:[],inheritedEventCount});log.push(['create',header.id,inheritedEventCount]);return handle(header.id)},open:async id=>handle(id)},agents:{get:id=>live.get(id),resume:async options=>{log.push(['resume',options.resumeSessionId,options.agentOptions]);await options.setup({});const agent={id:options.resumeSessionId,status:'idle',runMaintenance:async job=>job(new AbortController().signal)};live.set(agent.id,agent);return{agent,dispose:async()=>live.delete(agent.id)}}},sessions:{get:id=>live.get(id)?.session,prepare:(id,_options)=>{log.push(['prepare-readonly',id]);return{requestHeader:()=>({config:{provider:'local',model:'story'}}),[Symbol.dispose](){log.push(['dispose-prepared',id])}}}},sessionProjections:{hydrate:()=>({values:{agentPreset:'rp-gm',modelSelection:{next:{provider:'local',model:'story'}}}})},agentPresets:{list:async()=>[{id:'rp-gm'}],mount:async(_scope,id)=>log.push(['mount',id])},llm:{prepareCall:async config=>{log.push(['metadata-only',config.provider,config.model]);if(config.provider==='missing')throw new Error('not installed');return{config}}}};function handle(id){const source=stored.get(id);return{header:source.header,inheritedEventCount:source.inheritedEventCount,read:async()=>({events:structuredClone(source.events),eventState:'detached'}),append:async events=>{assert.equal(events[0]?.seq??source.events.length,source.events.length);source.events.push(...structuredClone(events));log.push(['append',id,events.length])},flush:async()=>log.push(['flush',id]),close:async()=>log.push(['close',id])}}return{stored,live,log,ctx:{get:name=>services[name]},services}}
function native(ctx){assert.equal(typeof api.createNativeSessionAdapter,'function');return api.createNativeSessionAdapter(ctx)}
const session={header:{version:4,id:'child',createdAt:1792927680000,cwd:null,parentSession:'parent',isSeeded:true,agentPreset:'rp-gm'},events:[{seq:0,time:1792927680001,type:'permission/preset',data:{preset:'workspace-write'}},{seq:1,time:1792927680002,type:'sandbox/mode',data:{mode:'workspace-write'}}],inheritedEventCount:1}

test('native adapter uses exact public persistence metadata, flush/close, cold validation and no-prompt resume',async()=>{
  const data=fixture(),host=native(data.ctx)
  await host.writeSession({session,owned:false});await host.coldValidate({session});await host.resumeSession({session})
  assert.deepEqual(data.stored.get('child'),session);assert.ok(data.log.some(row=>row[0]==='create'&&row[2]===1));assert.ok(data.log.findIndex(row=>row[0]==='close')<data.log.findIndex(row=>row[0]==='cold'));assert.ok(data.log.some(row=>row[0]==='mount'&&row[1]==='rp-gm'));assert.equal(data.log.some(row=>row[0]==='prompt'||row[0]==='model-stream'),false)
})
test('native preview analysis is read-only and reports missing model metadata instead of choosing fallback',async()=>{
  const data=fixture(),host=native(data.ctx),analysis=await host.analyzeSession({session})
  assert.deepEqual(analysis.requirements,[]);assert.equal(data.stored.size,0);assert.equal(data.live.size,0);assert.equal(data.log.some(row=>['create','resume'].includes(row[0])),false)
  assert.deepEqual(await host.modelRequirements({provider:'missing',model:'story'}),['model:missing/story'])
})
test('native owner read checks Remote identity and refuses to guess missing inherited metadata',async()=>{
  const data=fixture();data.stored.set('child',structuredClone(session));const host=native(data.ctx)
  assert.equal((await host.readSession({sessionId:'child'})).inheritedEventCount,1);assert.equal(data.log[0][0],'authorize')
  delete data.stored.get('child').inheritedEventCount
  await assert.rejects(host.readSession({sessionId:'child'}),{code:'EXPORT_SOURCE_METADATA_MISSING'})
})
test('native persistence refuses an unrelated existing ID and resumes only matching owned prefixes',async()=>{
  const data=fixture();data.stored.set('child',structuredClone(session));const host=native(data.ctx)
  await assert.rejects(host.writeSession({session,owned:false}),{code:'RESTORE_ID_CONFLICT'})
  data.stored.get('child').events[1].data={foreign:true};await assert.rejects(host.writeSession({session,owned:true}),{code:'RESTORE_ID_CONFLICT'})
})

test('native preflight checks owned headers/counts/prefixes through a read handle without modifying an existing log',async()=>{
  const data=fixture();data.stored.set('child',structuredClone(session));const host=native(data.ctx);assert.equal(typeof host.checkExisting,'function')
  assert.equal(await host.checkExisting({session}),true);data.stored.get('child').events.push({seq:2,time:1792927680003,type:'user/message',data:{id:'new-user',role:'user',source:{kind:'user'},content:[{type:'text',text:'新动作'}]}});assert.equal(await host.checkExisting({session}),false);assert.equal(await host.checkExisting({session,allowSuffix:true}),false)
  data.stored.get('child').events[2]={seq:2,time:1792927680003,type:'session/end-seed',data:{}};assert.equal(await host.checkExisting({session,allowSuffix:true}),true)
  data.stored.get('child').events[0].data={foreign:true};assert.equal(await host.checkExisting({session,allowSuffix:true}),false);assert.equal(data.log.some(row=>['create','append','resume'].includes(row[0])),false)
})

test('native idle export forwards maintenance cancellation through the full protected callback lifetime',async()=>{
  const data=fixture(),host=native(data.ctx),caller=new AbortController();let maintenance,observed,ready
  const entered=new Promise(resolve=>{ready=resolve})
  data.live.set('source',{status:'idle',runMaintenance:job=>{maintenance=new AbortController();return job(maintenance.signal)}})
  const running=host.withIdleSessions({sessionIds:['source'],signal:caller.signal},signal=>{observed=signal;ready();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});running.catch(()=>{})
  await entered;maintenance.abort(new DOMException('Cancelled','AbortError'))
  try{assert.equal(observed.aborted,true)}finally{caller.abort(new DOMException('Cleanup','AbortError'));await running.catch(()=>{})}
})

test('native preview rejects pending inbox execution before no-prompt resume can activate a driver',async()=>{
  const data=fixture();data.services.sessionProjections.hydrate=()=>({values:{agentPreset:'rp-gm',modelSelection:{next:{provider:'local',model:'story'}},inbox:{'next-turn':[{id:'queued'}],'next-step':[]}}});const host=native(data.ctx)
  assert.ok((await host.analyzeSession({session})).requirements.includes('idle-empty-inbox:child'));assert.equal(data.live.size,0);assert.equal(data.log.some(row=>row[0]==='resume'),false)
})

test('native identity comparison applies only the proven absent-or-zero delegationDepth equivalence',async()=>{
  const data=fixture(),create=data.services.sessionPersistence.create;data.services.sessionPersistence.create=(header,options)=>create({...header,delegationDepth:header.delegationDepth??0},options);const host=native(data.ctx)
  await host.writeSession({session,owned:false});await host.coldValidate({session});assert.equal(Object.hasOwn(session.header,'delegationDepth'),false);assert.equal(await host.checkExisting({session}),true)
  for(const delegationDepth of [null,'0',1]){data.stored.get('child').header.delegationDepth=delegationDepth;assert.equal(await host.checkExisting({session}),false)}
  data.stored.get('child').header.delegationDepth=0;data.stored.get('child').header.extraDefault=false;assert.equal(await host.checkExisting({session}),false)
})

test('safe resume rechecks the original prefix and rejects any suffix other than the verified end-seed',async()=>{
  const data=fixture(),resume=data.services.agents.resume;data.services.agents.resume=async input=>{const handle=await resume(input);data.stored.get(input.resumeSessionId).events.push({seq:2,time:1792927680003,type:'user/message',data:{id:'unexpected',role:'user',source:{kind:'user'},content:[{type:'text',text:'不得执行的新动作'}]}});return handle};const host=native(data.ctx)
  await host.writeSession({session,owned:false});await host.coldValidate({session});await assert.rejects(host.resumeSession({session}),{code:'RESTORE_PAYLOAD_INVALID'});assert.equal(data.live.size,0)
})
