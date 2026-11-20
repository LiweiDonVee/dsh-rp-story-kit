import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createStoryKitHost} from '../../src/host.mjs'
import {createStoryKitStore,storageKey} from '../../src/store.mjs'
import {StoryKitWorkspace} from '../../src/StoryKitWorkspace.jsx'
import {StoryStart} from '../../src/StoryStart.jsx'

const cleanupResources=[]
afterEach(async()=>{cleanup();for(const close of cleanupResources.splice(0))await close()})
const raw=JSON.parse(await readFile('tests/fixtures/harbor-v2.json','utf8'))

async function fixture({available=true}={}){
  const directory=await mkdtemp(join(tmpdir(),'story-kit-start-')),store=createStoryKitStore({directory}),requests=[],bindings=new Map()
  const gm={apiVersion:1,binding:async({sessionId})=>bindings.get(sessionId)??null,startStory:async input=>{requests.push(structuredClone({...input,signal:undefined}));const binding={launchId:input.launchId,sessionId:'fixture-story',status:'active'};bindings.set(binding.sessionId,binding);return{sessionId:binding.sessionId,binding,status:'active'}}}
  const database={apiVersion:2,bindSources(){},initializeStoryState(){},database:async({databaseId,version})=>({database:{id:databaseId,version,entries:[]}})}
  const lastStep={profile:async({profileId,version})=>({profile:{id:profileId,version,status:'ready'}}),bindSession(){},ensureBuiltinProfile(){}}
  const dependencies=available?{rpGM:gm,rpDatabase:database,rpLastStep:lastStep}:{},client=await createStoryKitHost({get:name=>dependencies[name]},{store})
  cleanupResources.push(async()=>{await client.close();await rm(directory,{recursive:true,force:true})})
  const card=structuredClone(raw);card.data.extensions.unmapped_feature={profile:'not-a-real-binding'}
  const saved=await client.importAsset({format:'json',rawText:JSON.stringify(card),expectedRevision:0}),first=(await client.asset({kind:'character',assetId:saved.assetId,version:1})).asset
  await client.saveCharacter({character:{...first,name:'雾港新版',openings:[{id:'first',name:'新版开场',text:'新版文字不应替代旧版'}],databaseRefs:[{key:'world',databaseId:'harbor',version:3}],profileRef:{profileId:'real-linked',version:2}},expectedRevision:1})
  const player=await client.createPersona({persona:{name:'旅人',description:'旧版测绘员'},expectedRevision:2}),persona=(await client.asset({kind:'persona',assetId:player.assetId,version:1})).asset
  await client.savePersona({persona:{...persona,description:'新版守灯人'},expectedRevision:3})
  return{client,store,requests,cardId:saved.assetId,playerId:player.assetId}
}

async function selectVersions(data,{old=true}={}){
  await waitFor(()=>expect(screen.getByLabelText('故事角色').options.length).toBe(2))
  if(old){await waitFor(()=>expect(screen.getByLabelText('故事角色版本').options.length).toBe(2));fireEvent.change(screen.getByLabelText('故事角色版本'),{target:{value:'1'}})}
  if(old){await waitFor(()=>expect(screen.getByLabelText('故事玩家身份版本').options.length).toBe(2));fireEvent.change(screen.getByLabelText('故事玩家身份版本'),{target:{value:'1'}})}
  await waitFor(()=>expect(screen.getByLabelText('故事角色')).toHaveValue(data.cardId))
  await waitFor(()=>expect(screen.getByLabelText('故事玩家身份')).toHaveValue(data.playerId))
  await screen.findByRole('article',{name:'当前开场预览'})
  await waitFor(()=>expect(screen.getByLabelText('初始场景标题')).toHaveValue(old?'雾港档案':'雾港新版'))
  await within(screen.getByRole('region',{name:'选择玩家身份'})).findByText(old?'旧版测绘员':'新版守灯人')
}

