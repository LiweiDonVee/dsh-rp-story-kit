import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createStoryKitStore} from '../src/store.mjs'
import {createStoryKitHost} from '../src/host.mjs'

const api=await import('../src/seeds.mjs').catch(()=>({}))
const scene={schemaVersion:1,title:'公开合成港口',location:'码头',presentActorIds:['keeper']},facts={schemaVersion:1,items:[{id:'tide',text:'已经退潮'}]}
function validate(value){assert.equal(typeof api.validateStorySeed,'function','shared reviewed-seed validator is available');return api.validateStorySeed(value)}

test('reviewed scene/facts retain the exact schema and return an independent seed snapshot',()=>{
  const input={initialScene:{...scene,time:'清晨'},initialFacts:structuredClone(facts)},result=validate(input)
  assert.deepEqual(result,{initialScene:{schemaVersion:1,title:'公开合成港口',location:'码头',time:'清晨',presentActorIds:['keeper']},initialFacts:{schemaVersion:1,items:[{id:'tide',text:'已经退潮'}]}})
  input.initialScene.presentActorIds.push('later');input.initialFacts.items[0].text='后来发生'
  assert.deepEqual(result.initialScene.presentActorIds,['keeper']);assert.equal(result.initialFacts.items[0].text,'已经退潮')
  assert.deepEqual(validate({initialScene:scene,initialFacts:{schemaVersion:1,items:[]}}).initialFacts,{schemaVersion:1,items:[]})
})

test('reviewed scene rejects missing fields, wrong versions/types and undeclared fields',()=>{
  const missingTitle={...scene};delete missingTitle.title
  const missingLocation={...scene};delete missingLocation.location
  for(const initialScene of [undefined,[],missingTitle,missingLocation,{...scene,schemaVersion:'1'},{...scene,title:7},{...scene,location:null},{...scene,presentActorIds:'keeper'},{...scene,presentActorIds:[1]},{...scene,time:42},{...scene,extra:true}])assert.throws(()=>validate({initialScene,initialFacts:facts}),{code:'INVALID_SEED'})
})

test('reviewed facts reject bare arrays, malformed entries and duplicate IDs without normalizing them',()=>{
  for(const initialFacts of [undefined,[],{schemaVersion:2,items:[]},{schemaVersion:1},{schemaVersion:1,items:'facts'},{schemaVersion:1,items:[{id:1,text:'x'}]},{schemaVersion:1,items:[{id:'one'}]},{schemaVersion:1,items:[{id:'one',text:'x',extra:true}]},{schemaVersion:1,items:[{id:'same',text:'x'},{id:'same',text:'y'}]},{...facts,extra:true}])assert.throws(()=>validate({initialScene:scene,initialFacts}),{code:'INVALID_SEED'})
})

test('template preview/import rejects invalid reviewed seeds before provider writes or local journal creation',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'story-kit-seed-'));t.after(()=>rm(directory,{recursive:true,force:true}));let writes=0
  const database={contentRevision:async()=>({revision:0}),importContent:async()=>{writes++;return{revision:1,databaseId:'new-book',version:1}}},store=createStoryKitStore({directory}),service=await createStoryKitHost({get:name=>name==='rpDatabase'?database:undefined},{store});t.after(()=>service.close())
  const template={id:'start',title:'公开合成起点',character:{assetId:'c',version:1},persona:{assetId:'p',version:1},openingId:'first',sources:[],initialScene:scene,initialFacts:facts}
  const base={format:'dsh-rp-story-pack',schemaVersion:1,assets:[{kind:'character',asset:{id:'c',version:1,name:'设定',openings:[{id:'first',name:'开场',text:'雾'}],databaseRefs:[]}},{kind:'persona',asset:{id:'p',version:1,name:'玩家',description:''}}],databases:[{id:'book',version:1,database:{id:'book',version:1,name:'资料',entries:[]}}],profiles:[],storyTemplates:[],resources:[],requirements:['dsh-rp-database']}
  for(const changes of [{initialScene:undefined},{initialScene:{title:'缺少严格字段'}},{initialScene:{...scene,presentActorIds:[1]}},{initialFacts:[]},{initialFacts:{schemaVersion:1,items:[{id:'same',text:'甲'},{id:'same',text:'乙'}]}}]){
    const reviewed={...template,...changes};if(Object.hasOwn(changes,'initialScene')&&changes.initialScene===undefined)delete reviewed.initialScene
    const pack={...base,storyTemplates:[reviewed]}
    await assert.rejects(service.previewPack({pack}),{code:'INVALID_SEED'});await assert.rejects(service.importPack({pack,expectedRevision:0}),{code:'INVALID_SEED'})
  }
  assert.equal(writes,0);assert.deepEqual(await readdir(directory),[]);assert.equal((await service.state({})).revision,0)
})
