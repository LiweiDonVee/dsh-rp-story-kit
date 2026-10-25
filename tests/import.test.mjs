import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {deflateSync} from 'node:zlib'

const api = await import('../src/import.mjs').catch(() => ({}))
const fixture = await readFile(new URL('./fixtures/harbor-v2.json', import.meta.url))
const load = (bytes, options) => { assert.equal(typeof api.importCharacter, 'function', 'character import pipeline is available'); return api.importCharacter(bytes, options) }
function crc32(data) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
function chunk(type, data) { const name=Buffer.from(type), size=Buffer.alloc(4), crc=Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name,data]))); return Buffer.concat([size,name,data,crc]) }
function png(records, animated=false) { const header=Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1,4); header[8]=8; header[9]=6; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(animated?[chunk('acTL',Buffer.alloc(8))]:[]),...records.map(([key,value])=>chunk('tEXt',Buffer.from(key+'\0'+Buffer.from(value).toString('base64')))),chunk('IDAT',deflateSync(Buffer.from([0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))]) }

test('V2 field mapping preserves settings-only text, distinct openings and examples without inventing history', () => {
  const result=load(fixture)
  assert.equal(result.character.name,'雾港档案')
  assert.equal(result.character.description,'一座潮汐驱动的合成港城；这是世界设定资产。')
  assert.deepEqual(result.character.openings.map(({id,text})=>({id,text})),[{id:'first',text:'钟声越过雾面，守灯人递来一张空白航图。'},{id:'alternate-1',text:'退潮露出旧阶梯，信使在码头等候。'}])
  assert.match(result.character.examples,/穿过东堤/u)
  assert.equal(Object.hasOwn(result.character,'history'),false)
  assert.equal(Object.hasOwn(result.character,'systemPrompt'),false)
  assert.equal(result.character.creator.name,'公开合成测试')
  assert.ok(Array.isArray(result.embeddedWorldbooks),'returns frozen-contract embedded descriptors')
  assert.equal(result.embeddedWorldbooks[0].sourcePath,'data.character_book')
  assert.equal(result.embeddedWorldbooks[0].sourceId,result.source.id)
  assert.equal(result.embeddedWorldbooks[0].rawText,fixture.toString('utf8'))
  assert.ok(result.diagnostics.some(row=>row.code==='SCRIPTS_INERT'))
  assert.equal(result.source.provenance.data.system_prompt,'{{original}} 保留此作者字段供审阅。')
})

test('BOM/CRLF source bytes remain exact and IDs remain stable across repeated parsing', () => {
  const bytes=Buffer.from('\ufeff'+fixture.toString('utf8').replaceAll('\n','\r\n'))
  const first=load(bytes),second=load(bytes)
  assert.deepEqual(Buffer.from(first.source.dataBase64,'base64'),bytes)
  assert.equal(first.source.rawText,bytes.toString('utf8'))
  assert.deepEqual(first.character.openings,second.character.openings)
})

test('V3 common PNG chooses ccv3 over chara while retaining the unchanged original image', () => {
  const v3={spec:'chara_card_v3',spec_version:'3.0',data:{...JSON.parse(fixture).data,name:'雾港 V3',alternate_greetings:['第二开场'],group_only_greetings:['群聊开场']}}
  const bytes=png([['chara',fixture],['ccv3',JSON.stringify(v3)]])
  const result=load(bytes,{mimeType:'image/png'})
  assert.equal(result.character.name,'雾港 V3')
  assert.equal(result.source.format,'png-ccv3')
  assert.deepEqual(Buffer.from(result.source.dataBase64,'base64'),bytes)
  assert.deepEqual(Buffer.from(result.resources[0].dataBase64,'base64'),bytes)
  assert.equal(result.character.avatarResourceId,result.resources[0].id)
  assert.ok(result.diagnostics.some(row=>row.code==='GROUP_GREETINGS_INERT'))
})

test('common PNG uses chara when ccv3 is absent and reports malformed preferred metadata', () => {
  assert.equal(load(png([['chara',fixture]])).character.name,'雾港档案')
  assert.throws(()=>load(png([['chara',fixture],['ccv3','not json']])),{code:'INVALID_JSON'})
})

test('unsupported ZIP/APNG and corrupted PNG are explicit errors with no partial import', () => {
  assert.throws(()=>load(Buffer.from([80,75,3,4,1,2])),{code:'UNSUPPORTED_ZIP'})
  assert.throws(()=>load(png([['chara',fixture]],true)),{code:'UNSUPPORTED_APNG'})
  const broken=png([['chara',fixture]]);broken[broken.length-1]^=1
  assert.throws(()=>load(broken),{code:'INVALID_PNG'})
})

test('JSON schema errors are identified before the caller can persist an asset', () => {
  assert.throws(()=>load(Buffer.from('{"spec":"chara_card_v4","data":{"name":"x"}}')),{code:'UNSUPPORTED_CARD'})
  assert.throws(()=>load(Buffer.from('{"spec":"chara_card_v2","data":{"name":"x","alternate_greetings":[3]}}')),{code:'INVALID_CARD'})
})
