import test from 'node:test'
import assert from 'node:assert/strict'
import {assertSingleAction,assertEmptyInbox} from './full-scenarios.mjs'

const turn=(offset,action,id)=>[{seq:offset,type:'tool/call',data:{name:'rp_commit_turn',callId:id}},{seq:offset+1,type:'tool/result',data:{message:{toolCallId:id,isError:false,content:[{type:'text',text:JSON.stringify({id,kind:'turn',source:{callSeq:offset},packet:{playerAction:action}})}]}}}]
const before={events:[]},state=events=>({events}),trace=action=>({executions:[{name:'rp_commit_turn',isError:false,value:{id:'receipt',packet:{playerAction:action}}},{name:'rp_present',isError:false,value:{factReceiptId:'receipt'}}]})
test('continuation proof requires one canonical receipt for exactly this explicit action',()=>{
  assertSingleAction(before,state(turn(0,'本次行动','receipt')),trace('本次行动'),'本次行动')
  assert.throws(()=>assertSingleAction(before,state(turn(0,'排除的旧行动','receipt')),trace('排除的旧行动'),'本次行动'))
})
test('continuation proof rejects inherited-old plus current commits even when the host reaches idle',()=>{
  assert.throws(()=>assertSingleAction(before,state([...turn(0,'旧行动','old'),...turn(2,'本次行动','receipt')]),trace('本次行动'),'本次行动'))
})
test('an imported-prefix rollback must expose an empty authoritative inbox before it can be called playable',()=>{
  assertEmptyInbox({inbox:{'next-turn':[],'next-step':[]}})
  assert.throws(()=>assertEmptyInbox({inbox:{'next-turn':[{id:'old',content:[]}],'next-step':[]}}))
  assert.throws(()=>assertEmptyInbox({}))
})
