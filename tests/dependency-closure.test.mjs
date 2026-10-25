import test from 'node:test'
import assert from 'node:assert/strict'
import {createSavedStoryCoordinator} from '../src/saved-story.mjs'
import {savedFixture} from './helpers/saved-fixture.mjs'
import {collectAssetDependencies} from '../src/dependencies.mjs'

const owner=environment=>createSavedStoryCoordinator({store:environment.store,host:environment.host,getOwner:environment.getOwner}),key=(id,version)=>JSON.stringify([id,version])

test('saved export/restore retains exact unused Character defaults as library-only dependencies while explicit runtime overrides remain',async t=>{
  const source=await savedFixture(t,{source:true,assetDefaults:true}),snapshot=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot
  assert.deepEqual(source.exportRequests.find(row=>row.owner==='database').additionalDatabaseRefs,[{databaseId:'World',version:1}]);assert.deepEqual(source.exportRequests.find(row=>row.owner==='lastStep').additionalProfileRefs,[{profileId:'Style',version:1},{profileId:'builtin',version:1}])
  assert.deepEqual(snapshot.pluginState.database.payload.libraries.map(item=>[item.id,item.version]),[['World',1]]);assert.equal(snapshot.pluginState.lastStep.payload.libraries.find(item=>item.id==='Style').status,'draft')
  const destination=await savedFixture(t);assert.equal((await owner(destination).restoreSavedStory({snapshot,restoreId:'defaults'})).status,'complete')
  assert.equal(destination.libraries.database.get(key('World',1)).version,1);assert.equal(destination.libraries.database.has(key('World',2)),false);assert.equal(destination.libraries.lastStep.get(key('Style',1)).status,'draft');assert.deepEqual(destination.runtimeBindings.database.get('child'),[]);assert.deepEqual(destination.runtimeBindings.lastStep.get('child'),{profileId:'builtin',version:1});assert.deepEqual(destination.bindings.get('child').sources,[]);assert.deepEqual(destination.bindings.get('child').profile,{profileId:'builtin',version:1});assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0})
})

test('missing exact pinned default version fails export with a safe ref instead of substituting the latest version',async t=>{
  const source=await savedFixture(t,{source:true,assetDefaults:true});source.libraries.database.delete(key('World',1))
  await assert.rejects(owner(source).exportSavedStory({sessionId:'child'}),error=>error.code==='EXPORT_REQUIREMENT_MISSING'&&error.diagnostics?.some(row=>row.ref?.databaseId==='World'&&row.ref.version===1)&&!error.message.includes('PRIVATE'))
  assert.equal(source.libraries.database.get(key('World',2)).version,2)
  const missingStyle=await savedFixture(t,{source:true,assetDefaults:true});missingStyle.libraries.lastStep.delete(key('Style',1))
  await assert.rejects(owner(missingStyle).exportSavedStory({sessionId:'child'}),error=>error.code==='EXPORT_REQUIREMENT_MISSING'&&error.diagnostics?.some(row=>row.ref?.profileId==='Style'&&row.ref.version===1))
})

test('dependency-use summary records the selected binding separately from asset defaults without using ancestor/private payload layouts',async t=>{
  const source=await savedFixture(t,{source:true,assetDefaults:true});source.runtimeBindings.database.set('parent',[{key:'ancestor',databaseId:'World',version:2}])
  const snapshot=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot
  assert.deepEqual(snapshot.dependencySummary,{databases:[{databaseId:'World',version:1,uses:['asset-default']}],profiles:[{profileId:'Style',version:1,uses:['asset-default']},{profileId:'builtin',version:1,uses:['current-binding']}]})
  assert.ok(snapshot.pluginState.database.payload.libraries.some(item=>item.version===2));const destination=await savedFixture(t),preview=await owner(destination).previewSavedStory({snapshot});assert.deepEqual(preview.dependencySummary,snapshot.dependencySummary)
  delete snapshot.dependencySummary;assert.equal(Object.hasOwn(await owner(destination).previewSavedStory({snapshot}),'dependencySummary'),false)
  source.runtimeBindings.database.set('child',[{key:'used-default',databaseId:'World',version:1}]);const both=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot.dependencySummary
  assert.deepEqual(both.databases,[{databaseId:'World',version:1,uses:['current-binding','asset-default']}])
})

