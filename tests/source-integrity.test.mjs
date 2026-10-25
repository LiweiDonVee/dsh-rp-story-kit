import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {deflateSync} from 'node:zlib'
import {createStoryKitStore} from '../src/store.mjs'
import {createStoryKitHost} from '../src/host.mjs'

const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const card=(text,spec='chara_card_v2')=>({spec,spec_version:spec==='chara_card_v3'?'3.0':'2.0',data:{name:'公开合成原件',first_mes:'雾里钟声',character_book:{name:'原件内嵌书',entries:[{id:0,keys:['钟'],content:text,enabled:true}]},extensions:{regex_scripts:[{findRegex:'never',replaceString:'globalThis.unexecuted = true'}]}}})
const original=card('A: 原始字节中的世界书'),other=card('B: 不同世界书'),rawA='\ufeff'+JSON.stringify(original,null,2).replaceAll('\n','\r\n'),rawB=JSON.stringify(other),bytesA=Buffer.from(rawA)
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
function png(records){const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...records.map(([key,text])=>chunk('tEXt',Buffer.from(key+'\0'+Buffer.from(text).toString('base64')))),chunk('IDAT',deflateSync(Buffer.from([0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))])}
function pack(source){return{format:'dsh-rp-story-pack',schemaVersion:1,assets:[{kind:'character',asset:{id:'card',version:1,name:'用户已编辑的名称',openings:[{id:'first',name:'开场',text:'雾'}],sourceId:'origin',databaseRefs:[{key:'card',databaseId:'book',version:1}]},source}],databases:[{id:'book',version:1,database:{id:'book',version:1,name:'资料',entries:[]}}],profiles:[],storyTemplates:[],resources:[],requirements:['dsh-rp-database']}}
async function setup(t){const directory=await mkdtemp(join(tmpdir(),'story-kit-source-'));t.after(()=>rm(directory,{recursive:true,force:true}));let writes=0,delegated;const provider={contentRevision:async()=>({revision:0}),importContent:async()=>{writes++;return{revision:1,databaseId:'native-book',version:1}},exportContent:async({databaseId,version})=>({database:{id:databaseId,version,name:'资料',entries:[]}}),import:async input=>{delegated=input.rawText;return{revision:2,databaseId:'delegated-book',version:1,diagnostics:[]}}};const store=createStoryKitStore({directory}),service=await createStoryKitHost({get:name=>name==='rpDatabase'?provider:undefined},{store});t.after(()=>service.close());return{directory,service,writes:()=>writes,delegated:()=>delegated}}
async function rejectedBeforeWrites(t,source,code='INVALID_PACK'){const{directory,service,writes}=await setup(t),input=pack(source);await assert.rejects(service.previewPack({pack:input}),{code});await assert.rejects(service.importPack({pack:input,expectedRevision:0}),{code});assert.equal(writes(),0);assert.deepEqual(await readdir(directory),[])}

test('JSON pack rejects reviewed/delegated text B under the correct hash of original bytes A',async t=>{
  await rejectedBeforeWrites(t,{format:'json-v2',dataBase64:bytesA.toString('base64'),sha256:sha(bytesA),rawText:rawB,provenance:other})
})

test('JSON pack rejects a provenance-only mismatch even when text and bytes agree',async t=>{
  await rejectedBeforeWrites(t,{format:'json-v2',dataBase64:bytesA.toString('base64'),sha256:sha(bytesA),rawText:rawA,provenance:other})
})

test('PNG pack validates source text and provenance against actual preferred card metadata',async t=>{
  const source=card('A: ccv3 原始世界书','chara_card_v3'),text=JSON.stringify(source),image=png([['chara',rawB],['ccv3',text]])
  await rejectedBeforeWrites(t,{format:'png-ccv3',dataBase64:image.toString('base64'),sha256:sha(image),rawText:rawB,provenance:other})
  await rejectedBeforeWrites(t,{format:'png-ccv3',dataBase64:image.toString('base64'),sha256:sha(image),rawText:text,provenance:other})
})

test('PNG pack parses real chunks instead of trusting matching supplied text plus a hash of corrupt bytes',async t=>{
  const image=png([['chara',rawA]]);image[image.length-1]^=1
  await rejectedBeforeWrites(t,{format:'png-chara',dataBase64:image.toString('base64'),sha256:sha(image),rawText:rawA,provenance:original},'INVALID_PNG')
})

test('valid JSON byte-backed source keeps BOM/CRLF and inert provenance across export/import and book delegation',async t=>{
  const{service}=await setup(t),source={format:'json-v2',dataBase64:bytesA.toString('base64'),sha256:sha(bytesA),rawText:rawA,provenance:original}
  const imported=await service.importPack({pack:pack(source),expectedRevision:0}),ref=imported.mappings.assets[JSON.stringify(['card',1])],asset=(await service.asset({kind:'character',...ref})).asset
  assert.equal(asset.name,'用户已编辑的名称')
  const exported=await service.exportPack({characters:[ref],personas:[],templates:[]}),destination=await setup(t),restored=await destination.service.importPack({pack:exported.pack,expectedRevision:0}),next=restored.mappings.assets[JSON.stringify([ref.assetId,1])],result=(await destination.service.asset({kind:'character',...next})).asset
  const stored=(await destination.service.source({sourceId:result.sourceId})).source
  assert.equal(stored.rawText,rawA);assert.deepEqual(Buffer.from(stored.dataBase64,'base64'),bytesA);assert.deepEqual(stored.provenance,original)
  await destination.service.importWorldbook({assetId:next.assetId,version:1,descriptorId:'data.character_book',expectedRevision:1,expectedDatabaseRevision:1});assert.equal(destination.delegated(),rawA)
})

test('valid PNG source derives omitted text/provenance from preserved original ccv3 bytes and delegates that text',async t=>{
  const source=card('A: PNG 内嵌资料','chara_card_v3'),text='\ufeff'+JSON.stringify(source,null,2).replaceAll('\n','\r\n'),image=png([['chara',rawB],['ccv3',text]]),first=await setup(t)
  const imported=await first.service.importAsset({format:'png',dataBase64:image.toString('base64'),expectedRevision:0}),{pack:exported}=await first.service.exportPack({characters:[{assetId:imported.assetId,version:1}],personas:[],templates:[]})
  delete exported.assets[0].source.rawText;delete exported.assets[0].source.provenance
  const destination=await setup(t),result=await destination.service.importPack({pack:exported,expectedRevision:0}),ref=result.mappings.assets[JSON.stringify([imported.assetId,1])],asset=(await destination.service.asset({kind:'character',...ref})).asset,stored=(await destination.service.source({sourceId:asset.sourceId})).source
  assert.deepEqual(Buffer.from(stored.dataBase64,'base64'),image);assert.equal(stored.rawText,text);assert.deepEqual(stored.provenance,source)
  await destination.service.importWorldbook({assetId:ref.assetId,version:1,descriptorId:'data.character_book',expectedRevision:1,expectedDatabaseRevision:0});assert.equal(destination.delegated(),text)
})
