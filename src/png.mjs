import {fail} from './assets.mjs'

const signature=Buffer.from([137,80,78,71,13,10,26,10])
export const isPng=bytes=>bytes.length>=8&&bytes.subarray(0,8).equals(signature)
function crc32(data) { let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0 }
function decode(value) { if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)||!value)fail('INVALID_PNG','角色 PNG 的 Base64 元数据无效。');return Buffer.from(value,'base64').toString('utf8') }

/** Parse only ancillary card data; never evaluate metadata or render instructions. */
export function extractPngCard(input) {
  const bytes=Buffer.from(input)
  if(!isPng(bytes))fail('INVALID_PNG','这不是有效的 PNG 文件。')
  let offset=8,ended=false,first=true
  const cards=new Map()
  while(offset<bytes.length){
    if(offset+12>bytes.length)fail('INVALID_PNG','PNG 数据块不完整。')
    const size=bytes.readUInt32BE(offset),end=offset+12+size
    if(end>bytes.length)fail('INVALID_PNG','PNG 数据块长度无效。')
    const name=bytes.subarray(offset+4,offset+8),type=name.toString('ascii'),data=bytes.subarray(offset+8,offset+8+size)
    if(bytes.readUInt32BE(end-4)!==crc32(Buffer.concat([name,data])))fail('INVALID_PNG','PNG 数据块校验失败。')
    if(first&&(type!=='IHDR'||size!==13))fail('INVALID_PNG','PNG 缺少有效图像头。')
    first=false
    if(type==='acTL')fail('UNSUPPORTED_APNG','暂不支持 APNG；请导出静态角色 PNG 或 V2/V3 JSON。')
    if(type==='tEXt'){
      const split=data.indexOf(0)
      if(split>0){const key=data.subarray(0,split).toString('latin1');if(key==='chara'||key==='ccv3'){if(cards.has(key))fail('INVALID_PNG','PNG 含重复角色元数据。');cards.set(key,data.subarray(split+1).toString('latin1'))}}
    }
    offset=end
    if(type==='IEND'){ended=true;break}
  }
  if(!ended||offset!==bytes.length)fail('INVALID_PNG','PNG 结尾无效。')
  const key=cards.has('ccv3')?'ccv3':cards.has('chara')?'chara':null
  if(!key)fail('CARD_METADATA_NOT_FOUND','PNG 中没有 chara 或 ccv3 角色数据。')
  return{key,rawText:decode(cards.get(key))}
}