test('an informational summary cannot drop actual typed dependencies or change restored runtime binding',async t=>{
  const source=await savedFixture(t,{source:true,assetDefaults:true}),snapshot=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot
  snapshot.dependencySummary={databases:[],profiles:[]};const destination=await savedFixture(t)
  assert.equal((await owner(destination).restoreSavedStory({snapshot,restoreId:'display-only'})).status,'complete');assert.equal(destination.libraries.database.get(key('World',1)).version,1);assert.equal(destination.libraries.lastStep.get(key('Style',1)).status,'draft');assert.deepEqual(destination.runtimeBindings.database.get('child'),[])
})

test('initial GM style remains retained provenance while current style and summary come only from LastStep',async t=>{
  const source=await savedFixture(t,{source:true,assetDefaults:true})
  source.libraries.lastStep.set(key('Initial',1),{id:'Initial',version:1,name:'初始文风',status:'ready',sourceId:null,entries:[]})
  for(const id of source.sessions.keys()){source.bindings.get(id).profile={profileId:'Initial',version:1};source.runtimeBindings.lastStep.set(id,{profileId:'Style',version:2})}
  const snapshot=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot
  assert.ok(source.exportRequests.find(row=>row.owner==='lastStep').additionalProfileRefs.some(ref=>ref.profileId==='Initial'&&ref.version===1));assert.equal(snapshot.dependencySummary.profiles.some(ref=>ref.profileId==='Initial'),false);assert.deepEqual(snapshot.dependencySummary.profiles.find(ref=>ref.profileId==='Style'&&ref.version===2).uses,['current-binding'])
  const destination=await savedFixture(t);assert.equal((await owner(destination).restoreSavedStory({snapshot,restoreId:'initial-vs-current'})).status,'complete');assert.equal(destination.libraries.lastStep.get(key('Initial',1)).version,1);assert.deepEqual(destination.bindings.get('child').profile,{profileId:'Initial',version:1});assert.deepEqual(destination.runtimeBindings.lastStep.get('child'),{profileId:'Style',version:2})
})

test('a dropped passive owner version cannot complete restoration even if an informational summary claims it exists',async t=>{
  const source=await savedFixture(t,{source:true,assetDefaults:true}),snapshot=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot
  snapshot.pluginState.database.payload.libraries=[]
  const destination=await savedFixture(t),result=await owner(destination).restoreSavedStory({snapshot,restoreId:'missing-passive'})
  assert.equal(result.status,'pending');assert.equal(result.diagnostics[0].code,'RESTORE_REQUIREMENT_MISSING');assert.equal(destination.log.includes('gm.activate'),false);assert.equal(destination.live.size,0)
})

test('collection follows typed pinned/template refs only and never invents V1 from document IDs or provenance strings',()=>{
  const projection={payload:{characters:[{databaseRefs:[{key:'typed',databaseId:'World',version:2}],profileRef:{profileId:'Style',version:2}}],launches:[{request:{sources:[{key:'template',databaseId:'TemplateBook',version:5}],profile:{profileId:'TemplateStyle',version:5}}}],sources:[{provenance:{document:{databaseId:'World'},databaseRefs:[{databaseId:'World',version:1}],profileRef:{profileId:'Style',version:1},url:'https://example.invalid/not-a-dependency'}}]}}
  assert.deepEqual(collectAssetDependencies(projection),{additionalDatabaseRefs:[{databaseId:'TemplateBook',version:5},{databaseId:'World',version:2}],additionalProfileRefs:[{profileId:'Style',version:2},{profileId:'TemplateStyle',version:5}]})
})