async function addOtherAssets(data){
  const revision=(await data.client.state({})).revision
  await data.client.createCharacter({character:{name:'另一个角色',openings:[{id:'first',name:'另一开场',text:'另一份原文'}]},expectedRevision:revision})
  await data.client.createPersona({persona:{name:'另一个身份',description:'另一份描述'},expectedRevision:revision+1})
  return data.client.state({})
}

it('shows the sole saved character, persona and original opening together and starts with one explicit action',async()=>{
  const data=await fixture(),navigate=vi.fn(),before=await data.store.snapshot()
  render(<StoryKitWorkspace client={data.client} navigation={{params:{view:'start'},revision:1}} navigate={navigate}/>)
  const start=await screen.findByRole('button',{name:'以此开场开始'})
  await waitFor(()=>expect(start).toBeEnabled())
  expect(screen.getByLabelText('故事角色')).toHaveValue(data.cardId)
  expect(screen.getByLabelText('故事玩家身份')).toHaveValue(data.playerId)
  expect(screen.getByLabelText('故事角色版本')).toHaveValue('2')
  expect(screen.getByLabelText('故事玩家身份版本')).toHaveValue('2')
  expect(within(screen.getByRole('article',{name:'当前开场预览'})).getByText('新版文字不应替代旧版')).toBeVisible()
  expect(screen.queryByRole('button',{name:/下一步/u})).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(data.requests).toHaveLength(0);expect(await data.store.snapshot()).toEqual(before)
  fireEvent.click(start)
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('fixture-story'))
  expect(data.requests).toHaveLength(1)
  expect(data.requests[0]).toMatchObject({character:{assetId:data.cardId,version:2},persona:{assetId:data.playerId,version:2},opening:{id:'first',text:'新版文字不应替代旧版'},initialScene:{title:'雾港新版',location:'未指定地点'},initialFacts:{items:[]}})
})

it('keeps exact-version selectors and descriptions reachable with the main action before advanced settings',async()=>{
  const data=await fixture()
  render(<StoryKitWorkspace client={data.client} navigation={{params:{view:'start'},revision:1}}/>)
  await selectVersions(data)
  for(const label of ['故事角色','故事角色版本','故事玩家身份','故事玩家身份版本'])expect(screen.getByLabelText(label)).toBeVisible()
  expect(screen.getByLabelText('故事角色').selectedOptions[0]).toHaveTextContent('雾港档案')
  expect(screen.queryByText('雾港档案 · 版本 1')).toBeNull()
  const description=screen.getByText(raw.data.description)
  expect(description.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText('角色描述'));expect(description).toBeVisible()
  const start=screen.getByRole('button',{name:'以此开场开始'}),advanced=screen.getByText('高级启动设置（场景、事实、资料与预设）')
  expect(start.compareDocumentPosition(advanced)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('雾港档案 · 未指定地点')).toBeVisible()
  expect(data.requests).toHaveLength(0)
})

it('does not choose among multiple saved assets and allows both choices without a step transition',async()=>{
  const data=await fixture(),library=await addOtherAssets(data)
  render(<StoryStart library={library} client={data.client}/>)
  expect(screen.getByLabelText('故事角色')).toHaveValue('')
  expect(screen.getByLabelText('故事玩家身份')).toHaveValue('')
  expect(screen.queryByRole('article',{name:'当前开场预览'})).toBeNull()
  fireEvent.change(screen.getByLabelText('故事角色'),{target:{value:data.cardId}})
  await screen.findByRole('article',{name:'当前开场预览'})
  expect(screen.getByLabelText('故事玩家身份')).toBeVisible()
  expect(screen.getByRole('button',{name:'以此开场开始'})).toBeDisabled()
  fireEvent.change(screen.getByLabelText('故事玩家身份'),{target:{value:data.playerId}})
  await waitFor(()=>expect(screen.getByRole('button',{name:'以此开场开始'})).toBeEnabled())
  expect(data.requests).toHaveLength(0)
})

