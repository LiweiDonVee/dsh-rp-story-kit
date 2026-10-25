import React,{useEffect,useRef,useState} from 'react'
import {createStoryKitApi} from './api.js'

const defaultClient=createStoryKitApi()
const emptyLibrary={revision:0,characters:[],personas:[],capabilities:{databaseImport:false,packExport:false,packImport:false,launch:false,readingExport:false}}
const emptyCharacter=()=>({name:'',description:'',personality:'',scenario:'',openings:[{id:'first',name:'默认开场',text:''}],examples:'',creator:{},databaseRefs:[]})
const emptyPersona=()=>({name:'',description:''})
function Field({label,value,onChange,multiline=false,...props}){return <label className="rpsk-field"><span>{label}</span>{multiline?<textarea aria-label={label} value={value??''} onChange={event=>onChange(event.target.value)} {...props}/>:<input aria-label={label} value={value??''} onChange={event=>onChange(event.target.value)} {...props}/>}</label>}
async function fileBytes(file){if(file.arrayBuffer)return new Uint8Array(await file.arrayBuffer());return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('无法读取文件。'));reader.onload=()=>resolve(new Uint8Array(reader.result));reader.readAsArrayBuffer(file)})}
function base64(data){let text='';for(const value of data)text+=String.fromCharCode(value);return btoa(text)}

