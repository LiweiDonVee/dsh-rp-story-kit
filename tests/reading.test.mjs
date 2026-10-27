import test from 'node:test'
import assert from 'node:assert/strict'

const api=await import('../src/reading.mjs').catch(()=>({}))
function exporter(dependencies){assert.equal(typeof api.createReadingExporter,'function');return api.createReadingExporter(dependencies)}
const narrative=(presentationId,text,extra={})=>{const resultSeq=presentationId==='current'?18:8;return{id:JSON.stringify([presentationId,resultSeq]),ref:{sessionId:'story',presentationId,assistantMessageId:'assistant-'+presentationId,callSeq:resultSeq-2,baseResultSeq:resultSeq,resultSeq},turn:1,action:'玩家行动',text,...extra}}
const history=records=>({schemaVersion:1,records,folded:[{groupId:'round',factRoundId:'round',activeFactReceiptId:'fact-current',selectedPresentationId:records.at(-1)?.ref.presentationId??null,pendingFacts:false,versions:[{presentationId:'original',factReceiptId:'fact-old',resultSeq:8},{presentationId:'current',factReceiptId:'fact-current',resultSeq:18}]}],projectionKey:'owner-projection'})

test('reading exports only the public effective selection when canonical history retains both accepted versions',async()=>{
  const old=narrative('original','旧事实版本正文。',{factReceiptId:'fact-old',narrativeVersion:{schemaVersion:1,groupId:'round',kind:'original',factRoundId:'round',factRevision:1}}),current=narrative('current','当前事实版本正文。',{factReceiptId:'fact-current',narrativeVersion:{schemaVersion:1,groupId:'round',kind:'original',factRoundId:'round',factRevision:2}}),signal=new AbortController().signal
  let received
  const service=exporter({getLastStep:()=>({narratives:async()=>({records:[old,current]}),storyHistory:async input=>{received=input;return history([current])}}),getGM:()=>undefined})
  assert.equal((await service.exportReading({sessionId:'story',format:'text',signal})).text,'当前事实版本正文。\n')
  assert.deepEqual(received,{sessionId:'story',signal})
})

test('reading availability uses an actual effective reader without requiring the audit reader',async()=>{
  const service=exporter({getLastStep:()=>({storyHistory:async()=>history([narrative('current','当前正文。')])}),getGM:()=>undefined})
  assert.equal(service.available(),true)
  assert.equal((await service.exportReading({sessionId:'story',format:'text'})).text,'当前正文。\n')
})

test('a current fact revision without accepted prose exports no superseded canonical body',async()=>{
  const service=exporter({getLastStep:()=>({narratives:async()=>({records:[narrative('original','旧版已接受正文。')]}),storyHistory:async()=>history([])}),getGM:()=>undefined})
  assert.equal((await service.exportReading({sessionId:'story',format:'text'})).text,'\n')
})

test('an unavailable effective reader fails explicitly and never falls back to old accepted prose',async()=>{
  const service=exporter({getLastStep:()=>({narratives:async()=>({records:[narrative('original','旧版正文。')]}),storyHistory:async()=>{throw Object.assign(new Error('PRIVATE projection detail'),{code:'EFFECTIVE_HISTORY_UNAVAILABLE',status:409})}}),getGM:()=>undefined})
  await assert.rejects(service.exportReading({sessionId:'story',format:'text'}),error=>error.code==='EFFECTIVE_HISTORY_UNAVAILABLE'&&error.status===409&&!error.message.includes('PRIVATE'))
})

test('known version metadata requires the effective reader instead of exporting canonical audit versions',async()=>{
  const record=narrative('original','旧版正文。',{narrativeVersion:{schemaVersion:1,groupId:'original',kind:'writer-regeneration',basePresentationId:'older'}})
  const service=exporter({getLastStep:()=>({narratives:async()=>({records:[record]})}),getGM:()=>undefined})
  await assert.rejects(service.exportReading({sessionId:'story',format:'text'}),{code:'EFFECTIVE_HISTORY_UNAVAILABLE'})
})

test('public captured fact groups require the effective reader even before a versioned body exists',async()=>{
  for(const group of [
    {roundId:'round',source:{turnStartSeq:2,assistantMessageId:'main',callId:'fact-call',callSeq:3},activeReceiptId:'fact-current',factRevision:2,pendingCandidateId:null},
    {roundId:'round',source:{turnStartSeq:2,assistantMessageId:'main',callId:'fact-call',callSeq:3},activeReceiptId:null,factRevision:null,pendingCandidateId:'candidate'},
  ]){
    const service=exporter({getLastStep:()=>({narratives:async()=>({records:[narrative('original','历史正文。')]})}),getDatabase:()=>({factReviewProjection:async()=>({schemaVersion:1,latestRoundId:'round',groups:[group]})}),getGM:()=>undefined})
    await assert.rejects(service.exportReading({sessionId:'story',format:'text'}),{code:'EFFECTIVE_HISTORY_UNAVAILABLE'})
  }
})

test('new owner capability flags and an empty real fact projection preserve legacy reading',async()=>{
  const service=exporter({getLastStep:()=>({capabilities:{narrativeRevisions:1},narratives:async()=>({records:[narrative('legacy','旧故事正文。')]})}),getDatabase:()=>({capabilities:{factReview:1},factReviewProjection:async()=>({schemaVersion:1,latestRoundId:null,groups:[]})}),getGM:()=>undefined})
  assert.equal((await service.exportReading({sessionId:'story',format:'text'})).text,'旧故事正文。\n')
})

test('public fact projection errors are not converted to legacy reading',async()=>{
  const service=exporter({getLastStep:()=>({narratives:async()=>({records:[narrative('legacy','旧故事正文。')]})}),getDatabase:()=>({factReviewProjection:async()=>{throw Object.assign(new Error('PRIVATE projection authorization'),{status:403})}}),getGM:()=>undefined})
  await assert.rejects(service.exportReading({sessionId:'story',format:'text'}),error=>error.code==='FORBIDDEN'&&!error.message.includes('PRIVATE'))
})
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
