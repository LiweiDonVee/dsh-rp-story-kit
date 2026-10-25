import {randomUUID} from 'node:crypto'
const textOf=message=>typeof message?.content==='string'?message.content:(message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n')
async function* text(value){yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:value};yield{type:'block-end',index:0,block:{type:'text',text:value}};yield{type:'finish',reason:{kind:'stop'}}}
async function* tool(name,args){const id=randomUUID(),value=JSON.stringify(args);yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name,argumentsDelta:value};yield{type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:value}};yield{type:'finish',reason:{kind:'tool-calls'}}}
function results(messages){const names=new Map();for(const message of messages)for(const block of Array.isArray(message.content)?message.content:[])if(block.type==='tool-call')names.set(block.id,block.name);return messages.filter(message=>message.role==='tool').map(message=>{let value;try{value=JSON.parse(textOf(message))}catch{value=null}return{name:names.get(message.toolCallId),value,isError:message.isError}})}
export function createFullModels(){
  const counts={main:0,prepare:0,summary:0,assemble:0,writer:0},requests=[];let writerFault=false,illegalRetry=false
  return{
    stats:()=>structuredClone({counts,requests}),failWriterOnce(){writerFault=true},illegalRetryOnce(){illegalRetry=true},
    async*stream(model,options){
      const system=options.system??options.messages.filter(message=>message.role==='system').map(textOf).join('\n'),stage=system.includes('RP_CONTEXT_PREPARE')?'prepare':system.includes('RP_CONTEXT_SUMMARIZE')?'summary':system.includes('RP_LAST_STEP_ASSEMBLE')?'assemble':system.includes('RP_LAST_STEP_RENDER')?'writer':'main'
      if(++counts[stage]>160)throw Error('LOCAL_MODEL_REQUEST_LIMIT')
      requests.push({stage,model,system,messages:structuredClone(options.messages),tools:options.tools?.map(item=>item.name)??[]})
      if(stage==='prepare'||stage==='assemble'){yield*text('{"commit":true}');return}
      const messages=options.messages??[]
      if(stage==='summary'){const input=JSON.parse(textOf(messages.at(-1)));yield*text(JSON.stringify({summaries:input.history.map(item=>({id:item.id,summary:`公开已发生摘要：${item.text.slice(0,120)}`}))}));return}
      if(stage==='writer'){
        if(writerFault){writerFault=false;throw Error('LOCAL_WRITER_FAILURE')}
        const input=JSON.parse(textOf(messages.at(-1))),packet=input.packet,body=packet.playerAction==='开始故事'?packet.visibleConsequences.join('\n'):`${packet.playerAction}：${(packet.visibleConsequences??packet.resolvedChanges??['公开状态保持。']).join('；')}`;yield*text(body);return
      }
      const at=messages.findLastIndex(message=>message.role==='user'&&['user','user-rpc'].includes(message.source?.kind)),action=textOf(messages[at]),tail=results(messages.slice(at+1)),last=name=>tail.findLast(item=>item.name===name)
      if(at<0)throw Error('LOCAL_MAIN_USER_SOURCE_REQUIRED')
      if(last('rp_present')?.isError){yield*text('正文失败已保留；等待明确重试。');return}
      const rewrite=/["']?rewriteOf["']?\s*[:=]\s*["']([^"']+)["']/u.exec(action)
      if(rewrite){if(illegalRetry){illegalRetry=false;yield*tool('rp_commit_turn',{expectedRevision:0,summary:'非法 retry 范围探针',packet:{playerAction:action}});return}yield*tool('rp_present',{rewriteOf:rewrite[1]});return}
      if(action.includes('rp_begin_story')){const begun=last('rp_begin_story');if(!begun){yield*tool('rp_begin_story',{});return}if(!begun.value?.id)throw Error(`OPENING_FAILED:${JSON.stringify(begun)}`);yield*tool('rp_present',{factReceiptId:begun.value.id});return}
      const state=last('rp_gm_state'),commits=tail.filter(item=>item.name==='rp_commit_turn'),committed=commits.find(item=>item.value?.id)
      if(!state){yield*tool('rp_gm_state',{});return}
      if(action.includes('事实重复负例')&&commits.length===1){yield*tool('rp_commit_turn',{expectedRevision:state.value.revision,summary:'不同的同回合重复事实',packet:{playerAction:action}});return}
      if(committed){yield*tool('rp_present',{factReceiptId:committed.value.id});return}
      if(!state.value?.facts)throw Error(`GM_STATE_FAILED:${JSON.stringify(state)}`)
      const facts={schemaVersion:1,items:state.value.facts.items.map((item,index)=>index===0?{...item,text:action}:item)}
      yield*tool('rp_commit_turn',{expectedRevision:state.value.revision,facts,summary:action,packet:{playerAction:action,resolvedChanges:[action],visibleConsequences:[`公开行动已完成：${action}`]}})
    },
  }
}
