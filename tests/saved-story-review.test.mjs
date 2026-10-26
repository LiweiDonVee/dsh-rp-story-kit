import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir} from 'node:fs/promises'
import {createSavedStoryCoordinator} from '../src/saved-story.mjs'
import {savedFixture} from './helpers/saved-fixture.mjs'

const coordinator=environment=>createSavedStoryCoordinator({store:environment.store,host:environment.host,getOwner:environment.getOwner})
const owners=['database','lastStep','context','gm']

// This is an opaque typed-provider fixture, not any production owner's payload
// schema or a substitute for that owner's canonical decision/revision proof.
async function providerSnapshot(t){
  const source=await savedFixture(t,{source:true}),envelopes={}
  for(const name of owners){
    const provider=source.services[name],exportState=provider.exportState
    provider.exportState=async input=>{
      const state=await exportState(input)
      state.payload.testOnlyOwnerExtension={owner:name,values:[null,false,{bytes:'unchanged\r\nowner data'}],approvalStatus:'approved'}
      envelopes[name]=structuredClone(state)
      return state
    }
  }
  return{snapshot:(await coordinator(source).exportSavedStory({sessionId:'child'})).snapshot,envelopes}
}

test('SavedStory keeps opaque owner extensions exact and requires each provider preflight and restore after original logs',async t=>{
  const{snapshot,envelopes}=await providerSnapshot(t),destination=await savedFixture(t),validated=new Set(),restored=new Set()
  for(const name of owners){
    const provider=destination.services[name],restoreState=provider.restoreState
    provider.preflightRestore=async input=>{assert.deepEqual(input.state,envelopes[name]);assert.deepEqual(input.sessionIds,['parent','child']);validated.add(name);return{supported:true,conflicts:[],requirements:[]}}
    provider.restoreState=async input=>{
      assert.ok(validated.has(name));assert.deepEqual(input.state,envelopes[name]);assert.deepEqual([...destination.sessions.values()],snapshot.sessions)
      const result=await restoreState(input);restored.add(name);return result
    }
  }
  const result=await coordinator(destination).restoreSavedStory({snapshot,restoreId:'opaque-provider'})
  assert.equal(result.status,'complete');assert.deepEqual([...restored],['database','lastStep','context','gm']);assert.deepEqual([...destination.sessions.values()],snapshot.sessions)
  assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0})
})

test('an uploaded approval label cannot bypass owner incompatibility or proof conflicts before destination writes',async t=>{
  const{snapshot}=await providerSnapshot(t)
  for(const refusal of [
    {supported:false,requirements:['dsh-rp-database:fact-review-v1'],conflicts:[]},
    {supported:false,requirements:[],conflicts:[{code:'DECISION_SOURCE_INVALID',id:'owner-decision'}]},
  ]){
    const destination=await savedFixture(t),owner=coordinator(destination)
    destination.services.database.preflightRestore=async()=>structuredClone(refusal)
    const preview=await owner.previewSavedStory({snapshot});assert.equal(preview.supported,false);assert.deepEqual(preview.requirements,refusal.requirements);assert.deepEqual(preview.conflicts,refusal.conflicts)
    await assert.rejects(owner.restoreSavedStory({snapshot,restoreId:'owner-refusal'}),{code:refusal.conflicts[0]?.code??'RESTORE_REQUIREMENT_MISSING'})
    assert.equal(destination.sessions.size,0);assert.equal(destination.log.length,0);assert.deepEqual(await readdir(destination.directory),[])
  }
})

test('an owner restore proof refusal keeps exact imported logs pending without approval or model recovery',async t=>{
  const{snapshot}=await providerSnapshot(t),destination=await savedFixture(t);let ownerActions=0
  for(const name of ['decideFacts','resumeFactDecision','resumeFactGeneration','resumeFactPresentation','regenerateFacts'])destination.services.gm[name]=async()=>{ownerActions++;throw new Error('restore must not request new owner work')}
  destination.services.database.restoreState=async()=>{throw Object.assign(new Error('PRIVATE unconfirmed owner decision'),{code:'DECISION_NOT_CONFIRMED',status:409})}
  const result=await coordinator(destination).restoreSavedStory({snapshot,restoreId:'unconfirmed-owner'})
  assert.equal(result.status,'pending');assert.equal(result.diagnostics[0].code,'DECISION_NOT_CONFIRMED');assert.equal(result.diagnostics[0].message.includes('PRIVATE'),false)
  assert.deepEqual([...destination.sessions.values()],snapshot.sessions);assert.equal(destination.log.includes('gm.activate'),false);assert.equal(ownerActions,0);assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0})
})
