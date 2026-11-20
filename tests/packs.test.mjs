import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createStoryKitStore} from '../src/store.mjs'
import {createStoryKitHost} from '../src/host.mjs'

const api=await import('../src/packs.mjs').catch(()=>({}))
const key=(id,version)=>JSON.stringify([id,version])
const rawText=await readFile(new URL('./fixtures/harbor-v2.json',import.meta.url),'utf8')
const entry={id:'0',title:'潮汐钟',content:'按潮水报时',keywords:['钟'],tags:[],notes:'',readOnly:true,mode:'required',version:1}
const profile={id:'style',name:'简洁文风',version:3,status:'ready',sourceId:null,entries:[{id:'tone',name:'语气',content:'简洁',role:'system',phase:'render',order:0,enabled:true,required:true,locked:true}]}
async function setup(t,providers={}){assert.equal(typeof api.createPackService,'function','data-only pack kernel is available');const directory=await mkdtemp(join(tmpdir(),'story-kit-pack-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=createStoryKitStore({directory}),service=await createStoryKitHost({get:name=>providers[name]},{store});t.after(()=>service.close());return{directory,store,service}}
function provider(kind){let revision=0;const imported=[],requests=[];return{imported,requests,contentRevision:async()=>({revision}),exportContent:async()=>kind==='database'?{database:{id:'world',name:'雾港',version:2,entries:[entry]}}:{profile},async importContent(input){requests.push(input);assert.equal(input.expectedRevision,revision);revision++;const value=structuredClone(input[kind]);value.id=`${kind}-${imported.length+1}`;value.version=1;if(kind==='profile')value.status='draft';imported.push(value);return{revision,[`${kind}Id`]:value.id,version:1,...kind==='profile'?{reviewRequired:true}:{}}}}}

test('content pack round-trip remaps every asset/database/profile/template reference and preserves policies',async t=>{
  const db=provider('database'),rp=provider('profile'),{service}=await setup(t,{rpDatabase:db,rpLastStep:rp})
  const imported=await service.importAsset({format:'json',rawText,expectedRevision:0})
  const first=(await service.asset({kind:'character',assetId:imported.assetId,version:1})).asset
  const saved=await service.saveCharacter({character:{...first,databaseRefs:[{key:'card',databaseId:'world',version:2}],profileRef:{profileId:'style',version:3}},expectedRevision:1})
  const player=await service.createPersona({persona:{name:'旅人',description:'测绘员'},expectedRevision:2})
  const template={id:'start',title:'雾港起点',character:{assetId:saved.assetId,version:2},persona:{assetId:player.assetId,version:1},openingId:'alternate-1',sources:[{key:'card',databaseId:'world',version:2}],profile:{profileId:'style',version:3},initialScene:{schemaVersion:1,title:'雾港',location:'码头',presentActorIds:[]},initialFacts:{schemaVersion:1,items:[{id:'tide',text:'已经退潮'}]}}
  const{pack}=await service.exportPack({characters:[{assetId:saved.assetId,version:2}],personas:[{assetId:player.assetId,version:1}],templates:[template]})
  assert.equal(pack.format,'dsh-rp-story-pack');assert.equal(pack.databases[0].database.entries[0].readOnly,true)
  const destination=await setup(t,{rpDatabase:db,rpLastStep:rp}),result=await destination.service.importPack({pack,expectedRevision:0})
  const characterMap=result.mappings.assets[key(saved.assetId,2)],personaMap=result.mappings.assets[key(player.assetId,1)]
  assert.notEqual(characterMap.assetId,saved.assetId);assert.notEqual(personaMap.assetId,player.assetId)
  const asset=(await destination.service.asset({kind:'character',...characterMap})).asset
  assert.deepEqual(asset.databaseRefs,[{key:'card',databaseId:'database-1',version:1}]);assert.deepEqual(asset.profileRef,{profileId:'profile-1',version:1})
  assert.equal(db.imported[0].entries[0].readOnly,true);assert.equal(db.imported[0].entries[0].mode,'required');assert.equal(rp.imported[0].status,'draft');assert.equal(rp.imported[0].entries[0].locked,true)
  const stored=(await destination.store.snapshot()).templates[0]
  assert.deepEqual(stored.character,characterMap);assert.deepEqual(stored.persona,personaMap);assert.equal(stored.sources[0].databaseId,'database-1');assert.equal(stored.profile.profileId,'profile-1')
  const before=await readFile(join(destination.directory,'story-kit-store.json'),'utf8'),templateId=result.mappings.storyTemplates.start
  assert.deepEqual((await destination.service.state({})).templates,[{templateId,title:'雾港起点'}])
  assert.deepEqual(await destination.service.template({templateId}),{revision:result.revision,template:stored})
  const detached=(await destination.service.template({templateId})).template
  detached.initialFacts.items[0].text='调用方的改写';detached.sources[0].databaseId='other';detached.character.version=99
  const restarted=await createStoryKitHost({get:name=>({rpDatabase:db,rpLastStep:rp})[name]},{directory:destination.directory});t.after(()=>restarted.close())
  assert.deepEqual(await restarted.template({templateId}),{revision:result.revision,template:stored})
  assert.equal(await readFile(join(destination.directory,'story-kit-store.json'),'utf8'),before)
  await destination.service.saveCharacter({character:{...asset,openings:asset.openings.map(opening=>({...opening,text:'新版本原文'}))},expectedRevision:result.revision})
  assert.deepEqual((await restarted.template({templateId})).template,stored)
  assert.equal((await restarted.asset({kind:'character',...stored.character})).asset.openings.find(opening=>opening.id===stored.openingId).text,asset.openings.find(opening=>opening.id===stored.openingId).text)
  assert.equal(result.reviewRequired,true)
  assert.equal((await destination.service.source({sourceId:asset.sourceId})).source.rawText,rawText)
})

test('preview catches unresolved references, executable resources, hashes and private configuration before provider writes',async t=>{
  const db=provider('database'),{service}=await setup(t,{rpDatabase:db})
  const base={format:'dsh-rp-story-pack',schemaVersion:1,assets:[],databases:[],profiles:[],storyTemplates:[],resources:[],requirements:[]}
  for(const pack of [{...base,credentials:{token:'private'}},{...base,resources:[{id:'script',mimeType:'application/javascript',sha256:'0'.repeat(64),dataBase64:'YWxlcnQoMSk='}]},{...base,assets:[{kind:'character',asset:{id:'c',version:1,name:'c',openings:[],databaseRefs:[{key:'card',databaseId:'missing',version:1}]}}]}]){
    await assert.rejects(service.importPack({pack,expectedRevision:0}),error=>['INVALID_PACK','PACK_REFERENCE_UNRESOLVED'].includes(error.code))
  }
  assert.equal(db.imported.length,0);assert.equal((await service.state({})).revision,0)
  const preview=await service.previewPack({pack:{...base,requirements:['unknown-plugin']}})
  assert.equal(preview.diagnostics[0].code,'REQUIREMENT_UNAVAILABLE')
})

test('same-title imported templates retain separate identities and exact null or omitted profile seeds',async t=>{
  const{service,store,directory}=await setup(t)
  const character={id:'c',version:4,name:'公开合成角色',openings:[{id:'first',name:'开场',text:'第一段原文\n第二行'}],databaseRefs:[]},persona={id:'p',version:3,name:'公开合成身份',description:'由玩家决定行动'}
  const seed={initialScene:{schemaVersion:1,title:'已审阅场景',location:'码头',time:'清晨',presentActorIds:['traveler']},initialFacts:{schemaVersion:1,items:[{id:'fact-original',text:'已经退潮'}]}}
  const base={title:'相同名称',character:{assetId:'c',version:4},persona:{assetId:'p',version:3},openingId:'first',sources:[],...seed}
  const pack={format:'dsh-rp-story-pack',schemaVersion:1,assets:[{kind:'character',asset:character},{kind:'persona',asset:persona}],databases:[],profiles:[],storyTemplates:[{...base,id:'default',profile:null},{...base,id:'inherit'}],resources:[],requirements:[]}
  const imported=await service.importPack({pack,expectedRevision:0}),before=await readFile(join(directory,'story-kit-store.json'),'utf8')
  let changes=0;const unsubscribe=service.subscribe(()=>changes++);t.after(unsubscribe)
  const summaries=(await service.state({})).templates
  assert.deepEqual(summaries,[{templateId:imported.mappings.storyTemplates.default,title:base.title},{templateId:imported.mappings.storyTemplates.inherit,title:base.title}])
  assert.notEqual(summaries[0].templateId,summaries[1].templateId)
  for(const[original,index]of pack.storyTemplates.map((template,index)=>[template,index])){
    const result=await service.template({templateId:summaries[index].templateId}),template=result.template
    assert.equal(result.revision,imported.revision)
    assert.deepEqual(template,{...original,id:summaries[index].templateId,character:imported.mappings.assets[key('c',4)],persona:imported.mappings.assets[key('p',3)]})
    assert.equal(Object.hasOwn(template,'profile'),Object.hasOwn(original,'profile'))
  }
  assert.equal(changes,0);assert.equal((await store.snapshot()).revision,imported.revision)
  assert.equal(await readFile(join(directory,'story-kit-store.json'),'utf8'),before)
})

test('provider conflict preserves completed ID maps and request IDs so a retry resumes after restart',async t=>{
  const db=provider('database'),baseImport=db.importContent;let failSecond=true
  db.importContent=async input=>{if(input.database.name==='second'&&failSecond){db.requests.push(input);throw Object.assign(new Error('changed'),{code:'REVISION_CONFLICT',status:409})}return baseImport(input)}
  const{service,store,directory}=await setup(t,{rpDatabase:db})
  const pack={format:'dsh-rp-story-pack',schemaVersion:1,assets:[],databases:[{id:'world',version:1,database:{id:'world',version:1,name:'first',entries:[entry]}},{id:'world',version:2,database:{id:'world',version:2,name:'second',entries:[entry]}}],profiles:[],storyTemplates:[],resources:[],requirements:['dsh-rp-database']}
  await assert.rejects(service.importPack({pack,expectedRevision:0}),{code:'PACK_IMPORT_INCOMPLETE'})
  assert.equal(db.imported.length,1);assert.equal((await store.snapshot()).revision,0)
  const failedRequest=db.requests.at(-1).requestId;failSecond=false
  const restartedStore=createStoryKitStore({directory}),restarted=await createStoryKitHost({get:name=>name==='rpDatabase'?db:undefined},{store:restartedStore});t.after(()=>restarted.close())
  const result=await restarted.importPack({pack,expectedRevision:0})
  assert.equal(db.imported.length,2);assert.equal(db.requests.at(-1).requestId,failedRequest)
  assert.deepEqual(result.mappings.databases[key('world',1)],{databaseId:'database-1',version:1})
  assert.deepEqual(result.mappings.databases[key('world',2)],{databaseId:'database-2',version:1})
})

test('resource IDs are remapped without treating prototype-shaped pack IDs as object ownership',async t=>{
  const{service,store}=await setup(t)
  const bytes=Buffer.from('public synthetic data'),sha256=createHash('sha256').update(bytes).digest('hex')
  const pack={format:'dsh-rp-story-pack',schemaVersion:1,assets:[{kind:'persona',asset:{id:'player',version:1,name:'旅人',description:'公开合成',avatarResourceId:'__proto__'}}],databases:[],profiles:[],storyTemplates:[],resources:[{id:'__proto__',mimeType:'image/png',sha256,dataBase64:bytes.toString('base64')}],requirements:[]}
  const result=await service.importPack({pack,expectedRevision:0}),mapped=result.mappings.assets[key('player',1)],asset=(await service.asset({kind:'persona',...mapped})).asset
  assert.equal(typeof asset.avatarResourceId,'string');assert.notEqual(asset.avatarResourceId,'__proto__')
  assert.equal((await store.resource({resourceId:asset.avatarResourceId})).dataBase64,bytes.toString('base64'))
})

test('template bindings obey the frozen SourceBinding slot contract before any import starts',async t=>{
  const{service}=await setup(t)
  const pack={format:'dsh-rp-story-pack',schemaVersion:1,assets:[{kind:'character',asset:{id:'c',version:1,name:'设定',openings:[{id:'first',name:'开场',text:'雾'}],databaseRefs:[]}},{kind:'persona',asset:{id:'p',version:1,name:'玩家',description:''}}],databases:[{id:'book',version:1,database:{id:'book',version:1,name:'资料',entries:[]}}],profiles:[],storyTemplates:[{id:'start',title:'起点',character:{assetId:'c',version:1},persona:{assetId:'p',version:1},openingId:'first',sources:[{key:'@session',databaseId:'book',version:1}],initialScene:{schemaVersion:1,title:'港口',location:'码头',presentActorIds:[]},initialFacts:{schemaVersion:1,items:[]}}],resources:[],requirements:[]}
  await assert.rejects(service.previewPack({pack}),{code:'INVALID_ASSET'})
})

test('optional SourcePayload provenance is reconstructed as inert parsed data without changing source bytes',async t=>{
  const{service}=await setup(t),raw='\ufeff{\r\n"name":"公开合成身份"\r\n}',sha256=createHash('sha256').update(raw).digest('hex')
  const pack={format:'dsh-rp-story-pack',schemaVersion:1,assets:[{kind:'persona',asset:{id:'player',version:1,name:'旅人',description:'',sourceId:'old-source'},source:{format:'persona-json',rawText:raw,sha256}}],databases:[],profiles:[],storyTemplates:[],resources:[],requirements:[]}
  const result=await service.importPack({pack,expectedRevision:0}),asset=(await service.asset({kind:'persona',...result.mappings.assets[key('player',1)]})).asset
  const{source}=await service.source({sourceId:asset.sourceId})
  assert.equal(source.rawText,raw);assert.equal(source.sha256,sha256);assert.deepEqual(source.provenance,{name:'公开合成身份'})
})

test('a provider requestId semantic conflict keeps the frozen REQUEST_ID_CONFLICT code',async t=>{
  const{service}=await setup(t,{rpDatabase:{contentRevision:async()=>({revision:0}),importContent:async()=>{throw Object.assign(new Error('PRIVATE BODY'),{code:'REQUEST_ID_CONFLICT',status:409})}}})
  const pack={format:'dsh-rp-story-pack',schemaVersion:1,assets:[],databases:[{id:'db',version:1,database:{id:'db',version:1,name:'data',entries:[]}}],profiles:[],storyTemplates:[],resources:[],requirements:[]}
  await assert.rejects(service.importPack({pack,expectedRevision:0}),error=>error.code==='REQUEST_ID_CONFLICT'&&!error.message.includes('PRIVATE'))
})
