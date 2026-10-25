import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const api=await import('../src/store.mjs').catch(()=>({}))
const rawText=await readFile(new URL('./fixtures/harbor-v2.json',import.meta.url),'utf8')
async function setup(t){assert.equal(typeof api.createStoryKitStore,'function','versioned asset store is available');const directory=await mkdtemp(join(tmpdir(),'story-kit-'));t.after(()=>rm(directory,{recursive:true,force:true}));return{directory,store:api.createStoryKitStore({directory})}}
const character=(store,saved,version=saved.version)=>store.asset({kind:'character',assetId:saved.assetId,version}).then(result=>result.asset)
const persona=(store,saved,version=saved.version)=>store.asset({kind:'persona',assetId:saved.assetId,version}).then(result=>result.asset)

test('imported original and immutable character versions survive restart without changing a pinned version',async t=>{
  const{store,directory}=await setup(t)
  const saved=await store.importAsset({format:'json',rawText,expectedRevision:0})
  assert.equal(saved.revision,1);assert.equal(saved.version,1)
  const original=await store.source({sourceId:saved.sourceId}),base=await character(store,saved)
  assert.deepEqual(Buffer.from(original.source.dataBase64,'base64'),Buffer.from(rawText))
  const edited=await store.saveCharacter({character:{...base,description:'由玩家审阅的新描述'},expectedRevision:1})
  assert.equal(edited.version,2);assert.equal(edited.revision,2)
  const restarted=api.createStoryKitStore({directory})
  assert.equal((await character(restarted,saved)).description,'一座潮汐驱动的合成港城；这是世界设定资产。')
  assert.equal((await character(restarted,edited)).description,'由玩家审阅的新描述')
  assert.deepEqual(await restarted.source({sourceId:saved.sourceId}),original)
  const detached=await character(restarted,saved);detached.openings[0].text='不可污染版本'
  assert.equal((await character(restarted,saved)).openings[0].text,'钟声越过雾面，守灯人递来一张空白航图。')
})

test('same display names create distinct personas and edits create new immutable versions',async t=>{
  const{store}=await setup(t)
  const first=await store.createPersona({persona:{name:'旅人',description:'测绘员'},expectedRevision:0})
  const second=await store.createPersona({persona:{name:'旅人',description:'守灯人'},expectedRevision:1})
  assert.notEqual(first.assetId,second.assetId)
  const edited=await store.savePersona({persona:{...await persona(store,first),description:'海图测绘员'},expectedRevision:2})
  assert.equal(edited.version,2)
  assert.equal((await persona(store,first)).description,'测绘员')
  assert.equal((await store.snapshot()).personas.length,2)
})

test('stale global revisions and stale base versions leave the existing library unchanged',async t=>{
  const{store}=await setup(t)
  const first=await store.createPersona({persona:{name:'旅人',description:'原版'},expectedRevision:0})
  const second=await store.savePersona({persona:{...await persona(store,first),description:'第二版'},expectedRevision:1})
  await assert.rejects(store.savePersona({persona:{...await persona(store,second),description:'旧 revision'},expectedRevision:1}),{code:'REVISION_CONFLICT'})
  await assert.rejects(store.savePersona({persona:{...await persona(store,first),description:'旧 version'},expectedRevision:2}),{code:'ASSET_VERSION_CONFLICT'})
  assert.equal((await store.snapshot()).revision,2)
  assert.equal((await persona(store,second)).description,'第二版')
})

test('separate store handles serialize same-revision writes without overwriting a same-name persona',async t=>{
  const{store,directory}=await setup(t),other=api.createStoryKitStore({directory})
  const outcomes=await Promise.allSettled([store.createPersona({persona:{name:'同名',description:'甲'},expectedRevision:0}),other.createPersona({persona:{name:'同名',description:'乙'},expectedRevision:0})])
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1)
  assert.equal(outcomes.find(outcome=>outcome.status==='rejected').reason.code,'REVISION_CONFLICT')
  const snapshot=await store.snapshot();assert.equal(snapshot.revision,1);assert.equal(snapshot.personas.length,1)
})

test('invalid owner inputs cannot invent source IDs, alter unknown assets or use a reserved source slot',async t=>{
  const{store}=await setup(t)
  await assert.rejects(store.createPersona({persona:{name:'旅人',description:'',sourceId:'absent'},expectedRevision:0}),{code:'INVALID_ASSET'})
  await assert.rejects(store.savePersona({persona:{id:'absent',version:1,name:'旅人',description:''},expectedRevision:0}),{code:'ASSET_NOT_FOUND'})
  await assert.rejects(store.createCharacter({character:{name:'港城',openings:[],databaseRefs:[{key:'@session',databaseId:'book',version:1}]},expectedRevision:0}),{code:'INVALID_ASSET'})
  assert.equal((await store.snapshot()).revision,0)
})
