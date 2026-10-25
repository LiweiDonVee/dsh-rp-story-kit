import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {copy,fail,identifier,normalizeCharacter,normalizePersona,object,revision} from './assets.mjs'
import {importCharacter} from './import.mjs'
import {isPng} from './png.mjs'

const queues=new Map()
const hash=id=>createHash('sha256').update(id).digest('hex')
const collection=kind=>{if(!['character','persona'].includes(kind))fail('INVALID_ASSET','资产类型无效。');return kind==='character'?'characters':'personas'}
export function selectedAsset(state,kind,assetId,version) {
  const list=state[collection(kind)][hash(identifier(assetId))]
  const asset=version===undefined?list?.at(-1):list?.find(item=>item.version===version)
  if(!asset)fail('ASSET_NOT_FOUND','找不到所选资产版本。',404)
  return asset
}
export function appendAsset(state,kind,input,{create=false}={}) {
  const normalize=kind==='character'?normalizeCharacter:normalizePersona,asset=normalize(input),key=hash(asset.id),records=state[collection(kind)]
  const versions=records[key]??[],latest=versions.at(-1)
  if(create&&latest)fail('ASSET_EXISTS','资产 ID 已存在。',409)
  if(!create&&!latest)fail('ASSET_NOT_FOUND','只能保存已有资产的新版本。',404)
  if(latest&&asset.version!==latest.version)fail('ASSET_VERSION_CONFLICT','资产已有新版本，请重新载入后保存。',409)
  if(asset.sourceId&&!state.sources[hash(asset.sourceId)])fail('SOURCE_NOT_FOUND','找不到原始来源。',404)
  if(asset.avatarResourceId&&!state.resources[hash(asset.avatarResourceId)])fail('RESOURCE_NOT_FOUND','找不到头像资源。',404)
  asset.version=latest?latest.version+1:1
  records[key]=[...versions,asset]
  return{assetId:asset.id,version:asset.version}
}

/** Single owned JSON file; callers never supply filesystem paths or mutable versions. */
export function createStoryKitStore({directory}) {
  const root=resolve(directory),queueKey=process.platform==='win32'?root.toLowerCase():root,file=join(root,'story-kit-store.json')
  async function readState(){
    let raw
    try{raw=await readFile(file,'utf8')}catch(error){if(error.code==='ENOENT')return{schemaVersion:1,revision:0,characters:{},personas:{},sources:{},resources:{},descriptors:{},templates:[]};throw error}
    let state
    try{state=JSON.parse(raw)}catch{fail('STORE_CORRUPT','资产存储不是有效 JSON。',500)}
    if(state.schemaVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<0||['characters','personas','sources','resources','descriptors'].some(key=>!object(state[key])))fail('STORE_CORRUPT','资产存储格式无效。',500)
    return state
  }
  function serial(work){const result=(queues.get(queueKey)??Promise.resolve()).then(work),settled=result.then(()=>{},()=>{});queues.set(queueKey,settled);void settled.then(()=>{if(queues.get(queueKey)===settled)queues.delete(queueKey)});return result}
  async function writeState(state){await mkdir(root,{recursive:true});const temporary=join(root,`.story-kit-${randomUUID()}.tmp`);try{await writeFile(temporary,JSON.stringify(state),{encoding:'utf8',flag:'wx'});await rename(temporary,file)}finally{await rm(temporary,{force:true})}}
  const read=work=>serial(async()=>copy(await work(await readState())))
  const updateInternal=(work,{signal}={})=>serial(async()=>{signal?.throwIfAborted();const state=await readState(),{changed=true,result={}}=await work(state);signal?.throwIfAborted();if(changed){state.revision++;await writeState(state)}return copy({...result,revision:state.revision})})
  const transact=(expectedRevision,work)=>serial(async()=>{revision(expectedRevision);const state=await readState();if(state.revision!==expectedRevision)fail('REVISION_CONFLICT','资产库已变化，请重新载入。',409);const result=await work(state,()=>writeState(state));state.revision++;await writeState(state);return copy({revision:state.revision,...result})})
  function create(kind,input,expectedRevision){const captured=copy(input);return transact(expectedRevision,state=>{if(!object(captured)||['id','version','sourceId'].some(key=>Object.hasOwn(captured,key)))fail('INVALID_ASSET','新建资产不可指定 ID、版本或来源。');return appendAsset(state,kind,{...captured,id:randomUUID(),version:1},{create:true})})}
  function save(kind,input,expectedRevision){const captured=copy(input);return transact(expectedRevision,state=>{if(!object(captured)||!captured.id||!captured.version)fail('INVALID_ASSET','保存需要资产 ID 与明确 base version。');return appendAsset(state,kind,captured)})}
  return{
    snapshot:()=>read(state=>({revision:state.revision,characters:Object.values(state.characters).map(items=>items.at(-1)),personas:Object.values(state.personas).map(items=>items.at(-1)),templates:state.templates??[]})),
    asset:({kind,assetId,version})=>read(state=>({revision:state.revision,asset:selectedAsset(state,kind,assetId,version)})),
    source:({sourceId})=>read(state=>{const source=state.sources[hash(identifier(sourceId))];if(!source)fail('SOURCE_NOT_FOUND','找不到原始来源。',404);const{id,format,rawText,dataBase64,sha256,provenance}=source;return{source:{id,format,...rawText!==undefined?{rawText}:{},...dataBase64!==undefined?{dataBase64}:{},sha256,provenance}}}),
    resource:({resourceId})=>read(state=>{const resource=state.resources[hash(identifier(resourceId))];if(!resource)fail('RESOURCE_NOT_FOUND','找不到资源。',404);return resource}),
    descriptors:({sourceId})=>read(state=>state.descriptors[hash(identifier(sourceId))]??[]),
    createCharacter:({character,expectedRevision})=>create('character',character,expectedRevision),
    saveCharacter:({character,expectedRevision})=>save('character',character,expectedRevision),
    createPersona:({persona,expectedRevision})=>create('persona',persona,expectedRevision),
    savePersona:({persona,expectedRevision})=>save('persona',persona,expectedRevision),
    importAsset(input){const captured=copy(input);return transact(captured.expectedRevision,state=>{
      if(!['json','png'].includes(captured.format)||captured.format==='json'&&(typeof captured.rawText!=='string'||captured.dataBase64!==undefined)||captured.format==='png'&&(typeof captured.dataBase64!=='string'||captured.rawText!==undefined))fail('INVALID_IMPORT','JSON 使用 rawText；PNG 使用 dataBase64。')
      const bytes=captured.format==='json'?Buffer.from(captured.rawText,'utf8'):Buffer.from(captured.dataBase64,'base64')
      if(captured.format==='png'&&!isPng(bytes))fail('INVALID_PNG','PNG 输入不含有效签名。')
      const result=importCharacter(bytes)
      if(captured.name!==undefined){if(typeof captured.name!=='string'||!captured.name.trim())fail('INVALID_ASSET','资产名称不能为空。');result.character.name=captured.name}
      state.sources[hash(result.source.id)]=result.source
      state.descriptors[hash(result.source.id)]=result.embeddedWorldbooks
      for(const resource of result.resources)state.resources[hash(resource.id)]=resource
      return{...appendAsset(state,'character',result.character,{create:true}),sourceId:result.source.id,diagnostics:result.diagnostics,embeddedWorldbooks:result.embeddedWorldbooks}
    })},
    // Internal queue seam for delegated imports and content-pack assembly, never an owner action.
    transact,rawState:()=>read(state=>state),updateInternal,storageKey:hash(queueKey),
  }
}

export const storageKey=hash
