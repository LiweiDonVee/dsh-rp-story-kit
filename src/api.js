export function createStoryKitApi(send=(...args)=>globalThis.fetch(...args)){
  async function request(action,input={},signal,path='api/rp-story-kit/request'){
    const response=await send(new URL(path,document.baseURI),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...input}),signal})
    let data
    try{data=await response.json()}catch{throw Object.assign(new Error('无法读取资产响应，请重试。'),{status:response.status})}
    if(!response.ok||data?.error)throw Object.assign(new Error(data?.error?.message??'资产操作失败，请重试。'),{status:response.status,code:data?.error?.code,diagnostics:data?.error?.diagnostics})
    return data
  }
  const api={}
  for(const action of ['state','asset','source','importAsset','createCharacter','saveCharacter','createPersona','savePersona','importWorldbook','launch','exportPack','previewPack','importPack','exportReading'])api[action]=(input={})=>{const{signal,...args}=input;return request(action,args,signal)}
  api.databaseRevision=signal=>request('state',{},signal,'api/rp-database/request').then(({revision})=>({revision}))
  api.subscribe=(onEvent,onError)=>{const events=new EventSource(new URL('api/rp-story-kit/events',document.baseURI));for(const type of ['connected','changed'])events.addEventListener(type,event=>{try{onEvent(JSON.parse(event.data))}catch{/* Ignore malformed metadata, not source content. */}});events.onerror=onError;return()=>events.close()}
  return api
}
