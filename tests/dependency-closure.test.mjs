import test from 'node:test'
import assert from 'node:assert/strict'
import {createSavedStoryCoordinator} from '../src/saved-story.mjs'
import {savedFixture} from './helpers/saved-fixture.mjs'
import {collectAssetDependencies} from '../src/dependencies.mjs'
import {createLaunchService} from '../src/launch.mjs'

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

test('a persisted reviewed launch retains Initial dependencies without relabeling them as asset defaults after Current rebind',async t=>{
  const source=await savedFixture(t,{source:true,assetDefaults:true}),gm=source.getOwner('gm'),database=source.getOwner('database'),lastStep=source.getOwner('lastStep'),binding=source.bindings.get('child')
  for(const id of ['Initial','Current'])source.libraries.lastStep.set(key(id,1),{id,version:1,name:id,status:'ready',sourceId:null,entries:[]})
  for(const id of ['StartupBook','CurrentBook'])source.libraries.database.set(key(id,1),{id,version:1,name:id,entries:[]})
  const launch=createLaunchService({store:source.store,getGM:()=>({...gm,startStory:async request=>{Object.assign(binding,{launchId:request.launchId,character:request.character,persona:request.persona,opening:request.opening,examples:request.examples,sources:request.sources,profile:request.profile});return{sessionId:'child',binding,status:'active'}}}),getDatabase:()=>({...database,bindSources(){},initializeStoryState(){}}),getLastStep:()=>({...lastStep,bindSession(){},ensureBuiltinProfile(){}})})
  await launch.launch({launchId:'reviewed-initial',character:{assetId:binding.character.assetId,version:1},persona:{assetId:binding.persona.assetId,version:1},openingId:'first',sources:[{key:'startup',databaseId:'StartupBook',version:1}],profile:{profileId:'Initial',version:1},initialScene:{schemaVersion:1,title:'港口',location:'码头',presentActorIds:[]},initialFacts:{schemaVersion:1,items:[]}})
  source.runtimeBindings.database.set('child',[{key:'current',databaseId:'CurrentBook',version:1}]);source.runtimeBindings.lastStep.set('child',{profileId:'Current',version:1})
  const snapshot=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot
  assert.equal(snapshot.pluginState.storyKit.payload.launches.length,1)
  assert.deepEqual(snapshot.dependencySummary,{databases:[{databaseId:'CurrentBook',version:1,uses:['current-binding']},{databaseId:'World',version:1,uses:['asset-default']}],profiles:[{profileId:'Current',version:1,uses:['current-binding']},{profileId:'Style',version:1,uses:['asset-default']}]})
  assert.ok(snapshot.pluginState.database.payload.libraries.some(item=>item.id==='StartupBook'));assert.ok(snapshot.pluginState.lastStep.payload.libraries.some(item=>item.id==='Initial'))
  const destination=await savedFixture(t);assert.equal((await owner(destination).restoreSavedStory({snapshot,restoreId:'reviewed-initial'})).status,'complete');assert.equal(destination.libraries.lastStep.has(key('Initial',1)),true);assert.equal(destination.libraries.database.has(key('StartupBook',1)),true);assert.deepEqual(destination.runtimeBindings.lastStep.get('child'),{profileId:'Current',version:1});assert.equal(destination.libraries.lastStep.get(key('Style',1)).status,'draft')
})

test('a dropped passive owner version cannot complete restoration even if an informational summary claims it exists',async t=>{
  const source=await savedFixture(t,{source:true,assetDefaults:true}),snapshot=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot
  snapshot.pluginState.database.payload.libraries=[]
  const destination=await savedFixture(t),result=await owner(destination).restoreSavedStory({snapshot,restoreId:'missing-passive'})
  assert.equal(result.status,'pending');assert.equal(result.diagnostics[0].code,'RESTORE_REQUIREMENT_MISSING');assert.equal(destination.log.includes('gm.activate'),false);assert.equal(destination.live.size,0)
})

