import {useEffect,useRef,useState} from 'react'

export function useOwnerOperation(visible){
  const life=useRef(null),active=useRef(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{if(!visible)return;const lifetime=new AbortController();life.current=lifetime;return()=>{if(active.current?.lifetime===lifetime){active.current.request.abort();active.current=null;setBusy(false)}lifetime.abort();if(life.current===lifetime)life.current=null}},[visible])
  async function perform(work,onSuccess){
    if(!life.current||life.current.signal.aborted||active.current)return
    const operation={lifetime:life.current,request:new AbortController()};active.current=operation;setBusy(true);setError('')
    const signal=AbortSignal.any([operation.lifetime.signal,operation.request.signal]),owns=()=>active.current===operation&&life.current===operation.lifetime&&!signal.aborted
    try{const result=await work(signal);if(owns())await onSuccess?.(result,signal)}catch(cause){if(owns())setError(cause.message??'操作未完成。')}finally{if(active.current===operation){active.current=null;if(life.current===operation.lifetime&&!operation.lifetime.signal.aborted)setBusy(false)}}
  }
  return{busy,error,perform}
}