it('honors an explicitly selected old version and opening ahead of multiple library choices',async()=>{
  const data=await fixture(),library=await addOtherAssets(data),initialSelection={characterRef:JSON.stringify([data.cardId,1]),personaRef:JSON.stringify([data.playerId,1]),openingId:'alternate-1'}
  render(<StoryStart library={library} client={data.client} initialSelection={initialSelection}/>)
  await waitFor(()=>expect(screen.getByRole('button',{name:'以此开场开始'})).toBeEnabled())
  expect(screen.getByLabelText('故事角色版本')).toHaveValue('1')
  expect(screen.getByLabelText('故事玩家身份版本')).toHaveValue('1')
  expect(screen.getByLabelText('选择开场')).toHaveValue('alternate-1')
  expect(within(screen.getByRole('article',{name:'当前开场预览'})).getByText(raw.data.alternate_greetings[0])).toBeVisible()
  expect(data.requests).toHaveLength(0)
})

it('shows and launches the saved opening while source diagnostics and the advanced catalog are still pending',async()=>{
  const data=await fixture(),library=await data.client.state({}),source=data.client.source,navigate=vi.fn(),before=await data.store.snapshot()
  let sourceInput,finishSource
  data.client.source=input=>{sourceInput=input;return new Promise(resolve=>{finishSource=()=>source(input).then(resolve)})}
  data.client.databaseCatalog=()=>new Promise(()=>{})
  render(<StoryStart library={library} client={data.client} initialSelection={{characterRef:JSON.stringify([data.cardId,1])}} navigate={navigate}/>)
  await waitFor(()=>expect(screen.getByRole('button',{name:'以此开场开始'})).toBeEnabled())
  expect(sourceInput.signal.aborted).toBe(false)
  expect(within(screen.getByRole('article',{name:'当前开场预览'})).getByText(raw.data.first_mes)).toBeVisible()
  fireEvent.click(screen.getByText('来源与支持情况'))
  expect(screen.getByText('正在读取来源诊断…')).toBeVisible()
  expect(screen.queryByText('原件未记录已知脚本或正则字段')).toBeNull()
  expect(data.requests).toHaveLength(0);expect(await data.store.snapshot()).toEqual(before)
  fireEvent.click(screen.getByRole('button',{name:'以此开场开始'}))
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('fixture-story'))
  expect(data.requests[0].opening.text).toBe(raw.data.first_mes)
  await act(async()=>{await finishSource()})
  expect(screen.getByText('原件含脚本或正则，仅保留，未执行')).toBeVisible()
})

it('keeps a source-read failure visible in diagnostics without blocking the saved opening',async()=>{
  const data=await fixture(),library=await data.client.state({})
  data.client.source=async()=>{throw new Error('原件暂不可读')}
  render(<StoryStart library={library} client={data.client}/>)
  await waitFor(()=>expect(screen.getByRole('button',{name:'以此开场开始'})).toBeEnabled())
  fireEvent.click(await screen.findByText('来源与支持情况 · 读取失败'))
  expect(screen.getByRole('alert')).toHaveTextContent('原件读取失败：原件暂不可读')
  expect(screen.getByRole('article',{name:'当前开场预览'})).toBeVisible()
  expect(data.requests).toHaveLength(0)
})

it('does not invent a persona when none is saved',async()=>{
  const data=await fixture(),library={...await data.client.state({}),personas:[]},create=vi.spyOn(data.client,'createPersona')
  render(<StoryStart library={library} client={data.client}/>)
  await screen.findByRole('article',{name:'当前开场预览'})
  expect(screen.getByText('先在资产库创建并保存一份玩家身份。')).toBeVisible()
  expect(screen.getByRole('button',{name:'以此开场开始'})).toBeDisabled()
  expect(create).not.toHaveBeenCalled();expect(data.requests).toHaveLength(0)
})

