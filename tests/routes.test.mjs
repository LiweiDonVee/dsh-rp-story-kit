import test from 'node:test'
import assert from 'node:assert/strict'
import {StoryKitError} from '../src/assets.mjs'

const api=await import('../src/routes.mjs').catch(()=>({}))
const request=input=>new Request('http://localhost/api/rp-story-kit/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})
function routes(service={}){assert.equal(typeof api.createStoryKitRoutes,'function','exact owner route boundary is available');return api.createStoryKitRoutes(service)}

test('owner route dispatches exact asset DTOs and adds the transport signal',async()=>{
  let received
  const owner=routes({importAsset:async input=>{received=input;return{revision:1,assetId:'card',version:1,sourceId:'source',diagnostics:[],embeddedWorldbooks:[]}}})
  const result=await owner.request(request({action:'importAsset',format:'json',rawText:'{}',expectedRevision:0}))
  assert.equal(result.status,200);assert.equal((await result.json()).assetId,'card');assert.equal(received.rawText,'{}');assert.ok(received.signal instanceof AbortSignal)
})

test('template route accepts only its exact ID and carries the transport cancellation signal',async()=>{
  const seen=[],owner=routes({template:async input=>{seen.push(input);return{revision:3,template:{id:input.templateId,title:'公开模板'}}}})
  const response=await owner.request(request({action:'template',templateId:'saved-template'}))
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
  assert.deepEqual(await response.json(),{revision:3,template:{id:'saved-template',title:'公开模板'}})
  assert.equal(seen[0].templateId,'saved-template');assert.ok(seen[0].signal instanceof AbortSignal)
  for(const input of [{action:'template'},{action:'template',templateId:''},{action:'template',templateId:' \t '},{action:'template',templateId:7},{action:'template',templateId:'x'.repeat(257)},{action:'template',templateId:'saved-template',version:1},{action:'template',templateId:'saved-template',initialFacts:{schemaVersion:1,items:[]}}]){
    const invalid=await owner.request(request(input));assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,'INVALID_REQUEST')
  }
  assert.equal(seen.length,1)
})

test('missing template uses the existing structured owner error response',async()=>{
  const owner=routes({template:async()=>{throw new StoryKitError('TEMPLATE_NOT_FOUND','找不到所选故事模板。',404)}})
  const response=await owner.request(request({action:'template',templateId:'missing'}))
  assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store')
  assert.deepEqual(await response.json(),{error:{code:'TEMPLATE_NOT_FOUND',message:'找不到所选故事模板。',diagnostics:[]}})
})

test('unknown actions, extra DTO fields and wrong byte/text combinations are rejected before dispatch',async()=>{
  let calls=0
  const owner=routes({importAsset:async()=>{calls++;return{}},savePersona:async()=>{calls++;return{}}})
  for(const input of [{action:'arbitraryRemote',url:'http://bad'},{action:'importAsset',format:'json',rawText:'{}',dataBase64:'e30=',expectedRevision:0},{action:'importAsset',format:'png',rawText:'{}',expectedRevision:0},{action:'savePersona',persona:{id:'p',version:1,name:'p',description:''},expectedRevision:0,ready:true},{action:'savePersona',persona:{name:'p'},expectedRevision:-1}]){
    const result=await owner.request(request(input));assert.equal(result.status,400);assert.equal((await result.json()).error.code,'INVALID_REQUEST')
  }
  assert.equal(calls,0)
})

test('SSE emits only metadata and unsubscribes on owner cancellation',async()=>{
  let listener,closed=0
  const owner=routes({state:async()=>({revision:2,characters:[{name:'PRIVATE'}]}),subscribe:next=>{listener=next;return()=>closed++}})
  const controller=new AbortController(),response=await owner.events(new Request('http://localhost/api/rp-story-kit/events',{signal:controller.signal})),reader=response.body.getReader(),decoder=new TextDecoder()
  const first=decoder.decode((await reader.read()).value);assert.match(first,/connected/u);assert.doesNotMatch(first,/PRIVATE/u)
  listener({revision:3,asset:{name:'SOURCE PRIVATE'}})
  const changed=decoder.decode((await reader.read()).value);assert.match(changed,/"revision":3/u);assert.doesNotMatch(changed,/SOURCE PRIVATE/u)
  controller.abort();await reader.cancel();assert.equal(closed,1);owner.close()
})

test('new owner routes accept only frozen launch-resume and saved-story DTOs',async()=>{
  const seen=[],owner=routes({resumeLaunch:async input=>{seen.push(['resume',input]);return{sessionId:'story',status:'starting',binding:{}}},previewSavedStory:async input=>{seen.push(['preview',input]);return{supported:false,conflicts:[],requirements:['missing'],identityMode:'preserve',deferredChecks:[]}},restoreSavedStory:async input=>{seen.push(['restore',input]);return{status:'pending',sessionId:'story',diagnostics:[]}}})
  for(const input of [{action:'resumeLaunch',launchId:'launch'},{action:'previewSavedStory',snapshot:{}},{action:'restoreSavedStory',snapshot:{},restoreId:'restore'}])assert.equal((await owner.request(request(input))).status,200)
  assert.equal(seen.length,3);assert.ok(seen.every(([,input])=>input.signal instanceof AbortSignal))
  for(const input of [{action:'resumeLaunch',launchId:'launch',initialFacts:[]},{action:'restoreSavedStory',snapshot:{},restoreId:'restore',sessionIds:['foreign']},{action:'previewSavedStory',snapshot:{},service:'arbitrary'},{action:'restoreSavedStory',snapshot:{},restoreId:''}])assert.equal((await owner.request(request(input))).status,400)
  assert.equal(seen.length,3)
})
