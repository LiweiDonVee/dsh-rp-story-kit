import React,{useEffect,useState} from 'react'
import {StoryLaunch} from './StoryActions.jsx'

const same=()=>{}
const reference=(id,version)=>JSON.stringify([id,version])
const readReference=value=>value?JSON.parse(value):['',0]
const onlyReference=records=>records.length===1?reference(records[0].assetId,records[0].version):''
const scriptKeys=new Set(['regex_scripts','tavern_helper_scripts','scripts','stscript'])

function useSavedAsset(client,kind,selection,visible){
  const[loaded,setLoaded]=useState(null),[failure,setFailure]=useState(null),[sourceState,setSourceState]=useState(null)
  useEffect(()=>{
    if(!visible||!selection)return
    const controller=new AbortController(),[assetId,version]=readReference(selection)
    setFailure(null)
    void client.asset({kind,assetId,version,signal:controller.signal}).then(result=>{
      if(!controller.signal.aborted)setLoaded({selection,asset:result.asset,versions:result.availableVersions??[result.asset.version]})
    }).catch(cause=>{if(!controller.signal.aborted)setFailure({selection,message:cause.message})})
    return()=>controller.abort()
  },[client,kind,selection,visible])
  const asset=loaded?.selection===selection?loaded.asset:null,sourceId=kind==='character'?asset?.sourceId:null
  useEffect(()=>{
    if(!visible||!sourceId)return
    const controller=new AbortController()
    setSourceState({sourceId,loading:true})
    void client.source({sourceId,signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setSourceState({sourceId,source:result.source})}).catch(cause=>{if(!controller.signal.aborted)setSourceState({sourceId,error:cause.message})})
    return()=>controller.abort()
  },[client,sourceId,visible])
  return{asset,source:sourceId&&sourceState?.sourceId===sourceId?sourceState.source:null,sourceLoading:Boolean(sourceId&&(sourceState?.sourceId!==sourceId||sourceState.loading)),sourceError:sourceId&&sourceState?.sourceId===sourceId?sourceState.error:'',versions:loaded?.asset.id===readReference(selection)[0]?loaded.versions:[],error:failure?.selection===selection?failure.message:''}
}

function AssetChoice({label,records,selection,onChange,versions=[],selectedName}){
  const[id,version]=readReference(selection),latest=records.find(item=>item.assetId===id)
  const choices=[...new Set([version,...versions])].sort((a,b)=>b-a)
  return <div className="rpsk-start-choice"><label className="rpsk-field"><span>{label}</span><select aria-label={label} value={id} onChange={event=>{const asset=records.find(item=>item.assetId===event.target.value);onChange(asset?reference(asset.assetId,asset.version):'')}}><option value="">请选择{label}</option>{records.map(asset=><option key={asset.assetId} value={asset.assetId}>{asset.assetId===id&&selectedName?selectedName:asset.name}</option>)}</select></label>{latest&&<label className="rpsk-field"><span>版本</span><select aria-label={`${label}版本`} value={version} onChange={event=>onChange(reference(id,Number(event.target.value)))}>{choices.map(value=><option key={value} value={value}>{value}{value===latest.version?'（当前）':''}</option>)}</select></label>}</div>
}

export function StorySourceStatus({character,source,loading=false,error=''}){
  const original=source?.provenance,data=original?.data??{},serialized=JSON.stringify(original??{})
  const embedded=data.character_book??original?.character_book,linkedBook=character.databaseRefs?.find(item=>item.key==='card')
  const extensions=[...Object.entries(original?.extensions??{}).map(([key])=>`extensions.${key}`),...Object.entries(data.extensions??{}).map(([key])=>`data.extensions.${key}`)]
  const unknown=extensions.filter(path=>!scriptKeys.has(path.split('.').at(-1)))
  const scripts=/"(?:regex_scripts|tavern_helper_scripts|scripts|stscript)"\s*:/u.test(serialized)
  const macros=/\{\{[\s\S]*?\}\}/u.test(serialized)
  return <details className="rpsk-source-status"><summary>来源与支持情况{error?' · 读取失败':''}</summary>{loading?<p role="status">正在读取来源诊断…</p>:error?<p role="alert">原件读取失败：{error}</p>:<dl className="rpsk-start-summary">
    <div><dt>角色来源</dt><dd>{source?`导入原件 · ${source.format}`:'Story Kit 已保存资产'}{source&&<span className="rpsk-hash">SHA256 {source.sha256}</span>}</dd></div>
    <div><dt>作者指令</dt><dd>{data.system_prompt||data.post_history_instructions?'含作者系统/后置指令，保留在原件中，待审阅适配':'原件未记录作者系统/后置指令'}</dd></div>
    <div><dt>脚本与正则</dt><dd>{scripts?'原件含脚本或正则，仅保留，未执行':'原件未记录已知脚本或正则字段'}</dd></div>
    <div><dt>宏</dt><dd>{macros?'原文宏按字面保留，未自动展开':'原件未检测到 {{…}} 宏'}</dd></div>
    <div><dt>内嵌世界书</dt><dd>{embedded?linkedBook?`已关联资料库 ${linkedBook.databaseId} · 版本 ${linkedBook.version}`:'保留在原件中，尚未关联导入的资料库':'原件未记录内嵌世界书'}</dd></div>
    <div><dt>关联预设</dt><dd>{character.profileRef?`${character.profileRef.profileId} · 版本 ${character.profileRef.version}`:'未关联预设，将使用 GM 默认；可在高级启动设置中指定'}</dd></div>
    <div><dt>其他扩展</dt><dd>{unknown.length?`保留在原件，尚未适配：${unknown.join('、')}`:'未记录其他扩展'}{data.group_only_greetings?.length>0&&<span>群聊专用开场保留在原件，未加入本次开场选项。</span>}</dd></div>
  </dl>}</details>
}

