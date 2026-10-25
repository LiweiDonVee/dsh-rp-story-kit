import React from 'react'
import {StoryKitWorkspace} from './StoryKitWorkspace.jsx'
import css from './styles.css'

export const inject=['slots','sidebarRight','sidebarRightTabs','uiWorkspace']
export const TAB_ID='dsh-rp-story-kit/workspace'
export const TAB_KIND='rp-story-kit'
function Entry({open}){return <button type="button" className="rpsk-native-entry" aria-label="打开 Story Kit" title="角色与玩家资产" onClick={open}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 4h6c1 0 2 1 2 2 0-1 1-2 2-2h6v15h-6c-1 0-2 1-2 2 0-1-1-2-2-2H4zM12 6v15"/></svg><span>资产</span></button>}
export function apply(ctx){
  ctx.effect(()=>{const style=document.createElement('style');style.dataset.rpStoryKit='';style.textContent=css;document.head.append(style);return()=>style.remove()},'Story Kit styles')
  function Body({sessionId,useTabInfo}){const{tab}=useTabInfo();return <StoryKitWorkspace key={sessionId} sessionId={sessionId} visible={tab.visible} navigate={id=>ctx.uiWorkspace.openSession(id)}/>}
  ctx.effect(()=>ctx.sidebarRightTabs.register({id:TAB_ID,kind:TAB_KIND,title:()=> 'Story Kit',guide:[{id:TAB_KIND,order:39,title:()=> 'Story Kit',description:()=> '角色、玩家身份与可复用开场'}]}),'Story Kit tab')
  ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:TAB_ID},Body)),'Story Kit pane')
  for(const name of ['conversation.session.header.actions','conversation.hero.options','rp.studio.workspace.actions'])ctx.effect(()=>ctx.slots.inject(name,()=>ctx.slots.register({name,id:TAB_ID,order:39,inject:()=>({open:()=>ctx.sidebarRight.openTab(TAB_KIND)})},Entry)),`Story Kit entry ${name}`)
}
