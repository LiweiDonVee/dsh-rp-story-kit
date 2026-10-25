import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'

test('native client owns sidebar/header/blank/Studio entry lifecycle and uses host visibility',async()=>{
  let bundled
  await assert.doesNotReject(async()=>{bundled=await build({entryPoints:['src/client.jsx'],bundle:true,write:false,platform:'browser',format:'cjs',jsx:'automatic',loader:{'.css':'text'},external:['react','react/jsx-runtime']})},'native client builds with host React')
  const styles=[],module={exports:{}},require=createRequire(import.meta.url)
  runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,require,document:{head:{append:style=>styles.push(style)},createElement:()=>({dataset:{},remove(){styles.splice(styles.indexOf(this),1)}})}})
  const registered=[],tabs=[],disposers=[],opened=[],ctx={effect:work=>{const cleanup=work();if(typeof cleanup==='function')disposers.push(cleanup)},slots:{inject:(_name,work)=>work(),register:(descriptor,Component)=>{const row={descriptor,Component};registered.push(row);return()=>registered.splice(registered.indexOf(row),1)}},sidebarRightTabs:{register:tab=>{tabs.push(tab);return()=>tabs.splice(tabs.indexOf(tab),1)}},sidebarRight:{openTab:kind=>opened.push(kind)}}
  module.exports.apply(ctx)
  assert.equal(styles.length,1);assert.equal(tabs[0].kind,'rp-story-kit')
  assert.deepEqual(registered.map(row=>row.descriptor.name),['sidebar.right.pane.tab','conversation.session.header.actions','conversation.hero.options','rp.studio.workspace.actions'])
  const entry=registered[1],button=entry.Component(entry.descriptor.inject());button.props.onClick();assert.deepEqual(opened,['rp-story-kit'])
  const body=registered[0].Component({sessionId:'story',useTabInfo:()=>({tab:{visible:false}})});assert.equal(body.props.visible,false);assert.equal(body.key,'story')
  for(const dispose of disposers.reverse())dispose();assert.equal(styles.length,0);assert.equal(registered.length,0);assert.equal(tabs.length,0)
})
