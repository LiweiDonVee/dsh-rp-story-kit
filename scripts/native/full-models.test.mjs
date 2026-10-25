import test from 'node:test'
import assert from 'node:assert/strict'
import {createFullModels} from './full-models.mjs'
const text=value=>[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]
async function blocks(stream){const rows=[];for await(const chunk of stream)if(chunk.type==='block-end')rows.push(chunk.block);return rows}
test('local native models distinguish preparation, assembly, writer and main without replacing business owners',async()=>{
  const local=createFullModels(),input={messages:[{role:'user',content:text({packet:{playerAction:'开始故事',visibleConsequences:['选定开场']}})}]}
  assert.equal((await blocks(local.stream('main',{...input,system:'RP_CONTEXT_PREPARE'})))[0].text,'{"commit":true}')
  assert.equal((await blocks(local.stream('main',{...input,system:'RP_LAST_STEP_ASSEMBLE'})))[0].text,'{"commit":true}')
  assert.equal((await blocks(local.stream('writer',{...input,system:'RP_LAST_STEP_RENDER'})))[0].text,'选定开场')
  assert.deepEqual(local.stats().counts,{main:0,prepare:1,summary:0,assemble:1,writer:1})
})
test('the deterministic main model starts a real opening and uses the returned receipt for presentation',async()=>{
  const local=createFullModels(),human={role:'user',source:{kind:'user-rpc'},content:text('先调用 rp_begin_story')}
  assert.equal((await blocks(local.stream('main',{messages:[human]})))[0].name,'rp_begin_story')
  const messages=[human,{role:'assistant',content:[{type:'tool-call',id:'wire',name:'rp_begin_story'}]},{role:'tool',toolCallId:'wire',content:text({id:'actual-receipt'})}]
  assert.deepEqual(JSON.parse((await blocks(local.stream('main',{messages})))[0].arguments),{factReceiptId:'actual-receipt'})
})
test('a requested writer fault is counted once and preserves subsequent successful route identity',async()=>{
  const local=createFullModels(),input={system:'RP_LAST_STEP_RENDER',messages:[{role:'user',content:text({packet:{playerAction:'显式行动',visibleConsequences:['公开变化']}})}]};local.failWriterOnce()
  await assert.rejects(blocks(local.stream('writer',input)),/LOCAL_WRITER_FAILURE/u)
  assert.match((await blocks(local.stream('writer-alt',input)))[0].text,/公开变化/u);assert.equal(local.stats().requests.at(-1).model,'writer-alt');assert.equal(local.stats().counts.writer,2)
})
