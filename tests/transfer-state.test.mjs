import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createStoryKitStore,appendAsset} from '../src/store.mjs'
import {semanticHash} from '../src/identity.mjs'
import {createHash} from 'node:crypto'

const api=await import('../src/transfer-state.mjs').catch(()=>({}))
const card=JSON.parse(await readFile(new URL('./fixtures/harbor-v2.json',import.meta.url),'utf8'));card.data.creator_notes='C:\\original-author-audit';const raw='\ufeff'+JSON.stringify(card,null,2).replaceAll('\n','\r\n')
async function setup(t,bindings={}){assert.equal(typeof api.createStoryKitTransfer,'function');const directory=await mkdtemp(join(tmpdir(),'story-kit-state-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=createStoryKitStore({directory}),reads=[];const owner=api.createStoryKitTransfer({store,getGM:()=>({apiVersion:1,binding:async({sessionId})=>bindings[sessionId]??null}),readSession:async({sessionId})=>{reads.push(sessionId);return{header:{id:sessionId},events:[],inheritedEventCount:0}}});return{store,owner,directory,reads}}
async function origin(t){const bindings={},source=await setup(t,bindings),character=await source.store.importAsset({format:'json',rawText:raw,expectedRevision:0}),persona=await source.store.createPersona({persona:{name:'旅人',description:'测绘员'},expectedRevision:1}),asset=(await source.store.asset({kind:'character',assetId:character.assetId,version:1})).asset;await source.store.saveCharacter({character:{...asset,description:'较晚版本，旧故事不能偷换'},expectedRevision:2});await source.store.createPersona({persona:{name:'无关身份',description:'不应被导出'},expectedRevision:3});bindings.story={sessionId:'story',launchId:'launch',character:{assetId:character.assetId,version:1,name:asset.name,description:asset.description,personality:asset.personality,scenario:asset.scenario},persona:{assetId:persona.assetId,version:1,name:'旅人',description:'测绘员'}};return{...source,bindings,character,persona}}

test('own transfer exports only pinned session asset/source versions and keeps audit bytes without reading local paths',async t=>{
  const source=await origin(t),state=await source.owner.exportState({sessionIds:['story']})
  assert.equal(state.schemaVersion,1);assert.equal(state.payload.characters.length,1);assert.equal(state.payload.characters[0].version,1);assert.equal(state.payload.personas.length,1);assert.equal(state.payload.sources[0].rawText,raw);assert.equal(state.payload.sources[0].provenance.data.creator_notes,'C:\\original-author-audit');assert.deepEqual(source.reads,['story'])
})

test('own exact-ID restore preflights without canonical reads, then validates actual session/binding before atomic restore',async t=>{
  const source=await origin(t),state=await source.owner.exportState({sessionIds:['story']}),destination=await setup(t,source.bindings)
  const preview=await destination.owner.preflightRestore({sessionIds:['story'],state});assert.equal(preview.supported,true);assert.deepEqual(destination.reads,[])
  const restored=await destination.owner.restoreState({restoreId:'restore-one',sessionIds:['story'],state,expectedRevision:0});assert.deepEqual(restored.restoredSessionIds,['story']);assert.deepEqual(destination.reads,['story'])
  const asset=(await destination.store.asset({kind:'character',assetId:source.character.assetId,version:1})).asset;assert.equal(asset.version,1);assert.equal((await destination.store.source({sourceId:asset.sourceId})).source.rawText,raw)
  const before=await readFile(join(destination.directory,'story-kit-store.json'),'utf8')
  await destination.owner.restoreState({restoreId:'restore-one',sessionIds:['story'],state,expectedRevision:0});assert.equal(await readFile(join(destination.directory,'story-kit-store.json'),'utf8'),before)
  const changed=structuredClone(state);changed.payload.characters[0].description='不同 payload'
  await assert.rejects(destination.owner.restoreState({restoreId:'restore-one',sessionIds:['story'],state:changed,expectedRevision:1}),{code:'RESTORE_ID_CONFLICT'});assert.equal(await readFile(join(destination.directory,'story-kit-store.json'),'utf8'),before)
})

test('own preflight detects conflicting immutable identities and never overwrites unrelated destination data',async t=>{
  const source=await origin(t),state=await source.owner.exportState({sessionIds:['story']}),destination=await setup(t,source.bindings),foreign={...state.payload.characters[0],description:'目的地已有不同内容'};delete foreign.sourceId
  await destination.store.transact(0,data=>appendAsset(data,'character',foreign,{create:true}))
  const before=await readFile(join(destination.directory,'story-kit-store.json'),'utf8'),preview=await destination.owner.preflightRestore({sessionIds:['story'],state})
  assert.equal(preview.supported,false);assert.equal(preview.conflicts[0].code,'RESTORE_CONTENT_CONFLICT')
  await assert.rejects(destination.owner.restoreState({restoreId:'restore-two',sessionIds:['story'],state,expectedRevision:1}),{code:'RESTORE_CONTENT_CONFLICT'});assert.equal(await readFile(join(destination.directory,'story-kit-store.json'),'utf8'),before)
})

test('own transfer rejects unrelated assets, executable resources and privileged launch fields before state writes',async t=>{
  const source=await origin(t),state=await source.owner.exportState({sessionIds:['story']}),destination=await setup(t,source.bindings),extra=(await source.store.snapshot()).personas.find(item=>item.name==='无关身份')
  const unrelated=structuredClone(state);unrelated.payload.personas.push(extra)
  const executable=structuredClone(state),bytes=Buffer.from('never execute');executable.payload.personas[0].avatarResourceId='script';executable.payload.resources.push({id:'script',mimeType:'application/javascript',dataBase64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')})
  const privileged=structuredClone(state),request={launchId:'launch',title:'公开故事',character:{...source.bindings.story.character,systemPrompt:'privileged override'},persona:source.bindings.story.persona,opening:{id:'first',text:'雾'},examples:'',sources:[],initialScene:{schemaVersion:1,title:'港口',location:'码头',presentActorIds:[]},initialFacts:{schemaVersion:1,items:[]}};privileged.payload.launches.push({launchId:'launch',fingerprint:semanticHash(request),request,status:'failed',createdAt:'2026-10-25T00:00:00.000Z'})
  for(const invalid of [unrelated,executable,privileged]){assert.equal((await destination.owner.preflightRestore({sessionIds:['story'],state:invalid})).supported,false);await assert.rejects(destination.owner.restoreState({restoreId:'reject',sessionIds:['story'],state:invalid,expectedRevision:0}),{code:'RESTORE_PAYLOAD_INVALID'})}
  assert.deepEqual(await readdir(destination.directory),[])
})

test('owner restore serializes identity before deep proof and rejects malformed transport before completed replay',async t=>{
  const source=await origin(t),state=await source.owner.exportState({sessionIds:['story']}),destination=await setup(t,source.bindings);let release,entered
  const started=new Promise(resolve=>{entered=resolve}),proof=new Promise(resolve=>{release=resolve}),owner=api.createStoryKitTransfer({store:destination.store,getGM:()=>({apiVersion:1,binding:async({sessionId})=>source.bindings[sessionId]}),readSession:async({sessionId})=>{entered();await proof;return{header:{id:sessionId},events:[],inheritedEventCount:0}}})
  const first=owner.restoreState({restoreId:'serialized',sessionIds:['story'],state,expectedRevision:0});await started
  const changed=structuredClone(state);changed.payload.sources[0].sha256='invalid-deep-hash'
  const second=owner.restoreState({restoreId:'serialized',sessionIds:['story'],state:changed,expectedRevision:0});second.catch(()=>{});release();await first;await assert.rejects(second,{code:'RESTORE_ID_CONFLICT'})
  await assert.rejects(owner.restoreState({restoreId:'serialized',sessionIds:['story'],state,expectedRevision:undefined}),{code:'RESTORE_PAYLOAD_INVALID'})
})