test('closure follows typed pinned/launch refs only and never invents V1 from document IDs or provenance strings',()=>{
  const projection={payload:{characters:[{databaseRefs:[{key:'typed',databaseId:'World',version:2}],profileRef:{profileId:'Style',version:2}}],launches:[{request:{sources:[{key:'template',databaseId:'TemplateBook',version:5}],profile:{profileId:'TemplateStyle',version:5}}}],sources:[{provenance:{document:{databaseId:'World'},databaseRefs:[{databaseId:'World',version:1}],profileRef:{profileId:'Style',version:1},url:'https://example.invalid/not-a-dependency'}}]}}
  assert.deepEqual(collectAssetDependencies(projection),{additionalDatabaseRefs:[{databaseId:'TemplateBook',version:5},{databaseId:'World',version:2}],additionalProfileRefs:[{profileId:'Style',version:2},{profileId:'TemplateStyle',version:5}]})
})

test('initial GM source libraries survive without a StoryKit launch journal while current composition stays authoritative',async t=>{
  const source=await savedFixture(t,{source:true})
  for(const id of ['InitialSource','CurrentSource'])source.libraries.database.set(key(id,1),{id,version:1,name:id,entries:[]})
  for(const id of source.sessions.keys())source.bindings.get(id).sources=[{key:'initial-slot',databaseId:'InitialSource',version:1}]
  source.runtimeBindings.database.set('child',[{key:'current-slot',databaseId:'CurrentSource',version:1}])
  const snapshot=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot
  assert.deepEqual(snapshot.pluginState.storyKit.payload.launches,[]);assert.deepEqual(source.exportRequests.find(row=>row.owner==='database').additionalDatabaseRefs,[{databaseId:'InitialSource',version:1}]);assert.deepEqual(snapshot.dependencySummary.databases,[{databaseId:'CurrentSource',version:1,uses:['current-binding']}])
  const destination=await savedFixture(t);assert.equal((await owner(destination).restoreSavedStory({snapshot,restoreId:'initial-sources-no-journal'})).status,'complete');assert.equal(destination.libraries.database.has(key('InitialSource',1)),true);assert.deepEqual(destination.runtimeBindings.database.get('child'),[{key:'current-slot',databaseId:'CurrentSource',version:1}]);assert.deepEqual(destination.bindings.get('child').sources,[{key:'initial-slot',databaseId:'InitialSource',version:1}])
  const dropped=structuredClone(snapshot);dropped.pluginState.database.payload.libraries=dropped.pluginState.database.payload.libraries.filter(item=>item.id!=='InitialSource');const incomplete=await savedFixture(t);assert.equal((await owner(incomplete).restoreSavedStory({snapshot:dropped,restoreId:'missing-initial-source'})).status,'pending');assert.equal(incomplete.log.includes('gm.activate'),false)
  source.runtimeBindings.database.set('child',[{key:'initial-slot',databaseId:'InitialSource',version:1},{key:'added-slot',databaseId:'CurrentSource',version:1}]);const appended=(await owner(source).exportSavedStory({sessionId:'child'})).snapshot,addedDestination=await savedFixture(t)
  assert.equal((await owner(addedDestination).restoreSavedStory({snapshot:appended,restoreId:'initial-plus-added'})).status,'complete');assert.deepEqual(addedDestination.runtimeBindings.database.get('child'),source.runtimeBindings.database.get('child'));assert.deepEqual(addedDestination.bindings.get('child').sources,[{key:'initial-slot',databaseId:'InitialSource',version:1}]);assert.equal(appended.dependencySummary.databases.every(item=>item.uses.length===1&&item.uses[0]==='current-binding'),true)
})

test('missing an initial-only exact GM source fails export instead of guessing a newer library version',async t=>{
  const source=await savedFixture(t,{source:true});source.libraries.database.set(key('InitialSource',2),{id:'InitialSource',version:2,name:'newer',entries:[]});source.bindings.get('child').sources=[{key:'initial',databaseId:'InitialSource',version:1}]
  await assert.rejects(owner(source).exportSavedStory({sessionId:'child'}),error=>error.code==='EXPORT_REQUIREMENT_MISSING'&&error.diagnostics?.some(item=>item.ref?.databaseId==='InitialSource'&&item.ref.version===1))
})