export function StoryKitWorkspace({visible=true,client=defaultClient}){
  const[library,setLibrary]=useState(emptyLibrary),[view,setView]=useState('library'),[kind,setKind]=useState('character'),[draft,setDraft]=useState(null),[baseRevision,setBaseRevision]=useState(0),[dirty,setDirty]=useState(false),[source,setSource]=useState(null),[showSource,setShowSource]=useState(false),[diagnostics,setDiagnostics]=useState([]),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[raw,setRaw]=useState(''),[openingId,setOpeningId]=useState(''),[personaRef,setPersonaRef]=useState(''),[pending,setPending]=useState(null),[packText,setPackText]=useState(''),[packPreview,setPackPreview]=useState(null),[exported,setExported]=useState('')
  const life=useRef(null),request=useRef(null),generation=useRef(0),dirtyRef=useRef(false),fileGeneration=useRef(0)
  dirtyRef.current=dirty
  async function refresh(signal){const next=await client.state({signal});if(!signal?.aborted)setLibrary(previous=>next.revision>=previous.revision?next:previous);return next}
  useEffect(()=>{
    if(!visible)return
    const controller=new AbortController();life.current=controller
    void refresh(controller.signal).catch(cause=>{if(!controller.signal.aborted)setError(cause.message)})
    const close=client.subscribe(()=>{void refresh(controller.signal).catch(cause=>{if(!controller.signal.aborted)setError(cause.message)})},()=>{if(!controller.signal.aborted)setStatus('正在重新同步资产库')})
    return()=>{controller.abort();request.current?.abort();generation.current++;fileGeneration.current++;close();life.current=null}
  },[visible,client])
  function startRequest(){request.current?.abort();const controller=new AbortController();request.current=controller;const token=++generation.current;return{signal:life.current?AbortSignal.any([controller.signal,life.current.signal]):controller.signal,token}}
  const current=({signal,token})=>!signal.aborted&&generation.current===token
  async function load(selection,force=false){
    if(dirtyRef.current&&!force){setPending(selection);return}
    const operation=startRequest();setError('');setStatus('')
    try{
      const result=await client.asset({...selection,signal:operation.signal})
      if(!current(operation))return
      let original=null
      if(result.asset.sourceId)original=(await client.source({sourceId:result.asset.sourceId,signal:operation.signal})).source
      if(!current(operation))return
      setKind(selection.kind);setDraft(result.asset);setBaseRevision(result.revision);setDirty(false);setSource(original);setShowSource(false);setDiagnostics([]);setOpeningId(result.asset.openings?.[0]?.id??'');setView('library');setPending(null)
    }catch(cause){if(current(operation))setError(cause.message)}
  }
  function newAsset(nextKind,force=false){if(dirtyRef.current&&!force){setPending({newKind:nextKind});return}startRequest();setKind(nextKind);setDraft(nextKind==='character'?emptyCharacter():emptyPersona());setSource(null);setShowSource(false);setBaseRevision(library.revision);setDirty(false);setView('library');setError('');setStatus('');setDiagnostics([]);setPending(null);setOpeningId(nextKind==='character'?'first':'')}
  function change(update){setDraft(previous=>({...previous,...update}));setDirty(true);setStatus('')}
  async function mutate(work,{selectKind=kind}={}){
    if(busy)return
    const operation=startRequest();setBusy(true);setError('');setStatus('')
    try{
      const result=await work(operation.signal)
      if(!current(operation))return
      if(!Number.isSafeInteger(result.revision))throw new Error('资产响应不完整，请重新载入。')
      const assetReceipt=typeof result.assetId==='string'&&Boolean(result.assetId)&&Number.isSafeInteger(result.version)&&result.version>0
      const packReceipt=result.mappings&&result.reviewRequired===true&&Array.isArray(result.diagnostics)
      if(!assetReceipt&&!packReceipt)throw new Error('资产响应不完整，请重新载入。')
      await refresh(operation.signal)
      if(!current(operation))return
      if(result.assetId&&Number.isSafeInteger(result.version)){await load({kind:selectKind,assetId:result.assetId,version:result.version},true);if(life.current&&!life.current.signal.aborted){setStatus(`已保存版本 ${result.version}`);setDiagnostics(result.diagnostics??[])}}
      else{setStatus('内容包已导入，仍需审阅。');setView('library');setPackPreview(null)}
      return result
    }catch(cause){if(current(operation)){setError(cause.message);setDiagnostics(cause.diagnostics??[])}}
    finally{if(life.current&&!life.current.signal.aborted)setBusy(false)}
  }
  async function save(){const value=structuredClone(draft),method=value.id?(kind==='character'?'saveCharacter':'savePersona'):(kind==='character'?'createCharacter':'createPersona');await mutate(signal=>client[method]({[kind]:value,expectedRevision:baseRevision,signal}))}
  async function importText(){await mutate(signal=>client.importAsset({format:'json',rawText:raw,expectedRevision:library.revision,signal}),{selectKind:'character'})}
  async function importFile(file){if(!file)return;const token=++fileGeneration.current;setError('');try{const data=await fileBytes(file);if(token!==fileGeneration.current||!visible)return;if(data[0]===80&&data[1]===75)throw new Error('暂不支持 ZIP；请选择 V2/V3 JSON 或静态角色 PNG。');const png=data[0]===137&&data[1]===80;const input=png?{format:'png',dataBase64:base64(data)}:{format:'json',rawText:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data)};await mutate(signal=>client.importAsset({...input,expectedRevision:library.revision,signal}),{selectKind:'character'})}catch(cause){if(token===fileGeneration.current)setError(cause.message)}}
  async function importWorldbook(){await mutate(async signal=>{const{revision}=await client.databaseRevision(signal);return client.importWorldbook({assetId:draft.id,version:draft.version,descriptorId:source.provenance?.data?.character_book?'data.character_book':'character_book',expectedRevision:baseRevision,expectedDatabaseRevision:revision,signal})},{selectKind:'character'})}
  async function preview(){setError('');try{const operation=startRequest(),result=await client.previewPack({pack:JSON.parse(packText),signal:operation.signal});if(current(operation))setPackPreview(result)}catch(cause){setError(cause.message);setPackPreview(null)}}
  async function exportPack(){setError('');try{const operation=startRequest(),player=personaRef?JSON.parse(personaRef):null;const result=await client.exportPack({characters:kind==='character'&&draft?.id?[{assetId:draft.id,version:draft.version}]:[],personas:kind==='persona'&&draft?.id?[{assetId:draft.id,version:draft.version}]:player?[{assetId:player[0],version:player[1]}]:[],templates:[],signal:operation.signal});if(current(operation))setExported(JSON.stringify(result.pack,null,2))}catch(cause){setError(cause.message)}}
  function download(){const url=URL.createObjectURL(new Blob([exported],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='story-kit-content-pack.json';link.click();URL.revokeObjectURL(url)}
  const embedded=source?.provenance?.data?.character_book??source?.provenance?.character_book
  return <div className="rpsk" data-story-kit-root="" style={{display:visible?'flex':'none'}}>
    <header className="rpsk-header"><div><h1>Story Kit</h1><p>角色、玩家身份与可复用开场</p></div><span className="rpsk-badge">资产库</span></header>
    <nav className="rpsk-toolbar" aria-label="资产操作"><button type="button" onClick={()=>setView('library')}>资产库</button><button type="button" disabled={busy} onClick={()=>newAsset('character')}>新建角色资产</button><button type="button" disabled={busy} onClick={()=>newAsset('persona')}>新建玩家身份</button><button type="button" disabled={busy} onClick={()=>{setView('import');setError('')}}>导入资产</button><button type="button" disabled={busy} onClick={()=>setView('packs')}>内容包</button></nav>
    {error&&<p role="alert" className="rpsk-alert">{error}</p>}{status&&<p role="status" className="rpsk-status">{status}</p>}
    {pending&&<div role="dialog" aria-label="未保存修改" className="rpsk-alert"><p>当前资产有未保存修改。</p><button type="button" onClick={()=>setPending(null)}>保留编辑</button><button type="button" onClick={()=>{const next=pending;setPending(null);if(next.newKind)newAsset(next.newKind,true);else void load(next,true)}}>放弃修改并切换</button></div>}
    {view==='import'?<section className="rpsk-content"><h2>导入角色资产</h2><p>支持 V2/V3 JSON 和常见 chara/ccv3 静态 PNG。脚本与宏保留为来源数据。</p><label className="rpsk-file">选择 JSON / PNG<input type="file" aria-label="选择角色卡文件" accept=".json,.png,application/json,image/png" disabled={busy} onChange={event=>{void importFile(event.target.files?.[0]);event.target.value=''}}/></label><Field label="角色卡 JSON" value={raw} multiline rows={12} onChange={value=>{fileGeneration.current++;setRaw(value)}}/><button type="button" disabled={busy||!raw.trim()} onClick={()=>void importText()}>保存导入资产</button></section>
    :view==='packs'?<section className="rpsk-content"><h2>内容包</h2><p>内容包包含可复用资产与明确引用，不包含正在运行的故事或存档恢复。</p><Field label="内容包 JSON" value={packText} multiline rows={10} onChange={value=>{setPackText(value);setPackPreview(null)}}/><div className="rpsk-row"><button type="button" disabled={busy||!packText.trim()} onClick={()=>void preview()}>检查内容包</button><button type="button" disabled={busy||!packPreview||packPreview.diagnostics.some(item=>item.code==='REQUIREMENT_UNAVAILABLE')} onClick={()=>void mutate(signal=>client.importPack({pack:JSON.parse(packText),expectedRevision:library.revision,signal}))}>导入内容包</button></div>{packPreview&&<div role="status"><p>{packPreview.counts.assets} 个资产 · {packPreview.counts.databases} 个资料库 · {packPreview.counts.profiles} 个预设</p>{packPreview.diagnostics.map((item,index)=><p key={index}>{item.message}</p>)}</div>}<hr/><p>导出当前已保存资产及选定的玩家身份。关联资料与预设需要对应插件内容服务。</p><button type="button" disabled={busy||!draft?.id} onClick={()=>void exportPack()}>导出所选内容</button>{exported&&<><textarea aria-label="导出的内容包" value={exported} readOnly rows={12}/><button type="button" onClick={download}>下载内容包 JSON</button></>}</section>
    :<div className="rpsk-layout"><aside className="rpsk-library" aria-label="资产列表"><h2>角色资产 <small>{library.characters.length}</small></h2>{!library.characters.length&&<p>导入角色卡，或从世界设定开始创作。</p>}{library.characters.map(asset=><button type="button" key={asset.assetId} disabled={busy} aria-pressed={kind==='character'&&draft?.id===asset.assetId} onClick={()=>void load({kind:'character',assetId:asset.assetId,version:asset.version})}><strong>{asset.name}</strong><small>版本 {asset.version}</small></button>)}<h2>玩家身份 <small>{library.personas.length}</small></h2>{!library.personas.length&&<p>为不同故事保存轻量玩家身份。</p>}{library.personas.map(asset=><button type="button" key={asset.assetId} disabled={busy} aria-pressed={kind==='persona'&&draft?.id===asset.assetId} onClick={()=>void load({kind:'persona',assetId:asset.assetId,version:asset.version})}><strong>{asset.name}</strong><small>版本 {asset.version}</small></button>)}</aside>
    <main className="rpsk-detail">{!draft?<div className="rpsk-empty"><h2>选择一份资产</h2><p>设定卡也可以保存在这里。导入后先审阅，再选择玩家身份与开场。</p></div>:<><header className="rpsk-detail-header"><h2>{kind==='character'?'角色资产':'玩家身份'} <small>{draft.version?`版本 ${draft.version}`:'新建'}</small></h2><div className="rpsk-row"><button type="button" disabled={busy||!draft.name.trim()} onClick={()=>void save()}>保存新版本</button>{draft.id&&<button type="button" disabled={busy} onClick={()=>void load({kind,assetId:draft.id},true)}>放弃修改并重新载入</button>}</div>{dirty&&<span className="rpsk-badge">有未保存修改</span>}</header>
      <fieldset disabled={busy}><Field label="名称" value={draft.name} onChange={name=>change({name})}/><Field label="描述" value={draft.description} multiline rows={5} onChange={description=>change({description})}/>
      {kind==='character'&&<><Field label="性格" value={draft.personality} multiline rows={3} onChange={personality=>change({personality})}/><Field label="情境" value={draft.scenario} multiline rows={3} onChange={scenario=>change({scenario})}/><section className="rpsk-section"><h3>可复用开场</h3>{draft.openings.map((opening,index)=><div className="rpsk-opening" key={opening.id}><Field label={`开场名称 ${index+1}`} value={opening.name} onChange={name=>change({openings:draft.openings.map(item=>item.id===opening.id?{...item,name}:item)})}/><Field label={`开场文本 ${index+1}`} value={opening.text} multiline rows={4} onChange={text=>change({openings:draft.openings.map(item=>item.id===opening.id?{...item,text}:item)})}/><button type="button" onClick={()=>change({openings:draft.openings.filter(item=>item.id!==opening.id)})}>移除开场 {index+1}</button></div>)}<button type="button" onClick={()=>change({openings:[...draft.openings,{id:`opening-${crypto.randomUUID()}`,name:`开场 ${draft.openings.length+1}`,text:''}]})}>添加开场</button></section><Field label="示例对话" value={draft.examples} multiline rows={5} onChange={examples=>change({examples})}/><p className="rpsk-muted">示例对话仅供参考，不是故事历史。</p><details><summary>作者与来源信息</summary><Field label="作者名称" value={draft.creator.name} onChange={name=>change({creator:{...draft.creator,name}})}/><Field label="作者备注" value={draft.creator.notes} multiline onChange={notes=>change({creator:{...draft.creator,notes}})}/><Field label="作者版本" value={draft.creator.version} onChange={version=>change({creator:{...draft.creator,version}})}/><Field label="标签（逗号分隔）" value={draft.creator.tags?.join(', ')} onChange={value=>change({creator:{...draft.creator,tags:value.split(',').map(item=>item.trim()).filter(Boolean)}})}/></details></>}
      </fieldset>
      {kind==='character'&&<section className="rpsk-section" aria-label="故事选择"><h3>故事选择</h3><label className="rpsk-field"><span>选择玩家身份</span><select aria-label="选择玩家身份" value={personaRef} onChange={event=>setPersonaRef(event.target.value)}><option value="">请选择玩家身份</option>{library.personas.map(asset=><option key={asset.assetId} value={JSON.stringify([asset.assetId,asset.version])}>{asset.name} · 版本 {asset.version}</option>)}</select></label><label className="rpsk-field"><span>选择开场</span><select aria-label="选择开场" value={openingId} onChange={event=>setOpeningId(event.target.value)}>{draft.openings.map(item=><option value={item.id} key={item.id}>{item.name||'未命名开场'}</option>)}</select></label><button type="button" disabled>开始故事</button><p className="rpsk-muted">真实 GM 启动尚未接线。资产库可独立使用；选择开场不会提交故事事件。</p></section>}
      {source&&<section className="rpsk-section"><h3>原件审阅</h3><p className="rpsk-hash">SHA256 {source.sha256}</p><button type="button" onClick={()=>setShowSource(value=>!value)}>查看原件</button>{showSource&&<textarea aria-label="原始来源" value={source.rawText??'二进制原件已保留。'} readOnly rows={12}/>}<p className="rpsk-muted">作者指令、宏和脚本保留为原件数据；未自动成为系统规则。</p>{embedded&&<><p>内嵌世界书：{embedded.name||'未命名世界书'}</p><button type="button" disabled={busy||dirty||!library.capabilities.databaseImport} onClick={()=>void importWorldbook()}>导入关联世界书</button>{!library.capabilities.databaseImport&&<p>原件已保留；启用 RP Database 后可继续导入。</p>}</>}</section>}
      {draft.databaseRefs?.length>0&&<section className="rpsk-section"><h3>关联资料</h3>{draft.databaseRefs.map(ref=><p className="rpsk-hash" key={ref.key}>{ref.key} · {ref.databaseId} · 版本 {ref.version}</p>)}</section>}
    </>}</main></div>}
    {diagnostics.length>0&&<section className="rpsk-diagnostics" aria-label="导入诊断"><h2>审阅提示</h2>{diagnostics.map((item,index)=><p key={index}>{item.message??item.code}</p>)}</section>}
  </div>
}
