import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {savedFixture} from './helpers/saved-fixture.mjs'

const api=await import('../src/saved-story.mjs').catch(()=>({}))
function coordinator(environment){assert.equal(typeof api.createSavedStoryCoordinator,'function');return api.createSavedStoryCoordinator({store:environment.store,host:environment.host,getOwner:environment.getOwner})}
async function snapshot(t,options){const source=await savedFixture(t,{source:true,...options});return{source,snapshot:(await coordinator(source).exportSavedStory({sessionId:'child'})).snapshot}}

test('saved export carries complete ancestry, authoritative seed counts and only scoped plugin state',async t=>{
  const{snapshot:result}=await snapshot(t)
  assert.equal(result.identityMode,'preserve');assert.deepEqual(result.sessions.map(item=>item.header.id),['parent','child']);assert.equal(result.sessions[1].inheritedEventCount,1);assert.equal(result.pluginState.storyKit.payload.characters.length,1);assert.equal(result.loopPolicies.length,2)
})
test('stable export refuses changing content revisions and missing authoritative inherited metadata',async t=>{
  const source=await savedFixture(t,{source:true});source.flags.changeDuringExport=true;await assert.rejects(coordinator(source).exportSavedStory({sessionId:'child'}),{code:'EXPORT_CHANGED'})
  source.flags.changeDuringExport=false;delete source.sessions.get('child').inheritedEventCount;await assert.rejects(coordinator(source).exportSavedStory({sessionId:'child'}),{code:'EXPORT_SOURCE_METADATA_MISSING'})
})

test('an idle source with durable queued input is not exported as a safely resumable story',async t=>{
  const source=await savedFixture(t,{source:true}),read=source.host.readSession
  source.host.readSession=async input=>({...await read(input),projections:{values:{inbox:{'next-turn':[{id:'queued-owner-input'}],'next-step':[]}}}})
  await assert.rejects(coordinator(source).exportSavedStory({sessionId:'child'}),{code:'EXPORT_CHANGED'})
})
test('preview is read-only, reports unavailable models and makes actual node eligibility explicitly deferred',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t),owner=coordinator(destination),preview=await owner.previewSavedStory({snapshot:bundle})
  assert.equal(preview.supported,true);assert.equal(preview.deferredChecks[0].code,'LOOP_NODE_VALIDATION');assert.equal(destination.sessions.size,0);assert.equal(destination.log.length,0);assert.deepEqual(await readdir(destination.directory),[])
  destination.flags.missingModel=true;const missing=await owner.previewSavedStory({snapshot:bundle});assert.equal(missing.supported,false);assert.ok(missing.requirements.includes('model:missing/story'));assert.equal(destination.sessions.size,0)
})

test('saved capabilities reject incompatible declared Database/GM versions before any destination change',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t),owner=coordinator(destination);destination.services.database.apiVersion=1
  assert.equal(owner.restoreAvailable(),false);const preview=await owner.previewSavedStory({snapshot:bundle});assert.equal(preview.supported,false);assert.ok(preview.requirements.includes('dsh-rp-database:api-v2'));assert.equal(destination.sessions.size,0)
})
test('exact restore reserves, cold-validates, restores LastStep before Context, resumes without prompting and applies only session policy',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t),result=await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'job-one'})
  assert.equal(result.status,'complete');assert.deepEqual([...destination.sessions.values()],bundle.sessions);assert.ok(destination.log.indexOf('gm.reserve')<destination.log.indexOf('session.write:parent'));assert.ok(destination.log.indexOf('lastStep.restore')<destination.log.indexOf('context.restore'));assert.ok(destination.log.indexOf('session.cold:child')<destination.log.indexOf('database.restore'));assert.ok(destination.log.indexOf('session.resume:child')<destination.log.indexOf('loop.save:child'));assert.equal(destination.log.at(-1),'gm.activate');assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0})
})
test('identity collisions and changed restoreId payload fail without destination mutation',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t),owner=coordinator(destination);destination.sessions.set('child',structuredClone(bundle.sessions[1]))
  assert.equal((await owner.previewSavedStory({snapshot:bundle})).conflicts[0].code,'RESTORE_ID_CONFLICT');await assert.rejects(owner.restoreSavedStory({snapshot:bundle,restoreId:'collision'}),{code:'RESTORE_ID_CONFLICT'});assert.equal(destination.sessions.size,1);assert.deepEqual(await readdir(destination.directory),[])
  destination.sessions.clear();await owner.restoreSavedStory({snapshot:bundle,restoreId:'idempotent'});const before=await readFile(join(destination.directory,'story-kit-store.json'),'utf8'),changed=structuredClone(bundle);changed.pluginState.database.payload.changed=true
  await assert.rejects(owner.restoreSavedStory({snapshot:changed,restoreId:'idempotent'}),{code:'RESTORE_ID_CONFLICT'});assert.equal(await readFile(join(destination.directory,'story-kit-store.json'),'utf8'),before)
})
test('restart continues an interrupted exact log write and owner-state phase without duplicate Sessions',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t);destination.flags.failAfterWrite=true
  const first=await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'resume'});assert.equal(first.status,'pending');assert.equal(destination.counters().creates,1)
  destination.restart();destination.flags.failContext=true;const second=await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'resume'});assert.equal(second.status,'pending');assert.equal(destination.log.includes('gm.activate'),false)
  destination.restart();const third=await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'resume'});assert.equal(third.status,'complete');assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0});assert.deepEqual([...destination.sessions.values()],bundle.sessions)
})
test('deferred route failure stays restoring/pending until actual graph supports the preserved node',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t);destination.flags.badNode=true
  const first=await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'routes'});assert.equal(first.status,'pending');assert.equal(destination.bindings.get('child').status,'restoring');assert.equal(destination.log.includes('gm.activate'),false)
  const resumesBefore=destination.log.filter(item=>item.startsWith('session.resume:')).length
  destination.flags.badNode=false;destination.restart();assert.equal(destination.live.size,0);const next=await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'routes'});assert.equal(next.status,'complete');assert.deepEqual(destination.loopPolicies.get('child'),bundle.loopPolicies[1].policy);assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0});assert.equal(destination.live.size,2);assert.equal(destination.log.filter(item=>item.startsWith('session.resume:')).length,resumesBefore+2)
})
test('absent source Context is null and destination Context is configured disabled rather than given fabricated state',async t=>{
  const{snapshot:bundle}=await snapshot(t,{context:false,loop:false}),destination=await savedFixture(t,{context:false,loop:false});assert.equal(bundle.pluginState.context,null);destination.services.context=destination.configureContext()
  const result=await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'no-context'});assert.equal(result.status,'complete');assert.equal(destination.log.includes('context.restore'),false);assert.equal(destination.contextSettings.get('child').enabled,false)
})

