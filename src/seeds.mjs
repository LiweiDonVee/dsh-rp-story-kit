import {copy,fail,object} from './assets.mjs'

function fields(value,required,optional,label){
  if(!object(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail('INVALID_SEED',`${label} 字段必须符合 schemaVersion 1。`)
}

/** Shared SK3/R8 kernel check for templates and the later owner-reviewed launch seam. */
export function validateStorySeed({initialScene,initialFacts}){
  fields(initialScene,['schemaVersion','title','location','presentActorIds'],['time'],'初始场景')
  if(initialScene.schemaVersion!==1||typeof initialScene.title!=='string'||typeof initialScene.location!=='string'||!Array.isArray(initialScene.presentActorIds)||initialScene.presentActorIds.some(id=>typeof id!=='string')||Object.hasOwn(initialScene,'time')&&typeof initialScene.time!=='string')fail('INVALID_SEED','初始场景的版本或字段类型无效。')
  fields(initialFacts,['schemaVersion','items'],[],'初始事实')
  if(initialFacts.schemaVersion!==1||!Array.isArray(initialFacts.items))fail('INVALID_SEED','初始事实需要 schemaVersion 1 的 items 数组。')
  const ids=new Set()
  for(const item of initialFacts.items){
    fields(item,['id','text'],[],'初始事实条目')
    if(typeof item.id!=='string'||typeof item.text!=='string'||ids.has(item.id))fail('INVALID_SEED','初始事实条目的 ID/文本类型无效，或 ID 重复。')
    ids.add(item.id)
  }
  return copy({initialScene,initialFacts})
}
