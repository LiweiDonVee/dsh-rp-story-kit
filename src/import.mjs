import {createHash,randomUUID} from 'node:crypto'
import {fail,object,normalizeCharacter} from './assets.mjs'
import {extractPngCard,isPng} from './png.mjs'

const diagnostic=(code,message,path)=>({code,severity:'warning',message,...path?{path}:{}})
const optionalText=(value,label)=>{if(value===undefined)return'';if(typeof value!=='string')fail('INVALID_CARD',`${label} 必须是文本。`);return value}

/** Imported fields are content assets. Author instructions remain source-only. */
export function importCharacter(input) {
  const bytes=typeof input==='string'?Buffer.from(input,'utf8'):Buffer.from(input)
  if(bytes[0]===80&&bytes[1]===75)fail('UNSUPPORTED_ZIP','暂不支持 ZIP；请直接选择 V2/V3 JSON 或静态角色 PNG。')
  let rawText,format,mimeType='application/json'
  if(isPng(bytes)){const card=extractPngCard(bytes);rawText=card.rawText;format=`png-${card.key}`;mimeType='image/png'}
  else{try{rawText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{fail('INVALID_JSON','角色 JSON 必须为有效 UTF-8。')}}
  let parsed
  try{parsed=JSON.parse(rawText.replace(/^\uFEFF/u,''))}catch{fail('INVALID_JSON','角色数据不是有效 JSON。')}
  if(!object(parsed)||!['chara_card_v2','chara_card_v3'].includes(parsed.spec))fail('UNSUPPORTED_CARD','仅支持 Character Card V2/V3 JSON 与常见 chara/ccv3 PNG。')
  if(!object(parsed.data))fail('INVALID_CARD','角色卡缺少 data 对象。')
  const data=parsed.data,alternates=data.alternate_greetings??[]
  if(!Array.isArray(alternates)||alternates.some(value=>typeof value!=='string'))fail('INVALID_CARD','alternate_greetings 必须是文本数组。')
  const name=optionalText(data.name,'名称')
  if(!name.trim())fail('INVALID_CARD','角色资产需要名称。')
  const source={id:randomUUID(),format:format??(parsed.spec==='chara_card_v3'?'json-v3':'json-v2'),mimeType,sha256:createHash('sha256').update(bytes).digest('hex'),dataBase64:bytes.toString('base64'),rawText,provenance:structuredClone(parsed)}
  const openings=[{id:'first',name:'默认开场',text:optionalText(data.first_mes,'默认开场')},...alternates.map((text,index)=>({id:`alternate-${index+1}`,name:`开场 ${index+2}`,text}))]
  const creator={}
  for(const[from,to]of[['creator','name'],['creator_notes','notes'],['character_version','version']])if(data[from]!==undefined)creator[to]=optionalText(data[from],from)
  if(data.tags!==undefined){if(!Array.isArray(data.tags)||data.tags.some(value=>typeof value!=='string'))fail('INVALID_CARD','tags 必须是文本数组。');creator.tags=[...data.tags]}
  const character=normalizeCharacter({name,description:optionalText(data.description,'描述'),personality:optionalText(data.personality,'性格'),scenario:optionalText(data.scenario,'情境'),openings,examples:optionalText(data.mes_example,'示例对话'),creator,sourceId:source.id,databaseRefs:[]})
  const diagnostics=[diagnostic('OWNER_REVIEW_REQUIRED','导入结果是待审阅资产；开场和初始事实需由你确认。'),diagnostic('EXAMPLES_NOT_HISTORY','示例对话只用于参考，不是已经发生的故事。')]
  const serialized=JSON.stringify(data)
  if(/"(?:regex_scripts|tavern_helper_scripts|scripts|stscript)"\s*:/u.test(serialized))diagnostics.push(diagnostic('SCRIPTS_INERT','来源脚本和正则仅保存供审阅，不执行。','data.extensions'))
  if(/\{\{[\s\S]*?\}\}/u.test(serialized))diagnostics.push(diagnostic('MACROS_LITERAL','宏按字面保存；不自动展开或执行。'))
  if(data.system_prompt||data.post_history_instructions)diagnostics.push(diagnostic('AUTHOR_INSTRUCTIONS_REVIEW','作者系统/后置指令仅留在原件中，未提升为系统规则。'))
  if(data.extensions&&Object.keys(data.extensions).length)diagnostics.push(diagnostic('EXTENSIONS_INERT','扩展数据留在原件中；不自动取得工具、网络或运行时能力。'))
  if(data.group_only_greetings?.length)diagnostics.push(diagnostic('GROUP_GREETINGS_INERT','群聊专用开场保留在原件中，未自动转成当前故事开场。'))
  const resources=[]
  if(mimeType==='image/png'){const resource={id:randomUUID(),mimeType,sha256:source.sha256,dataBase64:source.dataBase64};resources.push(resource);character.avatarResourceId=resource.id}
  const sourcePath=object(data.character_book)?'data.character_book':object(parsed.character_book)?'character_book':null
  const book=sourcePath==='data.character_book'?data.character_book:parsed.character_book
  const embeddedWorldbooks=sourcePath?[{id:sourcePath,sourceId:source.id,sourcePath,name:typeof book.name==='string'&&book.name.trim()?book.name:`${name}的世界书`,rawText}]:[]
  return{character,source,resources,diagnostics,embeddedWorldbooks}
}
