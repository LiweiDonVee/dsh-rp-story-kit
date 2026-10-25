import test from 'node:test'
import assert from 'node:assert/strict'

const api=await import('../src/reading.mjs').catch(()=>({}))
function exporter(dependencies){assert.equal(typeof api.createReadingExporter,'function');return api.createReadingExporter(dependencies)}
test('reading uses only active accepted narrative bodies and owner-selected format',async()=>{
  let request
  const service=exporter({getLastStep:()=>({narratives:async input=>{request=input;return{records:[{id:'current',text:'当前采用的正文。',action:'玩家行动'}],drafts:[{text:'未采用候选'}],audit:[{text:'旧分支'}]}}}),getGM:()=>({binding:async()=>({title:'公开合成故事'})})})
  const signal=new AbortController().signal,markdown=await service.exportReading({sessionId:'story/unsafe',format:'markdown',signal}),text=await service.exportReading({sessionId:'story/unsafe',format:'text',signal})
  assert.equal(markdown.text,'# 公开合成故事\n\n当前采用的正文。\n');assert.equal(text.text,'当前采用的正文。\n');assert.equal(markdown.fileName,'story_unsafe.md');assert.equal(text.fileName,'story_unsafe.txt');assert.equal(request.signal,signal)
})
test('reading keeps missing capability and owner authorization failures explicit without leaking provider bodies',async()=>{
  const absent=exporter({getLastStep:()=>undefined,getGM:()=>undefined});assert.equal(absent.available(),false);await assert.rejects(absent.exportReading({sessionId:'story',format:'text'}),{code:'CAPABILITY_UNAVAILABLE'})
  const denied=exporter({getLastStep:()=>({narratives:async()=>{throw Object.assign(new Error('PRIVATE PROVIDER BODY'),{status:403,code:'FORBIDDEN'})}}),getGM:()=>undefined})
  await assert.rejects(denied.exportReading({sessionId:'story',format:'text'}),error=>error.code==='FORBIDDEN'&&!error.message.includes('PRIVATE'))
})

test('optional GM title failure does not break an authorized LastStep reading export',async()=>{
  const service=exporter({getLastStep:()=>({narratives:async()=>({records:[{text:'已授权的正式正文。'}]})}),getGM:()=>({binding:async()=>{throw Object.assign(new Error('metadata unavailable'),{status:503})}})})
  assert.equal((await service.exportReading({sessionId:'legacy',format:'text'})).text,'已授权的正式正文。\n')
})
