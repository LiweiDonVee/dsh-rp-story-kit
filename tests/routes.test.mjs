import test from 'node:test'
import assert from 'node:assert/strict'

const api=await import('../src/routes.mjs').catch(()=>({}))
const request=input=>new Request('http://localhost/api/rp-story-kit/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})
function routes(service={}){assert.equal(typeof api.createStoryKitRoutes,'function','exact owner route boundary is available');return api.createStoryKitRoutes(service)}

test('owner route dispatches exact asset DTOs and adds the transport signal',async()=>{
  let received
  const owner=routes({importAsset:async input=>{received=input;return{revision:1,assetId:'card',version:1,sourceId:'source',diagnostics:[],embeddedWorldbooks:[]}}})
  const result=await owner.request(request({action:'importAsset',format:'json',rawText:'{}',expectedRevision:0}))
  assert.equal(result.status,200);assert.equal((await result.json()).assetId,'card');assert.equal(received.rawText,'{}');assert.ok(received.signal instanceof AbortSignal)
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
