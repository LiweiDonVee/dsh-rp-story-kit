import React from 'react'
import {afterEach,describe,it,expect} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createStoryKitHost} from '../../src/host.mjs'
import {createStoryKitStore} from '../../src/store.mjs'

const ui=await import('../../src/StoryKitWorkspace.jsx').catch(()=>({}))
const rawText=await readFile('tests/fixtures/harbor-v2.json','utf8')
const resources=[]
afterEach(async()=>{cleanup();for(const cleanup of resources.splice(0))await cleanup()})
async function setup(){expect(typeof ui.StoryKitWorkspace).toBe('function');const directory=await mkdtemp(join(tmpdir(),'story-kit-ui-')),store=createStoryKitStore({directory}),client=await createStoryKitHost({get:()=>undefined},{store});resources.push(async()=>{client.close();await rm(directory,{recursive:true,force:true})});return{client,store}}
function show(client,visible=true){return render(<ui.StoryKitWorkspace client={client} visible={visible}/>)}
async function importCard(){fireEvent.click(screen.getByRole('button',{name:'导入资产'}));fireEvent.change(screen.getByLabelText('角色卡 JSON'),{target:{value:rawText}});fireEvent.click(screen.getByRole('button',{name:'保存导入资产'}));await screen.findByDisplayValue('雾港档案')}

