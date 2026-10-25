import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createStoryKitStore} from '../src/store.mjs'

const api=await import('../src/host.mjs').catch(()=>({}))
const rawText=await readFile(new URL('./fixtures/harbor-v2.json',import.meta.url),'utf8')

test('an optional missing service uses public Context.get without reading a guarded Cordis proxy property',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'story-kit-optional-context-'));t.after(()=>rm(directory,{recursive:true,force:true}))
  const context=new Proxy({get:()=>undefined,inject(){}},{get(target,key,receiver){if(Reflect.has(target,key))return Reflect.get(target,key,receiver);throw Error(`cannot get property ${String(key)} without inject`)}})
  const service=await api.createStoryKitHost(context,{directory,skillDirectory:fileURLToPath(new URL('../skills/adapting-roleplay-story-assets/',import.meta.url))});t.after(()=>service.close())
  await service.createPersona({persona:{name:'公开独立资产',description:''},expectedRevision:0});const state=await service.state({});assert.equal(state.personas.length,1);assert.equal(state.capabilities.launch,false);assert.equal(state.capabilities.savedStoryExport,false)
})
async function setup(t,database){assert.equal(typeof api.createStoryKitHost,'function','native asset owner service is available');const directory=await mkdtemp(join(tmpdir(),'story-kit-host-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=createStoryKitStore({directory});const service=await api.createStoryKitHost({get:name=>name==='rpDatabase'?database:undefined},{store});t.after(()=>service.close());return{store,service}}

test('standalone asset library creates editable characters and personas while real launch is unavailable',async t=>{
  const{service}=await setup(t)
  assert.equal(service.apiVersion,1)
  const saved=await service.createCharacter({character:{name:'雾港',description:'只有设定也可以',openings:[]},expectedRevision:0})
  const player=await service.createPersona({persona:{name:'旅人',description:'测绘员'},expectedRevision:1})
  assert.notEqual(saved.assetId,player.assetId)
  assert.equal((await service.asset({kind:'character',assetId:saved.assetId,version:1})).asset.description,'只有设定也可以')
  const state=await service.state({});assert.equal(state.characters.length,1);assert.equal(state.capabilities.launch,false)
  await assert.rejects(service.launch({}),{code:'CAPABILITY_UNAVAILABLE'})
  await assert.rejects(service.exportReading({}),{code:'CAPABILITY_UNAVAILABLE'})
})

test('embedded worldbook delegates full original card to Database then links a new immutable asset version',async t=>{
  let received
  const database={import:async input=>{received=input;return{revision:8,databaseId:'new-book',version:1,diagnostics:[{code:'ST_MACROS_LITERAL',severity:'warning',message:'inert'}]}}}
  const{service}=await setup(t,database)
  const imported=await service.importAsset({format:'json',rawText,expectedRevision:0})
  const linked=await service.importWorldbook({assetId:imported.assetId,version:1,descriptorId:imported.embeddedWorldbooks[0].id,expectedRevision:1,expectedDatabaseRevision:7})
  assert.equal(received.rawText,rawText);assert.equal(received.expectedRevision,7)
  assert.deepEqual(linked.databaseRef,{key:'card',databaseId:'new-book',version:1})
  assert.equal(linked.version,2)
  assert.deepEqual((await service.asset({kind:'character',assetId:imported.assetId,version:1})).asset.databaseRefs,[])
  assert.deepEqual((await service.asset({kind:'character',assetId:imported.assetId,version:2})).asset.databaseRefs,[{key:'card',databaseId:'new-book',version:1}])
})

test('missing Database preserves deferred descriptor without changing the library',async t=>{
  const{service,store}=await setup(t)
  const imported=await service.importAsset({format:'json',rawText,expectedRevision:0})
  await assert.rejects(service.importWorldbook({assetId:imported.assetId,version:1,descriptorId:'data.character_book',expectedRevision:1,expectedDatabaseRevision:0}),{code:'DEPENDENCY_UNAVAILABLE'})
  assert.equal((await service.source({sourceId:imported.sourceId})).source.rawText,rawText)
  assert.equal((await store.descriptors({sourceId:imported.sourceId})).length,1)
  assert.equal((await service.state({})).revision,1)
})

test('bundled adaptation skill registers standard body/resource base and releases on unload',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'story-kit-skill-'));t.after(()=>rm(directory,{recursive:true,force:true}))
  const registered=[],skills={register:skill=>{registered.push(skill);return()=>registered.splice(registered.indexOf(skill),1)}}
  const service=await api.createStoryKitHost({get:name=>name==='skills'?skills:undefined},{directory,skillDirectory:fileURLToPath(new URL('../skills/adapting-roleplay-story-assets/',import.meta.url))})
  assert.equal(registered.length,1);assert.equal(registered[0].name,'adapting-roleplay-story-assets');assert.equal(registered[0].source,'bundled');assert.equal(registered[0].resourceBase.kind,'directory');assert.match(registered[0].content,/^#/u)
  service.close();assert.equal(registered.length,0)
})

test('production host projects actual launch/reading dependencies and persists resumable owner metadata',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'story-kit-host-runtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));let binding
  const services={rpGM:{apiVersion:1,binding:async()=>binding??null,startStory:async input=>{binding={schemaVersion:1,id:'b',sessionId:'native-story',launchId:input.launchId,title:input.title,status:'starting',character:input.character,persona:input.persona,opening:input.opening,examples:input.examples,sources:input.sources,profile:{profileId:'builtin',version:1},factEntryRefs:[],createdAt:'2026-10-25T00:00:00.000Z'};return{sessionId:binding.sessionId,binding,status:'starting'}}},rpDatabase:{apiVersion:2,bindSources(){},initializeStoryState(){},database(){}},rpLastStep:{profile(){},bindSession(){},ensureBuiltinProfile(){},narratives:async()=>({records:[{id:'["p",2]',ref:{sessionId:'native-story',presentationId:'p',assistantMessageId:'a',callSeq:1,baseResultSeq:2,resultSeq:2},turn:1,action:'',text:'已采用的正文。'}]})}}
  const service=await api.createStoryKitHost({get:name=>services[name]},{directory});t.after(()=>service.close())
  const character=await service.createCharacter({character:{name:'公开故事',openings:[{id:'first',name:'开场',text:'雾'}]},expectedRevision:0}),persona=await service.createPersona({persona:{name:'旅人',description:''},expectedRevision:1})
  const state=await service.state({});assert.equal(state.capabilities.launch,true);assert.equal(state.capabilities.readingExport,true);assert.equal(state.capabilities.savedStoryRestore,false)
  const result=await service.launch({launchId:'real-seam-fixture',character:{assetId:character.assetId,version:1},persona:{assetId:persona.assetId,version:1},openingId:'first',sources:[],profile:null,initialScene:{schemaVersion:1,title:'港口',location:'码头',presentActorIds:[]},initialFacts:{schemaVersion:1,items:[]}})
  assert.equal(result.status,'starting');assert.equal((await service.state({})).pendingLaunches[0].launchId,'real-seam-fixture');assert.equal((await service.exportReading({sessionId:'native-story',format:'text'})).text,'已采用的正文。\n')
  services.rpGM.binding=async()=>{throw Object.assign(new Error('private unavailable detail'),{code:'UNAVAILABLE',status:503})}
  const degraded=await service.state({});assert.equal(degraded.characters.length,1);assert.equal(degraded.pendingLaunches[0].errorCode,'UNAVAILABLE')
})
