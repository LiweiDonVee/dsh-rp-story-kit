import {homedir} from 'node:os'
import {join} from 'node:path'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {copy,fail,revision} from './assets.mjs'
import {createStoryKitStore,selectedAsset,appendAsset,storageKey} from './store.mjs'
import {createStoryKitRoutes} from './routes.mjs'
import {createPackService} from './packs.mjs'

export const name='rp-story-kit'
export const inject=['connection']
const summary=asset=>({assetId:asset.id,version:asset.version,name:asset.name,...asset.sourceId?{sourceId:asset.sourceId}:{},...asset.avatarResourceId?{avatarResourceId:asset.avatarResourceId}:{}})

export async function createStoryKitHost(ctx,options={}){
  const store=options.store??createStoryKitStore({directory:options.directory??join(process.env.DSH_HOME??join(homedir(),'.dsh'),'app-data','rp-story-kit')})
  let stopped=false
  const operations=new Set(),subscribers=new Set()
  const skillDisposers=new Set()
  const packs=createPackService({store,getDatabase:()=>ctx.get?.('rpDatabase'),getProfiles:()=>ctx.get?.('rpLastStep')})
  async function run(input={},work){if(stopped)fail('UNAVAILABLE','资产插件已停用。',503);const life=new AbortController();operations.add(life);const signal=input.signal?AbortSignal.any([input.signal,life.signal]):life.signal;try{signal.throwIfAborted();return await work(signal)}finally{operations.delete(life)}}
  async function mutation(input,work){return run(input,async signal=>{const result=await work(signal);for(const listener of subscribers){try{listener({revision:result.revision})}catch{/* Metadata observers cannot reject a committed owner change. */}}return result})}
  const service={
    apiVersion:1,
    state(input={}){return run(input,async()=>{const state=await store.snapshot();return{revision:state.revision,characters:state.characters.map(summary),personas:state.personas.map(summary),capabilities:{databaseImport:typeof ctx.get?.('rpDatabase')?.import==='function',packExport:true,packImport:true,launch:false,readingExport:false}}})},
    asset:input=>run(input,()=>store.asset(input)),
    source:input=>run(input,()=>store.source(input)),
    importAsset:input=>mutation(input,()=>store.importAsset(input)),
    createCharacter:input=>mutation(input,()=>store.createCharacter(input)),
    saveCharacter:input=>mutation(input,()=>store.saveCharacter(input)),
    createPersona:input=>mutation(input,()=>store.createPersona(input)),
    savePersona:input=>mutation(input,()=>store.savePersona(input)),
    importWorldbook(input){const captured=copy({...input,signal:undefined});return mutation(input,signal=>store.transact(captured.expectedRevision,async state=>{
      revision(captured.expectedDatabaseRevision)
      const asset=selectedAsset(state,'character',captured.assetId,captured.version),latest=selectedAsset(state,'character',captured.assetId)
      if(asset.version!==latest.version)fail('ASSET_VERSION_CONFLICT','请先载入最新资产版本再导入关联世界书。',409)
      const descriptor=(state.descriptors[storageKey(asset.sourceId??'')]??[]).find(item=>item.id===captured.descriptorId)
      if(!descriptor)fail('WORLD_BOOK_NOT_FOUND','所选版本没有该内嵌世界书。',404)
      const database=ctx.get?.('rpDatabase')
      if(typeof database?.import!=='function')fail('DEPENDENCY_UNAVAILABLE','世界书已保留；安装或启用 RP Database 后可导入。',409)
      signal.throwIfAborted()
      const result=await database.import({rawText:descriptor.rawText,name:descriptor.name,expectedRevision:captured.expectedDatabaseRevision,signal})
      const databaseRef={key:'card',databaseId:result.databaseId,version:result.version}
      const saved=appendAsset(state,'character',{...asset,databaseRefs:[...asset.databaseRefs.filter(ref=>ref.key!=='card'),databaseRef]})
      return{...saved,databaseRef,diagnostics:result.diagnostics??[]}
    }))},
    launch:input=>run(input,()=>fail('CAPABILITY_UNAVAILABLE','真实故事启动尚未接线；当前可管理资产、选择身份与开场。',409)),
    exportReading:input=>run(input,()=>fail('CAPABILITY_UNAVAILABLE','授权的正式正文导出尚未接线。',409)),
    exportPack:input=>run(input,signal=>packs.exportPack({...input,signal})),
    previewPack:input=>run(input,signal=>packs.previewPack({...input,signal})),
    importPack:input=>mutation(input,signal=>packs.importPack({...input,signal})),
    subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener)},
    close(){if(stopped)return;stopped=true;for(const life of operations)life.abort();for(const dispose of skillDisposers)dispose();subscribers.clear()},
  }
  if(typeof ctx.inject==='function'||ctx.get?.('skills')){
    const directory=options.skillDirectory??fileURLToPath(new URL('./skills/adapting-roleplay-story-assets/',import.meta.url)),raw=await readFile(join(directory,'SKILL.md'),'utf8')
    const description=/^description:\s*(.+)$/mu.exec(raw)?.[1]??'Adapt roleplay assets in Story Kit',content=raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u,'').trim()
    const install=child=>{if(stopped)return;const mount=()=>{const unregister=child.skills.register({name:'adapting-roleplay-story-assets',description,content,source:'bundled',resourceBase:{kind:'directory',path:directory}});let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;skillDisposers.delete(dispose);unregister()};skillDisposers.add(dispose);return dispose};if(typeof child.effect==='function')child.effect(mount,'Story Kit adaptation skill');else mount()}
    if(typeof ctx.inject==='function')ctx.inject(['skills'],install);else install({skills:ctx.get('skills')})
  }
  return service
}

export async function apply(ctx,options={}){
  const service=await createStoryKitHost(ctx,options),routes=createStoryKitRoutes(service)
  ctx.provide('rpStoryKit',service)
  const unregister=[ctx.connection.fetch.register({path:'/api/rp-story-kit/request',methods:['POST'],requestBody:'buffered',fetch:request=>routes.request(request)}),ctx.connection.fetch.register({path:'/api/rp-story-kit/events',methods:['GET'],requestBody:'buffered',fetch:request=>routes.events(request)})]
  ctx.effect(()=>async()=>{routes.close();await service.close();for(const dispose of unregister)await dispose()},'Story Kit owner runtime')
}