describe('native Story Kit asset editor',()=>{
  it('imports a two-opening setting asset, exposes inert original review and keeps real launch unavailable',async()=>{
    const{client}=await setup();show(client);await importCard()
    expect(screen.getByLabelText('描述')).toHaveValue('一座潮汐驱动的合成港城；这是世界设定资产。')
    fireEvent.change(screen.getByLabelText('选择开场'),{target:{value:'alternate-1'}})
    expect(screen.getByLabelText('选择开场')).toHaveValue('alternate-1')
    expect(screen.getByRole('button',{name:'开始故事'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'查看原件'}))
    expect(screen.getByLabelText('原始来源')).toHaveValue(rawText)
    expect(screen.getByLabelText('原始来源')).toHaveAttribute('readonly')
    expect(screen.getAllByText(/示例对话.*不是.*历史/u).length).toBeGreaterThan(0)
  })

  it('creates original settings and same-name personas as separate records without inventing starter facts',async()=>{
    const{client}=await setup();show(client)
    await screen.findByRole('button',{name:'新建角色资产'})
    fireEvent.click(screen.getByRole('button',{name:'新建角色资产'}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:'只有设定的港城'}});fireEvent.change(screen.getByLabelText('描述'),{target:{value:'潮汐决定交通。'}});fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));await screen.findByText('已保存版本 1')
    fireEvent.click(screen.getByRole('button',{name:'新建玩家身份'}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:'旅人'}});fireEvent.change(screen.getByLabelText('描述'),{target:{value:'测绘员'}});fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));await waitFor(async()=>expect((await client.state({})).personas.length).toBe(1))
    await screen.findByText('已保存版本 1')
    fireEvent.click(screen.getByRole('button',{name:'新建玩家身份'}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:'旅人'}});fireEvent.change(screen.getByLabelText('描述'),{target:{value:'守灯人'}});fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));await waitFor(async()=>expect((await client.state({})).personas.length).toBe(2))
    const state=await client.state({});expect(state.characters).toHaveLength(1);expect(state.personas[0].assetId).not.toBe(state.personas[1].assetId)
  })

  it('keeps dirty draft and base revision after an external save conflict until explicit reload',async()=>{
    const{client}=await setup();show(client);await importCard()
    fireEvent.change(screen.getByLabelText('描述'),{target:{value:'本地未保存描述'}})
    const state=await client.state({}),asset=(await client.asset({kind:'character',assetId:state.characters[0].assetId,version:1})).asset
    await act(()=>client.saveCharacter({character:{...asset,description:'外部新版'},expectedRevision:1}))
    fireEvent.click(screen.getByRole('button',{name:'保存新版本'}))
    await screen.findByRole('alert');expect(screen.getByLabelText('描述')).toHaveValue('本地未保存描述')
    fireEvent.click(screen.getByRole('button',{name:'放弃修改并重新载入'}))
    await waitFor(()=>expect(screen.getByLabelText('描述')).toHaveValue('外部新版'))
  })

  it('aborts a late detail request when hidden and removes the global library subscription',async()=>{
    const{client}=await setup();await client.importAsset({format:'json',rawText,expectedRevision:0})
    let release,signal,unsubscribed=0
    const original=client.asset,subscribe=client.subscribe
    client.asset=input=>{signal=input.signal;return new Promise(resolve=>{release=()=>original(input).then(resolve)})}
    client.subscribe=listener=>{const close=subscribe(listener);return()=>{unsubscribed++;close()}}
    const view=show(client);fireEvent.click(await screen.findByRole('button',{name:/雾港档案.*版本 1/u}));await waitFor(()=>expect(release).toBeTypeOf('function'))
    view.rerender(<ui.StoryKitWorkspace client={client} visible={false}/>)
    expect(signal.aborted).toBe(true);expect(unsubscribed).toBe(1)
  })

  it('rejects incomplete save receipts without claiming an unrelated content-pack import succeeded',async()=>{
    const{client}=await setup();client.createPersona=async()=>({revision:1})
    show(client);fireEvent.click(screen.getByRole('button',{name:'新建玩家身份'}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:'旅人'}});fireEvent.click(screen.getByRole('button',{name:'保存新版本'}))
    await screen.findByRole('alert');expect(screen.getByLabelText('名称')).toHaveValue('旅人');expect(screen.queryByText('内容包已导入，仍需审阅。')).toBeNull()
  })

  it('keeps the draft usable after hide aborts a mutation and allows a new save after reopening',async()=>{
    const{client}=await setup(),create=client.createPersona;let firstSignal,attempts=0
    client.createPersona=input=>{attempts++;if(attempts!==1)return create(input);firstSignal=input.signal;return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))}
    const view=show(client);fireEvent.click(screen.getByRole('button',{name:'新建玩家身份'}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:'中断后保留的旅人'}});fireEvent.click(screen.getByRole('button',{name:'保存新版本'}))
    await waitFor(()=>expect(firstSignal).toBeDefined())
    await act(async()=>{view.rerender(<ui.StoryKitWorkspace client={client} visible={false}/>);await Promise.resolve()})
    expect(firstSignal.aborted).toBe(true)
    await act(async()=>{view.rerender(<ui.StoryKitWorkspace client={client} visible={true}/>);await Promise.resolve()})
    expect(screen.getByLabelText('名称')).toHaveValue('中断后保留的旅人');expect(screen.getByRole('button',{name:'保存新版本'})).toBeEnabled();expect(screen.getByRole('button',{name:'新建玩家身份'})).toBeEnabled()
    fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));await screen.findByText('已保存版本 1')
    expect((await client.state({})).personas).toHaveLength(1)
  })

  it('does not let a hidden lifetime completion release the busy state of a newer mutation',async()=>{
    const{client}=await setup(),create=client.createPersona;let rejectOld,finishNew,attempts=0
    client.createPersona=input=>{attempts++;if(attempts===1)return new Promise((_resolve,reject)=>{rejectOld=reject});return new Promise((resolve,reject)=>{finishNew=()=>create(input).then(resolve,reject)})}
    const view=show(client);fireEvent.click(screen.getByRole('button',{name:'新建玩家身份'}));fireEvent.change(screen.getByLabelText('名称'),{target:{value:'新周期旅人'}});fireEvent.click(screen.getByRole('button',{name:'保存新版本'}))
    await waitFor(()=>expect(rejectOld).toBeTypeOf('function'))
    await act(async()=>{view.rerender(<ui.StoryKitWorkspace client={client} visible={false}/>)})
    await act(async()=>{view.rerender(<ui.StoryKitWorkspace client={client} visible={true}/>)})
    expect(screen.getByRole('button',{name:'保存新版本'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));await waitFor(()=>expect(finishNew).toBeTypeOf('function'))
    await act(async()=>{rejectOld(new DOMException('Old aborted operation','AbortError'));await Promise.resolve()})
    expect(screen.getByRole('button',{name:'保存新版本'})).toBeDisabled();expect(screen.queryByRole('alert')).toBeNull()
    await act(async()=>{await finishNew()});await screen.findByText('已保存版本 1');expect(screen.getByRole('button',{name:'保存新版本'})).toBeEnabled()
  })
})
