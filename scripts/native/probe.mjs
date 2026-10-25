// Test-only owner-authenticated observation. Product owners are installed tgz packages.
export const name='story-kit-native-probe'
export const inject=['connection','llm','agents','sessionQuery','sessionPersistence']
export function apply(ctx){
  let modelCalls=0
  const adapter={providerInfo:id=>({id,name:'Local Story Kit acceptance provider'}),providerRetryPolicy:()=>undefined,imageRequestPricing:()=>undefined,imageRequestTarget:(_p,_m,value)=>value,listModels:async provider=>[{provider,id:'local',name:'Local metadata only'}],resolveModel:async(provider,id)=>{if(provider!=='story-kit-native-local'||id!=='local')throw Error('LOCAL_MODEL_UNKNOWN');return{provider,id,name:'Local metadata only'}},async prepareCall(provider,id){return{model:await this.resolveModel(provider,id),stream:()=>{modelCalls++;throw Error('ASSET_PHASE_MUST_NOT_GENERATE')}}}}
  const disposers=[ctx.llm.registerAdapter(['story-kit-native-local'],adapter)]
  disposers.push(ctx.connection.fetch.register({path:'/api/story-kit-native-probe',methods:['POST'],requestBody:'buffered',fetch:async request=>{
    try{
      const input=await request.json();if(!input||Object.keys(input).some(key=>key!=='action'))throw Error('PROBE_REQUEST_INVALID')
      let result
      if(input.action==='ready'){
        const services={};for(const name of ['rpStoryKit','rpDatabase','rpLastStep','rpContext','loopStudio','rpGM']){const service=ctx.get(name);services[name]={available:!!service,apiVersion:service?.apiVersion??null,methods:['importContent','exportContent','contentRevision','importDocument','document','exportSavedStory','restoreSavedStory','startStory','inspect','savePolicy'].filter(method=>typeof service?.[method]==='function')}}
        result={services,capabilities:(await ctx.get('rpStoryKit').state({signal:request.signal})).capabilities,modelCalls,liveAgents:ctx.agents.list?.()?.length??null}
      }else if(input.action==='lastStepRevision')result=await ctx.get('rpLastStep').contentRevision({signal:request.signal})
      else if(input.action==='counters')result={modelCalls}
      else throw Error('PROBE_ACTION_INVALID')
      return Response.json({result})
    }catch(error){return Response.json({error:{code:error.code??'PROBE_ERROR',message:String(error.message).slice(0,500)}},{status:503})}
  }}))
  ctx.effect(()=>async()=>{for(const dispose of disposers.reverse())await dispose?.()},'Story Kit native observation')
}
