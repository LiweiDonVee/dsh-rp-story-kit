import {createHash} from 'node:crypto'
import {copy,fail,object} from './assets.mjs'

const invalid=message=>fail('INVALID_PACK',message)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const id=value=>typeof value==='string'&&Boolean(value.trim())
const positive=value=>Number.isSafeInteger(value)&&value>0
const pair=(id,version)=>JSON.stringify([id,version])
function fields(value,required,optional=[]){if(!object(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))invalid('文档内容字段不符合 T4 合同。')}
function ref(value){fields(value,['documentId','documentVersion','chunkId'],['page','paragraph']);if(!id(value.documentId)||!id(value.chunkId)||!positive(value.documentVersion)||['page','paragraph'].some(key=>value[key]!==undefined&&!positive(value[key])))invalid('文档 chunk 引用无效。')}

/** Data-only source validation. Edited entry bodies are deliberately not compared with original chunk text. */
export function validateDatabaseDocuments({database,documents=[]}){
  if(!Array.isArray(documents)||!object(database)||!Array.isArray(database.entries))invalid('需要明确的文档内容数组与数据库版本。')
  const byDocument=new Map(),needed=new Set()
  for(const content of documents){
    fields(content,['document','extraction']);const{document,extraction}=content
    fields(document,['id','version','name','mimeType','sha256','dataBase64','databaseId','extractionVersion','chunkingVersion'])
    if(!id(document.id)||!positive(document.version)||document.databaseId!==database.id||['name','mimeType','extractionVersion','chunkingVersion'].some(key=>typeof document[key]!=='string')||typeof document.dataBase64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(document.dataBase64)||document.sha256!==hash(Buffer.from(document.dataBase64,'base64')))invalid('文档身份、原始字节或哈希无效。')
    fields(extraction,['text','chunks']);if(typeof extraction.text!=='string'||!Array.isArray(extraction.chunks))invalid('文档 extraction 无效。')
    const key=pair(document.id,document.version),chunks=new Map()
    if(byDocument.has(key))invalid('文档版本重复。')
    for(const chunk of extraction.chunks){
      fields(chunk,['ref','text','sha256']);ref(chunk.ref)
      if(chunk.ref.documentId!==document.id||chunk.ref.documentVersion!==document.version||typeof chunk.text!=='string'||chunk.sha256!==hash(chunk.text)||chunks.has(chunk.ref.chunkId))invalid('文档 chunk 的身份、文本哈希或唯一性无效。')
      chunks.set(chunk.ref.chunkId,chunk)
    }
    byDocument.set(key,{document,chunks})
  }
  for(const entry of database.entries){
    if(entry.provenance===undefined)continue
    const provenance=entry.provenance
    fields(provenance,['kind','documentId','documentVersion','chunkId','extractionVersion','chunkingVersion','textSha256'],['page','paragraph'])
    const key=pair(provenance.documentId,provenance.documentVersion),source=byDocument.get(key),chunk=source?.chunks.get(provenance.chunkId)
    if(provenance.kind!=='document-chunk'||!source||!chunk||provenance.extractionVersion!==source.document.extractionVersion||provenance.chunkingVersion!==source.document.chunkingVersion||provenance.textSha256!==chunk.sha256||['documentId','documentVersion','chunkId','page','paragraph'].some(key=>provenance[key]!==chunk.ref[key]))invalid('条目的文档/chunk 来源无法解析。')
    needed.add(key)
  }
  if([...byDocument.keys()].some(key=>!needed.has(key)))invalid('内容包包含未被该数据库版本引用的文档。')
  return copy(documents)
}