it('locks the submitted selections while launching and Cancel aborts the view request without losing its retry ID',async()=>{
  const data=await fixture(),launch=data.client.launch
  let submitted
  data.client.launch=input=>{submitted=input;return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))}
  render(<StoryKitWorkspace client={data.client} navigation={{params:{view:'start'},revision:1}}/>)
  await selectVersions(data)
  fireEvent.click(screen.getByRole('button',{name:'以此开场开始'}))
  await waitFor(()=>expect(submitted).toBeDefined())
  expect(screen.getByLabelText('故事角色')).toBeDisabled()
  expect(screen.getByLabelText('故事玩家身份')).toBeDisabled()
  expect(screen.getByLabelText('选择开场')).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'取消'}))
  await waitFor(()=>expect(submitted.signal.aborted).toBe(true))
  expect(data.requests).toHaveLength(0)
  fireEvent.click(screen.getByRole('button',{name:'开始新故事'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'以此开场开始'})).toBeEnabled())
  expect(screen.getByLabelText('故事角色')).toBeEnabled()
  data.client.launch=launch
  fireEvent.click(screen.getByRole('button',{name:'以此开场开始'}))
  await waitFor(()=>expect(data.requests).toHaveLength(1))
  expect(data.requests[0].launchId).toBe(submitted.launchId)
})

it('uses exact saved versions and selected opening through the real launch owner only after explicit Start',async()=>{
  const data=await fixture(),navigate=vi.fn(),before=await data.store.snapshot()
  render(<StoryKitWorkspace client={data.client} navigation={{params:{view:'start'},revision:1}} navigate={navigate}/>)
  await selectVersions(data)
  const preview=screen.getByRole('article',{name:'当前开场预览'})
  expect(within(preview).getByText(raw.data.first_mes)).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'上一个开场'})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'下一个开场'}))
  expect(within(preview).getByText(raw.data.alternate_greetings[0])).toBeInTheDocument()
  expect(screen.getByLabelText('选择开场')).toHaveValue('alternate-1')
  fireEvent.click(screen.getByRole('button',{name:'上一个开场'}));fireEvent.change(screen.getByLabelText('选择开场'),{target:{value:'alternate-1'}})
  expect(screen.getByRole('button',{name:'以此开场开始'})).toBeEnabled()
  expect(screen.queryByRole('checkbox',{name:'已审阅初始场景与事实'})).toBeNull()
  expect(data.requests).toHaveLength(0)
  expect(await data.store.snapshot()).toEqual(before)
  fireEvent.click(screen.getByText('高级启动设置（场景、事实、资料与预设）'))
  fireEvent.change(screen.getByLabelText('初始场景标题'),{target:{value:'旧港初见'}})
  fireEvent.change(screen.getByLabelText('初始位置'),{target:{value:'码头'}})
  fireEvent.click(screen.getByRole('button',{name:'以此开场开始'}))
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('fixture-story'))
  expect(data.requests).toHaveLength(1)
  expect(data.requests[0]).toMatchObject({character:{assetId:data.cardId,version:1,name:'雾港档案'},persona:{assetId:data.playerId,version:1,description:'旧版测绘员'},opening:{id:'alternate-1',text:raw.data.alternate_greetings[0]},initialScene:{schemaVersion:1,title:'旧港初见',location:'码头',presentActorIds:[]},initialFacts:{schemaVersion:1,items:[]},sources:[]})
  expect(data.requests[0]).not.toHaveProperty('profile')
})

it('shows provenance support and the actual profile association without treating unknown extension data as a preset',async()=>{
  const data=await fixture(),library=await data.client.state({}),before=await data.store.rawState()
  render(<StoryStart library={library} client={data.client}/>)
  await screen.findByRole('article',{name:'当前开场预览'})
  fireEvent.click(screen.getByText('来源与支持情况'))
  expect(await screen.findByText('real-linked · 版本 2')).toBeVisible()
  expect(screen.getByText(/含作者系统\/后置指令/u)).toBeVisible()
  expect(screen.getByText('原件含脚本或正则，仅保留，未执行')).toBeVisible()
  expect(screen.getByText('原文宏按字面保留，未自动展开')).toBeVisible()
  expect(screen.getByText('保留在原件中，尚未关联导入的资料库')).toBeVisible()
  expect(screen.getByText(/尚未适配：data.extensions.unmapped_feature/u)).toBeVisible()
  expect(await data.store.rawState()).toEqual(before)
})

