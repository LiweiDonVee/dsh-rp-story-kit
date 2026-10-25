import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createStoryKitStore} from '../src/store.mjs'
import {createStoryKitHost} from '../src/host.mjs'

const api=await import('../src/documents.mjs').catch(()=>({}))
const sha=text=>createHash('sha256').update(text).digest('hex'),raw=Buffer.from('公开合成原始文档\r\n\r\n第二段。'),chunkText='公开合成原始文档'
const ref={documentId:'manual',documentVersion:2,chunkId:'paragraph-1',paragraph:1}
const document={id:'manual',version:2,name:'公开手册',mimeType:'text/plain',sha256:sha(raw),dataBase64:raw.toString('base64'),databaseId:'book',extractionVersion:'text-v1',chunkingVersion:'paragraph-v1'}
const content={document,extraction:{text:'公开合成原始文档\n\n第二段。',chunks:[{ref,text:chunkText,sha256:sha(chunkText)}]}}
const database={id:'book',version:4,name:'资料',entries:[{id:'entry-1',title:'手册',content:'用户后来编辑的选材；原引用保持不变。',keywords:[],tags:[],notes:'',readOnly:false,mode:'auto',version:3,provenance:{...ref,kind:'document-chunk',extractionVersion:'text-v1',chunkingVersion:'paragraph-v1',textSha256:sha(chunkText)}}]}
function validate(db=database,documents=[content]){assert.equal(typeof api.validateDatabaseDocuments,'function');return api.validateDatabaseDocuments({database:db,documents})}
async function setup(t,provider){const directory=await mkdtemp(join(tmpdir(),'story-kit-documents-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=createStoryKitStore({directory}),service=await createStoryKitHost({get:name=>name==='rpDatabase'?provider:undefined},{store});t.after(()=>service.close());return{service,directory}}

test('document content resolves edited entries to unchanged immutable extraction chunks and exact original bytes',()=>{
  const result=validate();assert.equal(result[0].document.dataBase64,raw.toString('base64'));assert.equal(result[0].extraction.chunks[0].text,'公开合成原始文档')
  assert.deepEqual(validate({id:'empty',version:1,entries:[]},[]),[])
})

test('missing document/chunk, invalid identities/hashes and malformed locations reject content packs',()=>{
  for(const documents of [[],[content,content],[{...content,document:{...document,databaseId:'other'}}],[{...content,document:{...document,sha256:'0'.repeat(64)}}],[{...content,extraction:{...content.extraction,chunks:[]}}],[{...content,extraction:{...content.extraction,chunks:[{ref:{...ref,paragraph:0},text:chunkText,sha256:sha(chunkText)}]}}],[{...content,extraction:{...content.extraction,chunks:[{ref,text:chunkText,sha256:'0'.repeat(64)}]}}]])assert.throws(()=>validate(database,documents),{code:'INVALID_PACK'})
  assert.throws(()=>validate({...database,entries:[{...database.entries[0],provenance:{...database.entries[0].provenance,textSha256:'f'.repeat(64)}}]}),{code:'INVALID_PACK'})
})

test('pack exports/imports documents as a separate provider field and preserves original source audit verbatim',async t=>{
  const sourceText=JSON.stringify({name:'原始导入资料',originalDatabaseId:'book'}),source={format:'rp-database',rawText:sourceText,sha256:sha(sourceText),provenance:{name:'原始导入资料',originalDatabaseId:'book'}}
  let received
  const provider={contentRevision:async()=>({revision:0}),exportContent:async()=>({database,source,documents:[content]}),importContent:async input=>{received=input;return{revision:1,databaseId:'new-book',version:1,sourceId:'new-source',documentMappings:{'["manual",2]':{documentId:'new-manual',version:1}}}}}
  const origin=await setup(t,provider),saved=await origin.service.createCharacter({character:{name:'文档设定',openings:[],databaseRefs:[{key:'manual',databaseId:'book',version:4}]},expectedRevision:0}),{pack}=await origin.service.exportPack({characters:[{assetId:saved.assetId,version:1}],personas:[],templates:[]})
  assert.deepEqual(pack.databases[0].documents,[content]);assert.deepEqual(pack.databases[0].source,source)
  const destination=await setup(t,provider),result=await destination.service.importPack({pack,expectedRevision:0})
  assert.deepEqual(received.documents,[content]);assert.deepEqual(received.source,source);assert.equal(received.database.entries[0].provenance.documentId,'manual')
  assert.deepEqual(result.mappings.databases['["book",4]'],{databaseId:'new-book',version:1,sourceId:'new-source',documentMappings:{'["manual",2]':{documentId:'new-manual',version:1}}})
  const selected=result.mappings.assets[JSON.stringify([saved.assetId,1])],asset=(await destination.service.asset({kind:'character',...selected})).asset
  assert.deepEqual(asset.databaseRefs,[{key:'manual',databaseId:'new-book',version:1}])
})

test('a pack with document provenance and missing documents is rejected before provider writes and journal creation',async t=>{
  let writes=0;const{service,directory}=await setup(t,{contentRevision:async()=>({revision:0}),importContent:async()=>{writes++;return{revision:1,databaseId:'new',version:1}}})
  const pack={format:'dsh-rp-story-pack',schemaVersion:1,assets:[],databases:[{id:'book',version:4,database}],profiles:[],storyTemplates:[],resources:[],requirements:['dsh-rp-database']}
  await assert.rejects(service.importPack({pack,expectedRevision:0}),{code:'INVALID_PACK'});assert.equal(writes,0);assert.deepEqual(await readdir(directory),[])
})
