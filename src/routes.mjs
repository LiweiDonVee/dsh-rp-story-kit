import {StoryKitError,object} from './assets.mjs'

const fields={state:[],asset:['kind','assetId','version'],source:['sourceId'],importAsset:['format','rawText','dataBase64','name','expectedRevision'],createCharacter:['character','expectedRevision'],saveCharacter:['character','expectedRevision'],createPersona:['persona','expectedRevision'],savePersona:['persona','expectedRevision'],importWorldbook:['assetId','version','descriptorId','expectedRevision','expectedDatabaseRevision'],launch:['launchId','character','persona','openingId','sources','profile','initialScene','initialFacts'],exportPack:['characters','personas','templates'],previewPack:['pack'],importPack:['pack','expectedRevision'],exportReading:['sessionId','format']}
const writes=new Set(['importAsset','createCharacter','saveCharacter','createPersona','savePersona','importWorldbook','importPack'])
const id=value=>typeof value==='string'&&Boolean(value.trim())&&value.length<=256
const version=value=>Number.isSafeInteger(value)&&value>0
const revision=value=>Number.isSafeInteger(value)&&value>=0
const ref=value=>object(value)&&id(value.assetId)&&version(value.version)&&Object.keys(value).every(key=>['assetId','version'].includes(key))
function valid(input){
  if(!object(input)||!Object.hasOwn(fields,input.action)||Object.keys(input).some(key=>key!=='action'&&!fields[input.action].includes(key)))return false
  if(writes.has(input.action)&&!revision(input.expectedRevision))return false
  if(input.action==='asset'&&(!['character','persona'].includes(input.kind)||!id(input.assetId)||input.version!==undefined&&!version(input.version)))return false
  if(input.action==='source'&&!id(input.sourceId))return false
  if(input.action==='importAsset'&&(!['json','png'].includes(input.format)||input.format==='json'&&(typeof input.rawText!=='string'||input.dataBase64!==undefined)||input.format==='png'&&(typeof input.dataBase64!=='string'||input.rawText!==undefined)||input.name!==undefined&&!id(input.name)))return false
  for(const[kind,field]of[['Character','character'],['Persona','persona']])if(input.action===`create${kind}`||input.action===`save${kind}`){if(!object(input[field]))return false;if(input.action.startsWith('save')&&(!id(input[field].id)||!version(input[field].version)))return false;if(input.action.startsWith('create')&&['id','version','sourceId'].some(key=>Object.hasOwn(input[field],key)))return false}
  if(input.action==='importWorldbook'&&(!id(input.assetId)||!version(input.version)||!id(input.descriptorId)||!revision(input.expectedDatabaseRevision)))return false
  if(input.action==='exportPack'&&(!Array.isArray(input.characters)||!input.characters.every(ref)||!Array.isArray(input.personas)||!input.personas.every(ref)||!Array.isArray(input.templates)))return false
  if(['previewPack','importPack'].includes(input.action)&&!object(input.pack))return false
  if(input.action==='launch'&&(!id(input.launchId)||!ref(input.character)||!ref(input.persona)||!id(input.openingId)||!Array.isArray(input.sources)||!object(input.initialScene)||input.initialFacts===undefined))return false
  if(input.action==='exportReading'&&(!id(input.sessionId)||!['markdown','text'].includes(input.format)))return false
  return true
}
const failure=(status,code,message,diagnostics=[])=>Response.json({error:{code,message,diagnostics}},{status,headers:{'cache-control':'no-store'}})
function errorResponse(error){if(error instanceof StoryKitError)return failure(error.status,error.code,error.message,error.diagnostics);if(error?.name==='AbortError')return failure(499,'CANCELLED','操作已取消。');return failure(503,'UNAVAILABLE','资产服务暂时不可用，请重试。')}

/** Exact authenticated Connection operations; the host owns authentication. */
export function createStoryKitRoutes(service){
  let stopped=false
  const streams=new Set()
  return{
    async request(request){
      if(stopped)return failure(503,'UNAVAILABLE','资产插件已停用。')
      let input
      try{input=await request.json()}catch{return failure(400,'INVALID_REQUEST','需要 JSON 操作。')}
      if(!valid(input))return failure(400,'INVALID_REQUEST','资产操作参数无效。')
      try{request.signal.throwIfAborted();const{action,...args}=input;return Response.json(await service[action]({...args,signal:request.signal}),{headers:{'cache-control':'no-store'}})}catch(error){return errorResponse(error)}
    },
    async events(request){
      if(stopped)return failure(503,'UNAVAILABLE','资产插件已停用。')
      try{
        const initial=await service.state({signal:request.signal})
        if(request.signal.aborted||stopped)return new Response(null,{status:204})
        let cleanup=()=>{}
        const body=new ReadableStream({start(controller){
          let closed=false,unsubscribe=()=>{}
          const encoder=new TextEncoder(),write=(type,revision)=>{if(closed)return;const bytes=encoder.encode(`event: ${type}\ndata: ${JSON.stringify({type,...Number.isSafeInteger(revision)?{revision}:{}})}\n\n`);if(controller.desiredSize<bytes.length){cleanup();return}controller.enqueue(bytes)}
          const timer=setInterval(()=>write('changed'),15000);timer.unref?.()
          const abort=()=>cleanup()
          cleanup=cancelled=>{if(closed)return;closed=true;clearInterval(timer);unsubscribe();streams.delete(cleanup);request.signal.removeEventListener('abort',abort);if(cancelled!==true)controller.close()}
          streams.add(cleanup);request.signal.addEventListener('abort',abort,{once:true})
          unsubscribe=service.subscribe(event=>write('changed',event.revision))
          if(stopped||request.signal.aborted)cleanup();else write('connected',initial.revision)
        },cancel(){cleanup(true)}},{highWaterMark:16384,size:chunk=>chunk.byteLength})
        return new Response(body,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store'}})
      }catch(error){return errorResponse(error)}
    },
    close(){stopped=true;for(const close of streams)close()},
  }
}