it('starts with visible nonempty scene defaults without requiring advanced fields to be opened',async()=>{
  const data=await fixture(),navigate=vi.fn()
  render(<StoryKitWorkspace client={data.client} navigation={{params:{view:'start'},revision:1}} navigate={navigate}/>)
  await selectVersions(data)
  expect(screen.getByLabelText('初始场景标题')).toHaveValue('雾港档案')
  expect(screen.getByLabelText('初始位置')).toHaveValue('未指定地点')
  expect(screen.getByLabelText('初始位置').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('雾港档案 · 未指定地点')).toBeVisible()
  expect(screen.getByText('“未指定地点”表示尚未指定具体地点，可在高级启动设置中修改。')).toBeVisible()
  expect(data.requests).toHaveLength(0)
  fireEvent.click(screen.getByRole('button',{name:'以此开场开始'}))
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('fixture-story'))
  expect(data.requests[0].initialScene).toEqual({schemaVersion:1,title:'雾港档案',location:'未指定地点',presentActorIds:[]})
})

it('keeps the form and identical retry request across hiding, then captures a new launch when an input changes',async()=>{
  const data=await fixture(),requests=[],original=data.client.launch
  data.client.launch=async input=>{requests.push(structuredClone({...input,signal:undefined}));if(requests.length<3)throw new Error('模拟断线');return original(input)}
  const navigation={params:{view:'start'},revision:1},view=render(<StoryKitWorkspace client={data.client} navigation={navigation}/>)
  await selectVersions(data,{old:false})
  fireEvent.change(screen.getByLabelText('初始场景标题'),{target:{value:'保留起点'}})
  fireEvent.change(screen.getByLabelText('初始位置'),{target:{value:'码头'}})
  fireEvent.change(screen.getByLabelText('启动预设'),{target:{value:'explicit'}})
  fireEvent.change(screen.getByLabelText('预设 ID'),{target:{value:'chosen-profile'}})
  fireEvent.change(screen.getByLabelText('预设版本'),{target:{value:'4'}})
  fireEvent.click(screen.getByRole('button',{name:'以此开场开始'}))
  await screen.findByRole('alert');expect(requests).toHaveLength(1)
  view.rerender(<StoryKitWorkspace client={data.client} navigation={navigation} visible={false}/>)
  view.rerender(<StoryKitWorkspace client={data.client} navigation={navigation}/>)
  expect(screen.getByLabelText('初始场景标题')).toHaveValue('保留起点')
  expect(requests).toHaveLength(1)
  fireEvent.click(screen.getByRole('button',{name:'以此开场开始'}));await waitFor(()=>expect(requests).toHaveLength(2))
  expect(requests[1]).toEqual(requests[0])
  expect(requests[1]).toMatchObject({profile:{profileId:'chosen-profile',version:4},sources:[{key:'world',databaseId:'harbor',version:3}]})
  await waitFor(()=>expect(screen.getByRole('button',{name:'以此开场开始'})).toBeEnabled())
  fireEvent.change(screen.getByLabelText('初始位置'),{target:{value:'旧阶梯'}})
  expect(screen.getByRole('button',{name:'以此开场开始'})).toBeEnabled()
  fireEvent.click(screen.getByRole('button',{name:'以此开场开始'}))
  await waitFor(()=>expect(requests).toHaveLength(3))
  expect(requests[2].launchId).not.toBe(requests[0].launchId)
})