export function StoryStart({library,client,visible=true,initialSelection=null,navigate=same,onChanged=same,onLibrary=same,onImport=same}){
  const[characterRef,setCharacterRef]=useState(()=>initialSelection?.characterRef||onlyReference(library.characters)),[personaRef,setPersonaRef]=useState(()=>initialSelection?.personaRef||onlyReference(library.personas)),[openingId,setOpeningId]=useState(initialSelection?.openingId??''),[launching,setLaunching]=useState(false)
  const character=useSavedAsset(client,'character',characterRef,visible),persona=useSavedAsset(client,'persona',personaRef,visible)
  useEffect(()=>{if(!initialSelection)return;setCharacterRef(initialSelection.characterRef||onlyReference(library.characters));setPersonaRef(initialSelection.personaRef||onlyReference(library.personas));setOpeningId(initialSelection.openingId??'')},[initialSelection])
  useEffect(()=>{if(!characterRef&&library.characters.length===1)setCharacterRef(onlyReference(library.characters));if(!personaRef&&library.personas.length===1)setPersonaRef(onlyReference(library.personas))},[characterRef,personaRef,library.characters,library.personas])
  useEffect(()=>{if(character.asset)setOpeningId(previous=>character.asset.openings.some(item=>item.id===previous)?previous:character.asset.openings[0]?.id??'')},[character.asset])
  const openings=character.asset?.openings??[],openingIndex=openings.findIndex(item=>item.id===openingId),opening=openings[openingIndex]
  return <section className="rpsk-content rpsk-start" hidden={!visible} aria-label="开始新故事">
    <header><h2>开始新故事</h2><p className="rpsk-muted">确认角色、玩家身份和本次开场，点击后才会启动故事。</p></header>
    {character.error&&<p role="alert">{character.error}</p>}{persona.error&&<p role="alert">{persona.error}</p>}
    <div className="rpsk-start-body"><fieldset className="rpsk-start-assets" disabled={launching}>
    <section aria-label="选择角色"><h3>角色与版本</h3>{library.characters.length?<>
      <AssetChoice label="故事角色" records={library.characters} selection={characterRef} versions={character.versions} selectedName={character.asset?.name} onChange={setCharacterRef}/>
      {characterRef&&!character.asset&&!character.error&&<p role="status">正在读取所选角色版本…</p>}
      {character.asset&&<details className="rpsk-start-card"><summary>角色描述</summary><p>{character.asset.description||'此版本未填写描述。'}</p></details>}
    </>:<div className="rpsk-empty"><p>资产库还没有角色。导入角色卡，或创建并保存一份角色资产后开始。</p><div className="rpsk-row"><button type="button" onClick={onImport}>导入角色卡</button><button type="button" onClick={onLibrary}>打开资产库</button></div></div>}</section>
    <section aria-label="选择玩家身份"><h3>玩家身份与版本</h3>{library.personas.length?<>
      <AssetChoice label="故事玩家身份" records={library.personas} selection={personaRef} versions={persona.versions} selectedName={persona.asset?.name} onChange={setPersonaRef}/>
      {personaRef&&!persona.asset&&!persona.error&&<p role="status">正在读取所选玩家身份版本…</p>}
      {persona.asset&&<details className="rpsk-start-card"><summary>身份描述</summary><p>{persona.asset.description||'此版本未填写描述。'}</p></details>}
    </>:<div className="rpsk-empty"><p>先在资产库创建并保存一份玩家身份。</p><button type="button" onClick={onLibrary}>打开资产库</button></div>}</section>
    {character.asset&&<StorySourceStatus character={character.asset} source={character.source} loading={character.sourceLoading} error={character.sourceError}/>}
    </fieldset><section className="rpsk-start-opening" aria-label="预览并开始"><h3>本次开场</h3><fieldset disabled={launching}>{openings.length?<>
      <label className="rpsk-field"><span>选择开场</span><select aria-label="选择开场" value={openingId} onChange={event=>setOpeningId(event.target.value)}>{openings.map((item,index)=><option value={item.id} key={item.id}>{index+1} · {item.name||`开场 ${index+1}`}</option>)}</select></label>
      {opening&&<article className="rpsk-opening-preview" aria-label="当前开场预览"><header><strong>{opening.name||`开场 ${openingIndex+1}`}</strong><span>{openingIndex+1} / {openings.length}</span></header><p>{opening.text||'此开场文本为空。'}</p></article>}
      {openings.length>1&&<div className="rpsk-row"><button type="button" disabled={openingIndex<=0} onClick={()=>setOpeningId(openings[openingIndex-1].id)}>上一个开场</button><button type="button" disabled={openingIndex<0||openingIndex>=openings.length-1} onClick={()=>setOpeningId(openings[openingIndex+1].id)}>下一个开场</button></div>}
    </>:<p className="rpsk-muted">{character.asset?'此角色版本没有可用开场，请在资产库添加并保存开场。':'选择已保存的角色后，在这里预览开场。'}</p>}</fieldset>
    {character.asset&&opening&&<StoryLaunch character={character.asset} personaRef={persona.asset?personaRef:''} openingId={openingId} client={client} capabilities={library.capabilities} visible={visible} navigate={navigate} onChanged={onChanged} onBusyChange={setLaunching} compact/>}
    <button type="button" onClick={onLibrary}>取消</button>
    </section></div>
  </section>
}
