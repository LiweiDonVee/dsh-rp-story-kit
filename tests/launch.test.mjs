import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createStoryKitStore,storageKey} from '../src/store.mjs'

const api=await import('../src/launch.mjs').catch(()=>({}))
const initialScene={schemaVersion:1,title:'初始港口',location:'码头',presentActorIds:[]},initialFacts={schemaVersion:1,items:[{id:'tide',text:'退潮'}]}
async function setup(t){assert.equal(typeof api.createLaunchService,'function');const directory=await mkdtemp(join(tmpdir(),'story-kit-launch-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=createStoryKitStore({directory}),character=await store.createCharacter({character:{name:'公开设定',description:'固定设定 v1',personality:'谨慎',scenario:'港口',openings:[{id:'first',name:'第一开场',text:'第一开场文本'},{id:'alternate-1',name:'第二开场',text:'选定的第二开场'}],examples:'只是示例，不是已发生事实',profileRef:{profileId:'linked',version:2}},expectedRevision:0}),persona=await store.createPersona({persona:{name:'旅人',description:'测绘员'},expectedRevision:1}),requests=[],bindings=new Map();let creates=0,failOnce=false,profileStatus='ready';const gm={apiVersion:1,binding:async({sessionId})=>bindings.get(sessionId)??null,startStory:async request=>{requests.push(structuredClone({...request,signal:undefined}));let binding=[...bindings.values()].find(item=>item.launchId===request.launchId);if(!binding){creates++;binding={schemaVersion:1,id:'binding',sessionId:'session-'+creates,launchId:request.launchId,title:request.title,status:'starting',character:request.character,persona:request.persona,opening:request.opening,examples:request.examples,sources:request.sources,profile:request.profile??{profileId:'builtin',version:1},factEntryRefs:[],createdAt:'2026-10-25T00:00:00.000Z'};bindings.set(binding.sessionId,binding)}if(failOnce){failOnce=false;throw Object.assign(new Error('PRIVATE FAILURE'),{code:'START_INTERRUPTED',status:503})}return{sessionId:binding.sessionId,binding,status:binding.status}}};const database={apiVersion:2,bindSources(){},initializeStoryState(){},database:async({databaseId,version})=>({database:{id:databaseId,version,entries:[]}})},lastStep={profile:async({profileId,version})=>({profile:{id:profileId,version,status:profileStatus,entries:[]}}),bindSession(){},ensureBuiltinProfile(){}};const dependencies={store,getGM:()=>gm,getDatabase:()=>database,getLastStep:()=>lastStep},owner=api.createLaunchService(dependencies),input={launchId:'launch-one',character:{assetId:character.assetId,version:1},persona:{assetId:persona.assetId,version:1},openingId:'alternate-1',sources:[],initialScene,initialFacts};return{directory,store,owner,dependencies,input,requests,bindings,creates:()=>creates,interrupt:()=>{failOnce=true},draft:()=>{profileStatus='draft'}}}

test('launch pins immutable character/persona/opening/seed and preserves linked profile precedence',async t=>{
  const data=await setup(t),first=(await data.store.asset({kind:'character',...data.input.character})).asset
  await data.store.saveCharacter({character:{...first,description:'较晚 v2'},expectedRevision:2})
  const result=await data.owner.launch(data.input),request=data.requests[0]
  assert.equal(result.status,'starting');assert.deepEqual(request.character,{assetId:first.id,version:1,name:'公开设定',description:'固定设定 v1',personality:'谨慎',scenario:'港口'});assert.equal(request.persona.description,'测绘员');assert.deepEqual(request.opening,{id:'alternate-1',text:'选定的第二开场'});assert.equal(request.examples,'只是示例，不是已发生事实');assert.deepEqual(request.initialFacts,initialFacts);assert.deepEqual(request.profile,{profileId:'linked',version:2})
  const state=await data.store.rawState();assert.deepEqual(state.launches[storageKey('launch-one')].request.initialFacts,initialFacts)
})

test('explicit profile wins, explicit null selects builtin, and a draft linked profile never silently falls back',async t=>{
  const data=await setup(t)
  await data.owner.launch({...data.input,launchId:'explicit',profile:{profileId:'chosen',version:4}});assert.deepEqual(data.requests[0].profile,{profileId:'chosen',version:4})
  await data.owner.launch({...data.input,launchId:'builtin',profile:null});assert.equal(Object.hasOwn(data.requests[1],'profile'),false)
  data.draft();await assert.rejects(data.owner.launch({...data.input,launchId:'draft'}),{code:'PROFILE_NOT_READY'});assert.equal(data.creates(),2)
})

test('partial launch restarts from the stored reviewed request and same launchId without another Session',async t=>{
  const data=await setup(t);data.interrupt();await assert.rejects(data.owner.launch(data.input),error=>error.code==='START_INTERRUPTED'&&!error.message.includes('PRIVATE'))
  assert.equal(data.creates(),1);assert.equal((await data.owner.pendingLaunches({}))[0].status,'failed')
  const selected=(await data.store.asset({kind:'character',...data.input.character})).asset
  await data.store.saveCharacter({character:{...selected,openings:[{id:'first',name:'新开场',text:'不得用于旧请求'}]},expectedRevision:(await data.store.snapshot()).revision})
  const restarted=api.createLaunchService({...data.dependencies,store:createStoryKitStore({directory:data.directory})}),result=await restarted.resumeLaunch({launchId:'launch-one'})
  assert.equal(data.creates(),1);assert.equal(result.sessionId,'session-1');assert.deepEqual(data.requests[1],data.requests[0]);assert.equal(data.requests[1].opening.text,'选定的第二开场')
  data.bindings.get('session-1').status='active';assert.deepEqual(await restarted.pendingLaunches({}),[])
  const before=await readFile(join(data.directory,'story-kit-store.json'),'utf8')
  await assert.rejects(restarted.launch({...data.input,openingId:'first'}),{code:'LAUNCH_CONFLICT'});assert.equal(await readFile(join(data.directory,'story-kit-store.json'),'utf8'),before)
})

test('launch reuses the strict seed validator and absent native dependencies remain unavailable',async t=>{
  const data=await setup(t);await assert.rejects(data.owner.launch({...data.input,initialFacts:[]}),{code:'INVALID_SEED'});assert.equal(data.creates(),0)
  const absent=api.createLaunchService({...data.dependencies,getGM:()=>undefined});assert.equal(absent.available(),false);await assert.rejects(absent.launch(data.input),{code:'CAPABILITY_UNAVAILABLE'});assert.equal(data.creates(),0)
})
