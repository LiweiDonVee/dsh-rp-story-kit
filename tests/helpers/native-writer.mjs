import {createNativeSessionAdapter} from '../../src/native-session.mjs'

// Typed public persistence only; no Session file access or ownership token is invented.
export function installNativeWriter(environment){
  const calls=[],flushed=new Set()
  function handle(id){const row=environment.sessions.get(id);return{header:row.header,inheritedEventCount:row.inheritedEventCount,read:async()=>({events:structuredClone(row.events),eventState:'detached'}),append:async events=>{row.events.push(...structuredClone(events));calls.push({kind:'append',id,count:events.length})},flush:async()=>{flushed.add(id);calls.push({kind:'flush',id})},close:async()=>calls.push({kind:'close',id})}}
  const persistence={stat:async id=>environment.sessions.has(id)?{header:environment.sessions.get(id).header}:undefined,create:async(header,{inheritedEventCount})=>{calls.push({kind:'create-attempt',id:header.id});if(environment.sessions.has(header.id))throw Object.assign(new Error('occupied'),{name:'SessionAlreadyExistsError'});environment.sessions.set(header.id,{header:structuredClone(header),events:[],inheritedEventCount});calls.push({kind:'created',id:header.id});return handle(header.id)},open:async(id,mode)=>{calls.push({kind:'open',id,mode});return handle(id)},flush:async()=>{}}
  const services={connection:{browserPeer:{}},typertGateway:{stream(){}},sessionQuery:{observeSession(){}},sessionPersistence:persistence,sessions:{prepare(){}},sessionProjections:{hydrate(){}},agents:{resume(){}},agentPresets:{mount(){},list(){}},llm:{prepareCall(){}}}
  const native=createNativeSessionAdapter({get:name=>services[name]})
  environment.host.writeSession=input=>native.writeSession(input)
  return{native,persistence,calls,flushed}
}
