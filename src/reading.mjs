import {fail,identifier} from './assets.mjs'

const canRead=owner=>typeof owner?.storyHistory==='function'||typeof owner?.narratives==='function'
const effectiveUnavailable=()=>fail('EFFECTIVE_HISTORY_UNAVAILABLE','当前故事需要可用的 LastStep 有效正文读取服务。',409)
function narrativeRecords(records){if(!Array.isArray(records)||records.some(record=>typeof record?.text!=='string'))fail('UNAVAILABLE','正式正文响应无效。',503);return records}

export function createReadingExporter({getLastStep,getGM,getDatabase}){
  const available=()=>canRead(getLastStep())
  return{
    available,
    async exportReading({sessionId,format,signal}){
      identifier(sessionId,'故事 ID');if(!['markdown','text'].includes(format))fail('INVALID_REQUEST','阅读稿仅支持 Markdown 或 TXT。')
      const lastStep=getLastStep()
      if(!canRead(lastStep))fail('CAPABILITY_UNAVAILABLE','需要可用的 LastStep 正式正文读取服务。',409)
      signal?.throwIfAborted()
      let records,binding
      try{
        if(typeof lastStep.storyHistory==='function')records=narrativeRecords((await lastStep.storyHistory({sessionId,signal})).records)
        else{
          records=narrativeRecords((await lastStep.narratives({sessionId,signal})).records)
          if(records.some(record=>record.narrativeVersion!==undefined))effectiveUnavailable()
          const database=getDatabase?.()
          if(typeof database?.factReviewProjection==='function'){
            const projection=await database.factReviewProjection({sessionId,signal})
            if(!Array.isArray(projection?.groups))fail('UNAVAILABLE','当前事实投影响应无效。',503)
            if(projection.groups.some(group=>group?.activeReceiptId!=null||group?.pendingCandidateId!=null))effectiveUnavailable()
          }
        }
      }catch(error){if(error?.name==='AbortError')throw error;if(error?.status===403)fail('FORBIDDEN','没有读取该故事的权限。',403);if(error?.status===404)fail('SESSION_NOT_FOUND','找不到该故事。',404);if(error?.code==='EFFECTIVE_HISTORY_UNAVAILABLE')effectiveUnavailable();fail('UNAVAILABLE','正式正文暂不可读取。',503)}
      if(typeof getGM()?.binding==='function')try{binding=await getGM().binding({sessionId,signal})}catch(error){if(error?.name==='AbortError')throw error}
      signal?.throwIfAborted()
      const body=records.map(record=>record.text).join('\n\n'),markdown=format==='markdown',title=binding?.title??'故事阅读稿',text=(markdown?`# ${title}\n\n`:'')+body+'\n'
      return{fileName:sessionId.replaceAll(/[^\p{L}\p{N}._-]/gu,'_')+(markdown?'.md':'.txt'),mimeType:markdown?'text/markdown; charset=utf-8':'text/plain; charset=utf-8',text}
    },
  }
}
