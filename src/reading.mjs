import {fail,identifier} from './assets.mjs'

export function createReadingExporter({getLastStep,getGM}){
  const available=()=>typeof getLastStep()?.narratives==='function'
  return{
    available,
    async exportReading({sessionId,format,signal}){
      identifier(sessionId,'故事 ID');if(!['markdown','text'].includes(format))fail('INVALID_REQUEST','阅读稿仅支持 Markdown 或 TXT。')
      if(!available())fail('CAPABILITY_UNAVAILABLE','需要可用的 LastStep 正式正文读取服务。',409)
      signal?.throwIfAborted()
      let records,binding
      try{
        ;({records}=await getLastStep().narratives({sessionId,signal}))
      }catch(error){if(error?.name==='AbortError')throw error;if(error?.status===403)fail('FORBIDDEN','没有读取该故事的权限。',403);if(error?.status===404)fail('SESSION_NOT_FOUND','找不到该故事。',404);fail('UNAVAILABLE','正式正文暂不可读取。',503)}
      if(typeof getGM()?.binding==='function')try{binding=await getGM().binding({sessionId,signal})}catch(error){if(error?.name==='AbortError')throw error}
      if(!Array.isArray(records)||records.some(record=>typeof record.text!=='string'))fail('UNAVAILABLE','正式正文响应无效。',503)
      signal?.throwIfAborted()
      const body=records.map(record=>record.text).join('\n\n'),markdown=format==='markdown',title=binding?.title??'故事阅读稿',text=(markdown?`# ${title}\n\n`:'')+body+'\n'
      return{fileName:sessionId.replaceAll(/[^\p{L}\p{N}._-]/gu,'_')+(markdown?'.md':'.txt'),mimeType:markdown?'text/markdown; charset=utf-8':'text/plain; charset=utf-8',text}
    },
  }
}
