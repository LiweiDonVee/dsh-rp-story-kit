import test from 'node:test'
import assert from 'node:assert/strict'
import {createStoryKitApi} from '../src/api.js'
import {createStoryKitRoutes} from '../src/routes.mjs'
import {StoryKitError} from '../src/assets.mjs'

test('public template client uses the exact owner route, signal and response without a launch effect',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document')
  Object.defineProperty(globalThis,'document',{configurable:true,value:{baseURI:'https://example.test/dsh/'}})
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document})
  const template={id:'saved-template',title:'公开合成模板',character:{assetId:'card',version:2},persona:{assetId:'player',version:1},openingId:'alternate-1',sources:[],profile:null,initialScene:{schemaVersion:1,title:'港口',location:'码头',time:'清晨',presentActorIds:['traveler']},initialFacts:{schemaVersion:1,items:[{id:'tide',text:'已经退潮'}]}}
  const calls=[],owner=createStoryKitRoutes({template:async({templateId})=>{
    if(templateId!==template.id)throw new StoryKitError('TEMPLATE_NOT_FOUND','找不到所选故事模板。',404)
    return{revision:4,template}
  }})
  t.after(()=>owner.close())
  const client=createStoryKitApi(async(url,input)=>{calls.push({url,input});return owner.request(new Request(url,input))})
  const controller=new AbortController(),result=await client.template({templateId:template.id,signal:controller.signal})
  assert.deepEqual(result,{revision:4,template})
  assert.equal(calls[0].url.href,'https://example.test/dsh/api/rp-story-kit/request')
  assert.equal(calls[0].input.method,'POST')
  assert.equal(calls[0].input.signal,controller.signal)
  assert.deepEqual(JSON.parse(calls[0].input.body),{action:'template',templateId:template.id})
  await assert.rejects(client.template({templateId:'missing'}),{code:'TEMPLATE_NOT_FOUND',status:404,message:'找不到所选故事模板。',diagnostics:[]})
  assert.deepEqual(calls.map(({input})=>JSON.parse(input.body).action),['template','template'])
})
