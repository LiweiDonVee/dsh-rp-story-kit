import React from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor,act} from '@testing-library/react'

const ui=await import('../../src/StoryActions.jsx').catch(()=>({}))
afterEach(cleanup)
const character={id:'card',version:2,name:'设定',description:'设定内容',openings:[{id:'alternate-1',name:'选定开场',text:'原定开场'}],examples:'示例不是事实',databaseRefs:[],profileRef:{profileId:'linked',version:3}}
const capabilities={launch:true,readingExport:true,savedStoryExport:true,savedStoryPreview:true,savedStoryRestore:true}
const saved={format:'dsh-rp-saved-story',schemaVersion:1,identityMode:'preserve',exportedAt:'2026-10-25T00:00:00.000Z',selectedSessionId:'original',sessions:[{header:{id:'original',agentPreset:'rp-gm'},events:[],inheritedEventCount:0}],pluginState:{database:{schemaVersion:1,revision:0,payload:{}},lastStep:{schemaVersion:1,revision:0,payload:{}},gm:{schemaVersion:1,revision:0,payload:{}},storyKit:{schemaVersion:1,revision:0,payload:{}},context:null},resources:[],requirements:[]}
function requireComponent(name){expect(ui[name]).toBeTypeOf('function');return ui[name]}

it('launch UI requires reviewed seed, sends pinned selections and supports explicit builtin profile without example-derived facts',async()=>{
  const Launch=requireComponent('StoryLaunch'),requests=[],navigate=vi.fn(),client={launch:async input=>{requests.push(input);return{sessionId:'native-created',status:'starting',binding:{}}}}
  render(<Launch character={character} personaRef={JSON.stringify(['player',1])} openingId="alternate-1" client={client} capabilities={capabilities} visible navigate={navigate}/>)
  expect(screen.getByRole('button',{name:'开始故事'})).toBeDisabled()
  fireEvent.change(screen.getByLabelText('初始场景标题'),{target:{value:'港口'}});fireEvent.change(screen.getByLabelText('初始位置'),{target:{value:'码头'}});fireEvent.click(screen.getByRole('button',{name:'添加初始事实'}));fireEvent.change(screen.getByLabelText('初始事实 1'),{target:{value:'已经退潮'}});fireEvent.change(screen.getByLabelText('启动预设'),{target:{value:'builtin'}});fireEvent.click(screen.getByLabelText('已审阅初始场景与事实'));fireEvent.click(screen.getByRole('button',{name:'开始故事'}))
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('native-created'))
  expect(requests[0].character).toEqual({assetId:'card',version:2});expect(requests[0].persona).toEqual({assetId:'player',version:1});expect(requests[0].openingId).toBe('alternate-1');expect(requests[0].profile).toBeNull();expect(requests[0].initialScene).toEqual({schemaVersion:1,title:'港口',location:'码头',presentActorIds:[]});expect(requests[0].initialFacts.items.map(item=>item.text)).toEqual(['已经退潮']);expect(requests[0].initialFacts.items[0].id).toBeTypeOf('string')
})

it('pending launch UI resumes only the persisted launchId and does not resubmit a new review setup',async()=>{
  const Pending=requireComponent('PendingLaunches'),requests=[],navigate=vi.fn(),client={resumeLaunch:async input=>{requests.push(input);return{sessionId:'existing',binding:{},status:'starting'}}}
  render(<Pending launches={[{launchId:'original-launch',title:'待继续故事',status:'failed',errorCode:'START_INTERRUPTED',createdAt:'2026-10-25'}]} client={client} visible navigate={navigate} capabilities={capabilities}/>)
  fireEvent.click(screen.getByRole('button',{name:'继续启动：待继续故事'}));await waitFor(()=>expect(navigate).toHaveBeenCalledWith('existing'));expect(Object.keys(requests[0]).sort()).toEqual(['launchId','signal']);expect(requests[0].launchId).toBe('original-launch')
})

