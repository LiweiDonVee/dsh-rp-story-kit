import {homedir} from 'node:os'
import {join} from 'node:path'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {copy,fail,revision} from './assets.mjs'
import {createStoryKitStore,selectedAsset,appendAsset,storageKey} from './store.mjs'
import {createStoryKitRoutes} from './routes.mjs'
import {createPackService} from './packs.mjs'
import {createLaunchService} from './launch.mjs'
import {createReadingExporter} from './reading.mjs'
import {createStoryKitTransfer} from './transfer-state.mjs'
import {createNativeSessionAdapter} from './native-session.mjs'
import {createSavedStoryCoordinator} from './saved-story.mjs'

export const name='rp-story-kit'
export const inject=['connection']
const summary=asset=>({assetId:asset.id,version:asset.version,name:asset.name,...asset.sourceId?{sourceId:asset.sourceId}:{},...asset.avatarResourceId?{avatarResourceId:asset.avatarResourceId}:{}})

export async function createStoryKitHost(ctx,options={}){
  const store=options.store??createStoryKitStore({directory:options.directory??join(process.env.DSH_HOME??join(homedir(),'.dsh'),'app-data','rp-story-kit')})
  let stopped=false
  const operations=new Set(),pending=new Set(),subscribers=new Set()
  const skillDisposers=new Set()
  const get=name=>ctx.get?.(name)??ctx[name],native=createNativeSessionAdapter(ctx),launches=createLaunchService({store,getGM:()=>get('rpGM'),getDatabase:()=>get('rpDatabase'),getLastStep:()=>get('rpLastStep')}),reading=createReadingExporter({getLastStep:()=>get('rpLastStep'),getGM:()=>get('rpGM')})
  const transfer=createStoryKitTransfer({store,getGM:()=>get('rpGM'),readSession:native.readSession,readerAvailable:native.readable})
  const ownerMap={database:'rpDatabase',context:'rpContext',lastStep:'rpLastStep',gm:'rpGM',loop:'loopStudio'},saved=createSavedStoryCoordinator({store,host:native,getOwner:name=>name==='storyKit'?transfer:get(ownerMap[name])})
  const packs=createPackService({store,getDatabase:()=>get('rpDatabase'),getProfiles:()=>get('rpLastStep')})
  async function run(input={},work){if(stopped)fail('UNAVAILABLE','资产插件已停用。',503);const life=new AbortController();operations.add(life);const signal=input.signal?AbortSignal.any([input.signal,life.signal]):life.signal;const task=Promise.resolve().then(()=>{signal.throwIfAborted();return work(signal)});pending.add(task);try{return await task}finally{pending.delete(task);operations.delete(life)}}
  async function mutation(input,work){return run(input,async signal=>{const result=await work(signal);for(const listener of subscribers){try{listener({revision:result.revision})}catch{/* Metadata observers cannot reject a committed owner change. */}}return result})}
  const service={
    apiVersion:1,
    state(input={}){return run(input,async signal=>{const pendingLaunches=await launches.pendingLaunches({signal}),state=await store.snapshot();return{revision:state.revision,characters:state.characters.map(summary),personas:state.personas.map(summary),pendingLaunches,capabilities:{databaseImport:typeof get('rpDatabase')?.import==='function',packExport:true,packImport:true,launch:launches.available(),readingExport:reading.available(),savedStoryExport:saved.exportAvailable(),savedStoryPreview:saved.previewAvailable(),savedStoryRestore:saved.restoreAvailable()}}})},
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
    launch:input=>mutation(input,signal=>{if(!launches.available())fail('CAPABILITY_UNAVAILABLE','需要可用的 GM、Database v2 与 LastStep 启动服务。',409);return launches.launch({...input,signal})}),
    resumeLaunch:input=>mutation(input,signal=>launches.resumeLaunch({...input,signal})),
    exportReading:input=>run(input,signal=>{if(!reading.available())fail('CAPABILITY_UNAVAILABLE','正式正文服务不可用。',409);return reading.exportReading({...input,signal})}),
    exportSavedStory:input=>run(input,signal=>saved.exportSavedStory({...input,signal})),
    previewSavedStory:input=>run(input,signal=>saved.previewSavedStory({...input,signal})),
    restoreSavedStory:input=>mutation(input,signal=>saved.restoreSavedStory({...input,signal})),
    contentRevision:input=>run(input,signal=>transfer.contentRevision({...input,signal})),
    exportState:input=>run(input,signal=>transfer.exportState({...input,signal})),
    preflightRestore:input=>run(input,signal=>transfer.preflightRestore({...input,signal})),
    restoreState:input=>mutation(input,signal=>transfer.restoreState({...input,signal})),
    exportPack:input=>run(input,signal=>packs.exportPack({...input,signal})),
    previewPack:input=>run(input,signal=>packs.previewPack({...input,signal})),
    importPack:input=>mutation(input,signal=>packs.importPack({...input,signal})),
    subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener)},
    async close(){if(stopped)return;stopped=true;for(const life of operations)life.abort();for(const dispose of skillDisposers)dispose();subscribers.clear();await Promise.allSettled(pending);await native.close()},
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