it('mounts the start scene lazily and honors repeated host navigation revisions without losing an asset draft',async()=>{
  const data=await fixture(),asset=vi.spyOn(data.client,'asset'),navigation={params:{view:'library'},revision:1}
  const view=render(<StoryKitWorkspace client={data.client} navigation={navigation}/>)
  await screen.findByRole('button',{name:/雾港新版.*版本 2/u})
  expect(screen.queryByLabelText('故事角色')).toBeNull();expect(asset).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:/雾港新版.*版本 2/u}));await screen.findByDisplayValue('雾港新版')
  fireEvent.change(screen.getByLabelText('描述'),{target:{value:'未保存草稿'}})
  view.rerender(<StoryKitWorkspace client={data.client} navigation={{params:{view:'start'},revision:2}}/>)
  expect(screen.getByRole('region',{name:'开始新故事'})).toBeVisible()
  fireEvent.click(screen.getByRole('button',{name:'资产库'}));expect(screen.getByLabelText('描述')).toHaveValue('未保存草稿')
  view.rerender(<StoryKitWorkspace client={data.client} navigation={{params:{view:'start'},revision:3}}/>)
  expect(screen.getByRole('region',{name:'开始新故事'})).toBeVisible()
  expect(data.requests).toHaveLength(0)
})

it('keeps unavailable launch disabled with saved selections and preview on the same page',async()=>{
  const data=await fixture({available:false})
  render(<StoryKitWorkspace client={data.client} navigation={{params:{view:'start'},revision:1}}/>)
  await selectVersions(data)
  expect(screen.getByRole('button',{name:'以此开场开始'})).toBeDisabled()
  expect(data.requests).toHaveLength(0)
})

it('aborts late selected-version reads when hidden and never replaces the current selection with an older response',async()=>{
  const data=await fixture(),library=await data.client.state({}),asset=data.client.asset,reads=[]
  const view=render(<StoryStart library={library} client={data.client}/>)
  await screen.findByRole('article',{name:'当前开场预览'})
  data.client.asset=input=>new Promise((resolve,reject)=>reads.push({input,finish:()=>asset(input).then(resolve,reject)}))
  fireEvent.change(screen.getByLabelText('故事角色版本'),{target:{value:'1'}})
  await waitFor(()=>expect(reads).toHaveLength(1));fireEvent.change(screen.getByLabelText('故事角色版本'),{target:{value:'2'}})
  await waitFor(()=>expect(reads).toHaveLength(2));expect(reads[0].input.signal.aborted).toBe(true)
  const chosen=within(screen.getByRole('region',{name:'选择角色'}))
  await act(async()=>{await reads[1].finish()});await waitFor(()=>expect(chosen.getByLabelText('故事角色').selectedOptions[0]).toHaveTextContent('雾港新版'))
  await act(async()=>{await reads[0].finish()});expect(chosen.getByLabelText('故事角色').selectedOptions[0]).toHaveTextContent('雾港新版');expect(chosen.getByLabelText('故事角色版本')).toHaveValue('2')
  view.rerender(<StoryStart library={library} client={data.client} visible={false}/>)
  expect(reads[1].input.signal.aborted).toBe(true);expect(data.requests).toHaveLength(0)
})

it('offers only versions present after exact-ID story restore instead of inventing earlier version numbers',async()=>{
  const data=await fixture()
  await data.store.updateInternal(state=>{for(const[kind,id]of [['characters',data.cardId],['personas',data.playerId]])state[kind][storageKey(id)]=state[kind][storageKey(id)].filter(item=>item.version===2);return{}})
  const library=await data.client.state({})
  render(<StoryStart library={library} client={data.client}/>)
  await screen.findByRole('article',{name:'当前开场预览'})
  expect([...screen.getByLabelText('故事角色版本').options].map(item=>item.value)).toEqual(['2'])
  await waitFor(()=>expect(screen.getByLabelText('故事玩家身份')).toHaveValue(data.playerId))
  expect([...screen.getByLabelText('故事玩家身份版本').options].map(item=>item.value)).toEqual(['2'])
})