it('saved-story UI distinguishes deferred graph checks and continues a pending restore using the same explicit restoreId',async()=>{
  const Transfer=requireComponent('StoryTransfer'),requests=[],navigate=vi.fn(),client={previewSavedStory:async()=>({supported:true,conflicts:[],requirements:[],identityMode:'preserve',deferredChecks:[{code:'LOOP_NODE_VALIDATION',sessionId:'original',nodeIds:['rp-last-step.render']}]}),restoreSavedStory:async input=>{requests.push(input);return{status:requests.length===1?'pending':'complete',sessionId:'original',diagnostics:requests.length===1?[{code:'RESTORE_REQUIREMENT_MISSING'}]:[]}}}
  render(<Transfer client={client} visible capabilities={capabilities} sessionId="current" navigate={navigate}/>)
  fireEvent.change(screen.getByLabelText('故事存档 JSON'),{target:{value:JSON.stringify(saved)}});fireEvent.change(screen.getByLabelText('恢复任务 ID'),{target:{value:'known-job'}});fireEvent.click(screen.getByRole('button',{name:'预检故事存档'}));await screen.findByText(/实际执行图.*恢复暂存后/u)
  fireEvent.click(screen.getByRole('button',{name:'按原 ID 恢复 / 继续'}));await screen.findByText(/恢复尚未激活/u);expect(navigate).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'按原 ID 恢复 / 继续'}));await waitFor(()=>expect(navigate).toHaveBeenCalledWith('original'));expect(requests.map(item=>item.restoreId)).toEqual(['known-job','known-job']);expect(requests[1].snapshot).toEqual(saved)
})

it('reading export UI displays only the owner result and unavailable mechanisms stay disabled',async()=>{
  const Transfer=requireComponent('StoryTransfer'),client={exportReading:async()=>({fileName:'story.txt',mimeType:'text/plain',text:'当前采用正文。'})}
  render(<Transfer client={client} visible capabilities={{...capabilities,savedStoryExport:false,savedStoryPreview:false,savedStoryRestore:false}} sessionId="story"/>)
  fireEvent.click(screen.getByRole('button',{name:'导出阅读稿'}));expect(await screen.findByLabelText('导出的阅读稿')).toHaveValue('当前采用正文。');expect(screen.getByRole('button',{name:'导出完整故事存档'})).toBeDisabled();expect(screen.getByRole('button',{name:'预检故事存档'})).toBeDisabled()
})

it('hiding a transfer operation aborts its lifetime and reopening preserves a usable restore form',async()=>{
  const Transfer=requireComponent('StoryTransfer');let signal
  const client={previewSavedStory:async()=>({supported:true,conflicts:[],requirements:[],identityMode:'preserve',deferredChecks:[]}),restoreSavedStory:input=>{signal=input.signal;return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))}},view=render(<Transfer client={client} visible capabilities={capabilities} sessionId="current"/>)
  fireEvent.change(screen.getByLabelText('故事存档 JSON'),{target:{value:JSON.stringify(saved)}});fireEvent.change(screen.getByLabelText('恢复任务 ID'),{target:{value:'keep-this-job'}});fireEvent.click(screen.getByRole('button',{name:'预检故事存档'}));await waitFor(()=>expect(screen.getByRole('button',{name:'按原 ID 恢复 / 继续'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'按原 ID 恢复 / 继续'}));await waitFor(()=>expect(signal).toBeDefined())
  await act(async()=>{view.rerender(<Transfer client={client} visible={false} capabilities={capabilities} sessionId="current"/>);await Promise.resolve()});expect(signal.aborted).toBe(true)
  await act(async()=>{view.rerender(<Transfer client={client} visible capabilities={capabilities} sessionId="current"/>)});expect(screen.getByLabelText('恢复任务 ID')).toHaveValue('keep-this-job');expect(screen.getByRole('button',{name:'按原 ID 恢复 / 继续'})).toBeEnabled()
})

it('saved export shows recorded current-binding and retained-default roles using fixed informational labels',async()=>{
  const Transfer=requireComponent('StoryTransfer'),dependencySummary={databases:[{databaseId:'World',version:1,uses:['asset-default']}],profiles:[{profileId:'Style',version:2,uses:['current-binding','asset-default']}]},client={exportSavedStory:async()=>({snapshot:{...saved,dependencySummary}})}
  render(<Transfer client={client} visible capabilities={capabilities} sessionId="story"/>);fireEvent.click(screen.getByRole('button',{name:'导出完整故事存档'}))
  expect(await screen.findByRole('heading',{name:'当前绑定'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'资产/模板默认（保留库内容）'})).toBeInTheDocument();expect(screen.getByText(/仅展示.*完整历史/u)).toBeInTheDocument();expect(screen.getAllByText('预设 Style · 版本 2')).toHaveLength(2)
})

it('legacy saved preview without a dependency summary shows not recorded instead of guessing from payloads',async()=>{
  const Transfer=requireComponent('StoryTransfer'),client={previewSavedStory:async()=>({supported:true,conflicts:[],requirements:[],identityMode:'preserve',deferredChecks:[]})}
  render(<Transfer client={client} visible capabilities={capabilities} sessionId="story"/>);fireEvent.change(screen.getByLabelText('故事存档 JSON'),{target:{value:JSON.stringify(saved)}});fireEvent.click(screen.getByRole('button',{name:'预检故事存档'}));expect(await screen.findByText('未记录依赖用途摘要')).toBeInTheDocument()
})
