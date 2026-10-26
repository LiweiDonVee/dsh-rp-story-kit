import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir} from 'node:fs/promises'
import {createSavedStoryCoordinator} from '../src/saved-story.mjs'
import {savedFixture} from './helpers/saved-fixture.mjs'

const coordinator=environment=>createSavedStoryCoordinator({store:environment.store,host:environment.host,getOwner:environment.getOwner})
async function routeSnapshot(t,nodeId='rp-gm.revise'){
  const source=await savedFixture(t,{source:true})
  for(const id of source.sessions.keys())source.loopPolicies.set(id,{enabled:true,routes:{[nodeId]:{provider:'local',model:'reviser'}}})
  return(await coordinator(source).exportSavedStory({sessionId:'child'})).snapshot
}

test('published GM revise policy is recognized with actual graph validation still deferred',async t=>{
  const snapshot=await routeSnapshot(t),destination=await savedFixture(t),preview=await coordinator(destination).previewSavedStory({snapshot})
  assert.equal(preview.supported,true);assert.deepEqual(preview.requirements,[])
  assert.deepEqual(preview.deferredChecks,[{code:'LOOP_NODE_VALIDATION',sessionId:'parent',nodeIds:['rp-gm.revise']},{code:'LOOP_NODE_VALIDATION',sessionId:'child',nodeIds:['rp-gm.revise']}])
  assert.equal(destination.sessions.size,0);assert.equal(destination.log.length,0);assert.deepEqual(await readdir(destination.directory),[])
})

test('GM revise policy retains GM and model dependency requirements before writes',async t=>{
  const snapshot=await routeSnapshot(t),destination=await savedFixture(t),owner=coordinator(destination),gm=destination.services.gm
  delete destination.services.gm
  const missingGM=await owner.previewSavedStory({snapshot});assert.equal(missingGM.supported,false);assert.ok(missingGM.requirements.includes('dsh-rp-gm'));assert.equal(owner.restoreAvailable(),false)
  destination.services.gm=gm;snapshot.loopPolicies[0].policy.routes['rp-gm.revise']={provider:'missing',model:'reviser'}
  const missingModel=await owner.previewSavedStory({snapshot});assert.equal(missingModel.supported,false);assert.ok(missingModel.requirements.includes('model:missing/reviser'))
  assert.equal(destination.sessions.size,0);assert.equal(destination.log.length,0)
})

test('recognized GM revise node still blocks activation until the actual resumed graph supports route control',async t=>{
  const snapshot=await routeSnapshot(t)
  for(const unsupported of ['missing','observe']){
    const destination=await savedFixture(t),owner=coordinator(destination),inspect=destination.services.loop.inspect;let control=unsupported
    destination.services.loop.inspect=async(...args)=>{const view=await inspect(...args);if(control!=='missing')view.graph.nodes.push({id:'rp-gm.revise',control});return view}
    assert.equal((await owner.previewSavedStory({snapshot})).supported,true)
    const pending=await owner.restoreSavedStory({snapshot,restoreId:'revise-route-'+unsupported})
    assert.equal(pending.status,'pending');assert.equal(pending.diagnostics[0].code,'RESTORE_REQUIREMENT_MISSING');assert.equal(destination.log.includes('gm.activate'),false);assert.equal(destination.bindings.get('child').status,'restoring');assert.deepEqual([...destination.sessions.values()],snapshot.sessions)
    destination.restart();control='route'
    const restored=await coordinator(destination).restoreSavedStory({snapshot,restoreId:'revise-route-'+unsupported})
    assert.equal(restored.status,'complete');assert.deepEqual(destination.loopPolicies.get('child'),snapshot.loopPolicies[1].policy);assert.deepEqual(destination.counters(),{creates:2,modelCalls:0,toolCalls:0})
  }
})

test('other unpublished GM nodes remain unsupported before destination writes',async t=>{
  const snapshot=await routeSnapshot(t,'rp-gm.unpublished'),destination=await savedFixture(t),owner=coordinator(destination),preview=await owner.previewSavedStory({snapshot})
  assert.equal(preview.supported,false);assert.ok(preview.requirements.includes('loop-node:rp-gm.unpublished'))
  await assert.rejects(owner.restoreSavedStory({snapshot,restoreId:'unknown-route'}),{code:'RESTORE_REQUIREMENT_MISSING'})
  assert.equal(destination.sessions.size,0);assert.equal(destination.log.length,0);assert.deepEqual(await readdir(destination.directory),[])
})
