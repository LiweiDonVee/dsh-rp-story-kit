import test from 'node:test'
import assert from 'node:assert/strict'
import {savedFixture} from './helpers/saved-fixture.mjs'
import {installNativeWriter} from './helpers/native-writer.mjs'
import {createSavedStoryCoordinator} from '../src/saved-story.mjs'

const coordinator=env=>createSavedStoryCoordinator({store:env.store,host:env.host,getOwner:env.getOwner})
async function setup(t){const source=await savedFixture(t,{source:true}),snapshot=(await coordinator(source).exportSavedStory({sessionId:'child'})).snapshot,destination=await savedFixture(t),writer=installNativeWriter(destination);return{snapshot,destination,writer}}
const prefix=session=>({...structuredClone(session),events:structuredClone(session.events.slice(0,1))})

test('a reserved ID whose create never began cannot claim a later foreign matching prefix on retry',async t=>{
  const{snapshot,destination,writer}=await setup(t),write=destination.host.writeSession;let interrupted=false
  destination.host.writeSession=input=>{if(!interrupted){interrupted=true;throw Object.assign(new Error('before create'),{code:'UNAVAILABLE'})}return write(input)}
  assert.equal((await coordinator(destination).restoreSavedStory({snapshot,restoreId:'not-created'})).status,'pending');assert.equal(destination.sessions.size,0)
  const job=Object.values((await destination.store.rawState()).restoreJobs)[0];assert.deepEqual(job.createdIds,[])
  await destination.store.updateInternal(data=>{const legacy=Object.values(data.restoreJobs)[0];legacy.ownedIds=[...legacy.sessionIds];delete legacy.createdIds;return{}})
  const foreign=prefix(snapshot.sessions[0]);destination.sessions.set(foreign.header.id,foreign);const before=JSON.stringify(foreign);destination.restart()
  await assert.rejects(coordinator(destination).restoreSavedStory({snapshot,restoreId:'not-created'}),{code:'RESTORE_ID_CONFLICT'});assert.equal(JSON.stringify(destination.sessions.get(foreign.header.id)),before);assert.equal(writer.calls.some(row=>row.kind==='append'),false)
})

test('a foreign ID appearing after preflight/reserve is never opened for write despite identical header/prefix',async t=>{
  const{snapshot,destination,writer}=await setup(t),reserve=destination.services.gm.reserveRestore,foreign=prefix(snapshot.sessions[1]),before=JSON.stringify(foreign)
  destination.services.gm.reserveRestore=async input=>{await reserve(input);destination.sessions.set(foreign.header.id,structuredClone(foreign))}
  await assert.rejects(coordinator(destination).restoreSavedStory({snapshot,restoreId:'reserve-race'}),{code:'RESTORE_ID_CONFLICT'})
  assert.equal(JSON.stringify(destination.sessions.get(foreign.header.id)),before);assert.equal(writer.calls.some(row=>row.id===foreign.header.id&&['open','append','created'].includes(row.kind)),false);assert.equal(destination.log.includes('gm.activate'),false)
})

test('atomic public create losing a race reports RESTORE_ID_CONFLICT and leaves the winner unchanged',async t=>{
  const{snapshot,destination,writer}=await setup(t),create=writer.persistence.create,foreign=prefix(snapshot.sessions[0]),before=JSON.stringify(foreign)
  writer.persistence.create=async(header,options)=>{if(header.id===foreign.header.id)destination.sessions.set(header.id,structuredClone(foreign));return create(header,options)}
  await assert.rejects(coordinator(destination).restoreSavedStory({snapshot,restoreId:'create-race'}),{code:'RESTORE_ID_CONFLICT'});assert.equal(JSON.stringify(destination.sessions.get(foreign.header.id)),before);assert.equal(writer.calls.some(row=>row.kind==='append'),false)
})

test('only a durable successful public create records ownership before append and survives a lost write acknowledgement',async t=>{
  const{snapshot,destination,writer}=await setup(t),write=destination.host.writeSession;let interrupted=false
  destination.host.writeSession=async input=>{await write({...input,onCreated:async()=>{assert.ok(writer.flushed.has(input.session.header.id));assert.equal(destination.sessions.get(input.session.header.id).events.length,0);await input.onCreated()}});if(!interrupted){interrupted=true;throw Object.assign(new Error('after write'),{code:'UNAVAILABLE'})}}
  assert.equal((await coordinator(destination).restoreSavedStory({snapshot,restoreId:'created'})).status,'pending');const job=Object.values((await destination.store.rawState()).restoreJobs)[0];assert.deepEqual(job.createdIds,['parent']);assert.ok(writer.flushed.has('parent'))
  destination.restart();assert.equal((await coordinator(destination).restoreSavedStory({snapshot,restoreId:'created'})).status,'complete');assert.deepEqual(writer.calls.filter(row=>row.kind==='created').map(row=>row.id),['parent','child']);assert.equal(writer.calls.filter(row=>row.kind==='append'&&row.id==='parent').length,1)
})

test('a public create with lost local creation proof is refused rather than adopted from matching contents',async t=>{
  const{snapshot,destination,writer}=await setup(t),write=destination.host.writeSession
  destination.host.writeSession=input=>write({...input,onCreated:async()=>{throw Object.assign(new Error('creation checkpoint unavailable'),{code:'UNAVAILABLE'})}})
  assert.equal((await coordinator(destination).restoreSavedStory({snapshot,restoreId:'unproven'})).status,'pending');assert.equal(destination.sessions.size,1);assert.equal(writer.calls.some(row=>row.kind==='append'),false)
  const before=JSON.stringify([...destination.sessions]);destination.host.writeSession=write;destination.restart()
  await assert.rejects(coordinator(destination).restoreSavedStory({snapshot,restoreId:'unproven'}),{code:'RESTORE_ID_CONFLICT'});assert.equal(JSON.stringify([...destination.sessions]),before)
})