test('coordinator checks an existing restore identity before deeper canonical payload validation',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t),owner=coordinator(destination);await owner.restoreSavedStory({snapshot:bundle,restoreId:'identity-first'})
  const changed=structuredClone(bundle);changed.sessions[0].events[0].seq=8
  await assert.rejects(owner.restoreSavedStory({snapshot:changed,restoreId:'identity-first'}),{code:'RESTORE_ID_CONFLICT'})
  await assert.rejects(owner.restoreSavedStory({snapshot:{...changed,sessions:'malformed'},restoreId:'identity-first'}),{code:'RESTORE_PAYLOAD_INVALID'})
})

test('a pending post-resume route check accepts only the expected native end-seed suffix on retry',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t);destination.flags.appendResumeMarker=true;destination.flags.badNode=true
  assert.equal((await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'end-seed'})).status,'pending')
  destination.restart();destination.flags.badNode=false;assert.equal((await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'end-seed'})).status,'complete')
  for(const session of bundle.sessions){const actual=destination.sessions.get(session.header.id);assert.deepEqual(actual.events.slice(0,session.events.length),session.events);assert.equal(actual.events.at(-1).type,'session/end-seed')}
  assert.equal(destination.counters().creates,2)
})

test('a lost resume acknowledgement is recoverable from persisted intent without appending another seed marker',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t),resume=destination.host.resumeSession;destination.flags.appendResumeMarker=true;let interrupt=true
  destination.host.resumeSession=async input=>{const result=await resume(input);if(interrupt){interrupt=false;throw Object.assign(new Error('lost resume acknowledgement'),{code:'UNAVAILABLE',status:503})}return result}
  assert.equal((await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'resume-intent'})).status,'pending')
  destination.restart();destination.live.clear();assert.equal((await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'resume-intent'})).status,'complete')
  for(const record of destination.sessions.values())assert.equal(record.events.filter(event=>event.type==='session/end-seed').length,1)
  assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0})
})

test('a lost activation acknowledgement is finalized from actual non-restoring bindings without activating twice',async t=>{
  const{snapshot:bundle}=await snapshot(t),destination=await savedFixture(t),activate=destination.services.gm.activateRestored;let calls=0
  destination.services.gm.activateRestored=async input=>{calls++;await activate(input);if(calls===1)throw Object.assign(new Error('lost acknowledgement'),{code:'UNAVAILABLE',status:503})}
  assert.equal((await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'activation-intent'})).status,'pending');assert.equal(destination.bindings.get('child').status,'active')
  destination.restart();assert.equal((await coordinator(destination).restoreSavedStory({snapshot:bundle,restoreId:'activation-intent'})).status,'complete');assert.equal(calls,1);assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0})
})

test('present but incompatible Loop service disables export capability consistently with execution',async t=>{
  const source=await savedFixture(t,{source:true});source.services.loop={inspect:async()=>{throw new Error('must not call incompatible service')}}
  const owner=coordinator(source);assert.equal(owner.exportAvailable(),false);await assert.rejects(owner.exportSavedStory({sessionId:'child'}),{code:'RESTORE_REQUIREMENT_MISSING'})
})
