import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {StoryKitError,copy,fail,identifier,normalizeBindings,normalizeCharacter,normalizePersona,object,version} from './assets.mjs'
import {appendAsset,storageKey} from './store.mjs'
import {importCharacter} from './import.mjs'
import {validateStorySeed} from './seeds.mjs'

export const packKey=(id,version)=>JSON.stringify([id,version])
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const put=(map,key,value)=>Object.defineProperty(map,key,{value,writable:true,enumerable:true,configurable:true})
const keys=(value,allowed)=>{if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('INVALID_PACK','内容包含未支持的结构字段。')}
const b64=value=>{if(typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value))fail('INVALID_PACK','内容包 Base64 无效。');return Buffer.from(value,'base64')}
const characterFields=['id','version','name','description','personality','scenario','openings','examples','creator','sourceId','databaseRefs','profileRef','avatarResourceId']
const personaFields=['id','version','name','description','sourceId','avatarResourceId']
function dataOnly(value){
  if(value===null||typeof value==='boolean')return
  if(typeof value==='number'&&Number.isFinite(value))return
  if(typeof value==='string'){if(/^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|etc|tmp|var|mnt)\/)/u.test(value))fail('INVALID_PACK','内容包不能携带本机绝对路径。');return}
  if(Array.isArray(value)){value.forEach(dataOnly);return}
  if(!object(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_PACK','内容包只能包含 JSON 数据。')
  for(const[key,item]of Object.entries(value)){
    if(['apikey','accesstoken','refreshtoken','credentials','password','providerconfig','localpath','cwd','sessionlogs','livelogs'].includes(key.toLowerCase().replaceAll('_','')))fail('INVALID_PACK','内容包不能携带凭据、本机配置或运行日志。')
    if(key==='rawText'||key==='dataBase64')continue
    dataOnly(item)
  }
}
function sourcePayload(value){
  keys(value,['format','rawText','dataBase64','sha256','provenance'])
  identifier(value.format,'来源格式')
  if(value.rawText!==undefined&&typeof value.rawText!=='string'||value.provenance!==undefined&&!object(value.provenance)||value.rawText===undefined&&value.dataBase64===undefined)fail('INVALID_PACK','原件来源格式无效。')
  const bytes=value.dataBase64!==undefined?b64(value.dataBase64):Buffer.from(value.rawText,'utf8')
  if(value.sha256!==digest(bytes))fail('INVALID_PACK','原件来源哈希不匹配。')
  let rawText,parsed
  if(['json-v2','json-v3','png-chara','png-ccv3'].includes(value.format)){
    // Reuse actual JSON/PNG parsing, including preferred metadata, CRC and APNG checks.
    const authoritative=importCharacter(bytes).source
    if(authoritative.format!==value.format)fail('INVALID_PACK','原件来源格式与实际字节不一致。')
    rawText=authoritative.rawText;parsed=authoritative.provenance
  }else{
    try{rawText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{if(value.rawText!==undefined)fail('INVALID_PACK','原件文本无法从原始字节解码。')}
    if(rawText!==undefined){try{parsed=JSON.parse(rawText.replace(/^\uFEFF/u,''))}catch{/* Unsupported non-JSON sources retain inert metadata only. */}}
  }
  if(value.rawText!==undefined&&value.rawText!==rawText)fail('INVALID_PACK','原件文本与原始字节不一致。')
  if(object(parsed)&&value.provenance!==undefined&&!isDeepStrictEqual(value.provenance,parsed))fail('INVALID_PACK','原件 provenance 与原始字节解析结果不一致。')
  if(parsed!==undefined)dataOnly(parsed)
  dataOnly(value)
  return{...copy(value),...rawText!==undefined?{rawText}:{},provenance:copy(object(parsed)?parsed:value.provenance??{})}
}
function unique(items,keyFn,label){const seen=new Set();for(const item of items){const key=keyFn(item);if(seen.has(key))fail('INVALID_PACK',`${label} 身份重复。`);seen.add(key)}return seen}
function refKey(ref,idField){if(!object(ref))fail('INVALID_PACK','内容引用必须是对象。');return packKey(identifier(ref[idField]),version(ref.version))}

export function validatePack(input){
  keys(input,['format','schemaVersion','assets','databases','profiles','storyTemplates','resources','requirements'])
  if(input.format!=='dsh-rp-story-pack'||input.schemaVersion!==1||['assets','databases','profiles','storyTemplates','resources','requirements'].some(key=>!Array.isArray(input[key])))fail('INVALID_PACK','需要 schemaVersion 1 的 Story Kit 内容包。')
  dataOnly(input)
  const pack=copy(input)
  if(pack.requirements.some(value=>typeof value!=='string'||!value.trim()))fail('INVALID_PACK','requirements 必须是非空文本数组。')
  for(const item of pack.assets){keys(item,['kind','asset','source']);if(!['character','persona'].includes(item.kind))fail('INVALID_PACK','内容包资产类型无效。');keys(item.asset,item.kind==='character'?characterFields:personaFields);identifier(item.asset.id);version(item.asset.version);item.asset=item.kind==='character'?normalizeCharacter(item.asset):normalizePersona(item.asset);if(item.source)item.source=sourcePayload(item.source);if(item.asset.sourceId&&!item.source)fail('INVALID_PACK','有来源引用的资产必须携带原件来源。')}
  const assetIds=unique(pack.assets,item=>packKey(item.asset.id,item.asset.version),'资产')
  for(const type of ['databases','profiles'])for(const item of pack[type]){
    const field=type==='databases'?'database':'profile';keys(item,['id','version',field,'source']);identifier(item.id);version(item.version)
    if(!object(item[field])||item[field].id!==item.id||item[field].version!==item.version||!Array.isArray(item[field].entries))fail('INVALID_PACK',`${field} 版本与封装身份不一致。`)
    if(item.source)item.source=sourcePayload(item.source)
  }
  const dbIds=unique(pack.databases,item=>packKey(item.id,item.version),'数据库'),profileIds=unique(pack.profiles,item=>packKey(item.id,item.version),'预设')
  const resourceIds=unique(pack.resources,item=>identifier(item.id),'资源')
  for(const resource of pack.resources){keys(resource,['id','mimeType','sha256','dataBase64']);if(!['image/png','image/jpeg','image/webp','image/gif','application/json','text/plain'].includes(resource.mimeType))fail('INVALID_PACK','内容包资源必须是非可执行数据。');if(resource.sha256!==digest(b64(resource.dataBase64)))fail('INVALID_PACK','资源哈希不匹配。')}
  const requireRef=(set,key)=>{if(!set.has(key))fail('PACK_REFERENCE_UNRESOLVED','内容包引用无法在包内解析。')}
  const bindings=refs=>{for(const ref of normalizeBindings(refs))requireRef(dbIds,refKey(ref,'databaseId'))}
  const profileRef=ref=>{if(ref)requireRef(profileIds,refKey(ref,'profileId'))}
  for(const item of pack.assets){if(item.asset.avatarResourceId)requireRef(resourceIds,item.asset.avatarResourceId);if(item.kind==='character'){bindings(item.asset.databaseRefs);profileRef(item.asset.profileRef)}}
  unique(pack.storyTemplates,item=>identifier(item.id),'模板')
  for(const template of pack.storyTemplates){
    keys(template,['id','title','character','persona','openingId','sources','profile','initialScene','initialFacts'])
    if(typeof template.title!=='string'||!template.title.trim())fail('INVALID_PACK','故事模板需要名称。')
    validateStorySeed({initialScene:template.initialScene,initialFacts:template.initialFacts})
    requireRef(assetIds,refKey(template.character,'assetId'));requireRef(assetIds,refKey(template.persona,'assetId'))
    const character=pack.assets.find(item=>item.kind==='character'&&packKey(item.asset.id,item.asset.version)===refKey(template.character,'assetId'))
    const persona=pack.assets.find(item=>item.kind==='persona'&&packKey(item.asset.id,item.asset.version)===refKey(template.persona,'assetId'))
    if(!character||!persona||!character.asset.openings.some(opening=>opening.id===template.openingId))fail('PACK_REFERENCE_UNRESOLVED','模板的资产类型或开场引用无效。')
    bindings(template.sources);profileRef(template.profile)
  }
  return pack
}

const payload=source=>Object.fromEntries(['format','rawText','dataBase64','sha256','provenance'].filter(key=>source[key]!==undefined).map(key=>[key,source[key]]))
export function createPackService({store,getDatabase,getProfiles}){
  function requirements(pack){return[...new Set([...pack.requirements,...pack.databases.length?['dsh-rp-database']:[],...pack.profiles.length?['dsh-rp-last-step']:[]])]}
  function diagnostics(pack){return requirements(pack).filter(name=>name==='dsh-rp-database'?typeof getDatabase()?.importContent!=='function'||typeof getDatabase()?.contentRevision!=='function':name==='dsh-rp-last-step'?typeof getProfiles()?.importContent!=='function'||typeof getProfiles()?.contentRevision!=='function':true).map(requirement=>({code:'REQUIREMENT_UNAVAILABLE',severity:'warning',requirement,message:`导入需要可用的 ${requirement} 内容服务。`}))}
  return{
    async exportPack({characters,personas,templates,signal}){
      const pack={format:'dsh-rp-story-pack',schemaVersion:1,assets:[],databases:[],profiles:[],storyTemplates:copy(templates),resources:[],requirements:[]}
      const databases=new Map(),profiles=new Map(),resources=new Set(),seen=new Set()
      for(const[kind,refs]of[['character',characters],['persona',personas]])for(const ref of refs){
        signal?.throwIfAborted();const asset=(await store.asset({kind,...ref})).asset,key=packKey(asset.id,asset.version)
        if(seen.has(key))continue;seen.add(key)
        const source=asset.sourceId?(await store.source({sourceId:asset.sourceId})).source:null
        pack.assets.push({kind,asset,...source?{source:payload(source)}:{}})
        if(asset.avatarResourceId)resources.add(asset.avatarResourceId)
        if(kind==='character'){for(const binding of asset.databaseRefs)databases.set(packKey(binding.databaseId,binding.version),binding);if(asset.profileRef)profiles.set(packKey(asset.profileRef.profileId,asset.profileRef.version),asset.profileRef)}
      }
      for(const template of templates){for(const binding of template.sources)databases.set(packKey(binding.databaseId,binding.version),binding);if(template.profile)profiles.set(packKey(template.profile.profileId,template.profile.version),template.profile)}
      for(const binding of databases.values()){const provider=getDatabase();if(typeof provider?.exportContent!=='function')fail('DEPENDENCY_UNAVAILABLE','导出引用资料需要 RP Database 内容服务。',409);const result=await provider.exportContent({databaseId:binding.databaseId,version:binding.version,signal});pack.databases.push({id:binding.databaseId,version:binding.version,database:result.database,...result.source?{source:payload(result.source)}:{}})}
      for(const ref of profiles.values()){const provider=getProfiles();if(typeof provider?.exportContent!=='function')fail('DEPENDENCY_UNAVAILABLE','导出引用预设需要 RP LastStep 内容服务。',409);const result=await provider.exportContent({...ref,signal});pack.profiles.push({id:ref.profileId,version:ref.version,profile:result.profile,...result.source?{source:payload(result.source)}:{}})}
      for(const resourceId of resources)pack.resources.push(await store.resource({resourceId}))
      pack.requirements=requirements(pack)
      return{pack:validatePack(pack)}
    },
    async previewPack({pack,signal}){signal?.throwIfAborted();const valid=validatePack(pack);return{diagnostics:diagnostics(valid),counts:{assets:valid.assets.length,databases:valid.databases.length,profiles:valid.profiles.length,storyTemplates:valid.storyTemplates.length,resources:valid.resources.length},requirements:requirements(valid)}},
    async importPack({pack:input,expectedRevision,signal}){
      const pack=validatePack(input),issues=diagnostics(pack)
      if(issues.length)throw new StoryKitError('DEPENDENCY_UNAVAILABLE','内容包依赖暂不可用；未开始导入。',409,issues)
      const fingerprint=digest(JSON.stringify(pack))
      return store.transact(expectedRevision,async(state,checkpoint)=>{
        state.pendingImports??={}
        let operation=state.pendingImports[fingerprint]
        if(!operation){operation={id:randomUUID(),mappings:{assets:{},databases:{},profiles:{},resources:{},storyTemplates:{}},requests:{}};state.pendingImports[fingerprint]=operation;await checkpoint()}
        const mappings=operation.mappings
        try{
          for(const[type,field,getProvider,idField]of[['databases','database',getDatabase,'databaseId'],['profiles','profile',getProfiles,'profileId']]){
            if(!pack[type].length)continue
            const provider=getProvider();let{revision}=await provider.contentRevision({signal})
            for(const item of pack[type]){
              signal?.throwIfAborted();const key=packKey(item.id,item.version)
              if(mappings[type][key])continue
              const requestKey=`${type}:${key}`,requestId=operation.requests[requestKey]??`${store.storageKey}:${operation.id}:${requestKey}`
              operation.requests[requestKey]=requestId;await checkpoint()
              const value=copy(item[field]);if(type==='profiles')value.status='draft'
              const result=await provider.importContent({[field]:value,...item.source?{source:item.source}:{},requestId,expectedRevision:revision,signal})
              mappings[type][key]={[idField]:identifier(result[idField]),version:version(result.version)};revision=result.revision;await checkpoint()
            }
          }
        }catch(error){if(error?.name==='AbortError')throw error;throw new StoryKitError('PACK_IMPORT_INCOMPLETE','内容服务导入未完成；已保留映射，再试会继续未完成项。',error?.status===409?409:503,[{code:error?.code??'DEPENDENCY_UNAVAILABLE',mappings:copy(mappings),requestIds:copy(operation.requests)}])}
        signal?.throwIfAborted()
        const remapBindings=bindings=>bindings.map(ref=>({key:ref.key,...mappings.databases[packKey(ref.databaseId,ref.version)]}))
        const remapProfile=ref=>mappings.profiles[packKey(ref.profileId,ref.version)]
        for(const resource of pack.resources){const id=randomUUID();put(mappings.resources,resource.id,id);state.resources[storageKey(id)]={...resource,id}}
        for(const item of pack.assets){
          const asset=copy(item.asset),oldKey=packKey(asset.id,asset.version);asset.id=randomUUID();asset.version=1
          if(item.source){const id=randomUUID();state.sources[storageKey(id)]={...copy(item.source),id};asset.sourceId=id;const provenance=item.source.provenance,sourcePath=object(provenance?.data?.character_book)?'data.character_book':object(provenance?.character_book)?'character_book':null;if(sourcePath&&item.source.rawText!==undefined)state.descriptors[storageKey(id)]=[{id:sourcePath,sourceId:id,sourcePath,name:`${asset.name}的世界书`,rawText:item.source.rawText}]}
          if(asset.avatarResourceId)asset.avatarResourceId=mappings.resources[asset.avatarResourceId]
          if(item.kind==='character'){asset.databaseRefs=remapBindings(asset.databaseRefs);if(asset.profileRef)asset.profileRef=remapProfile(asset.profileRef)}
          mappings.assets[oldKey]=appendAsset(state,item.kind,asset,{create:true})
        }
        for(const original of pack.storyTemplates){const template=copy(original);template.id=randomUUID();put(mappings.storyTemplates,original.id,template.id);template.character=mappings.assets[refKey(original.character,'assetId')];template.persona=mappings.assets[refKey(original.persona,'assetId')];template.sources=remapBindings(original.sources);if(original.profile)template.profile=remapProfile(original.profile);state.templates.push(template)}
        delete state.pendingImports[fingerprint]
        return{mappings:copy(mappings),diagnostics:[{code:'OWNER_REVIEW_REQUIRED',severity:'warning',message:'内容已导入；新来源、预设与初始场景仍需审阅，不会自动开始故事。'}],reviewRequired:true}
      })
    },
  }
}
