import assert from 'node:assert/strict'
import {parseArgs} from 'node:util'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from '@playwright/test'
import {newRun,stageInputs,install,startHost,redact} from './host.mjs'
import {ready,sourceAssets,destinationAssets,ownerClient} from './assets.mjs'

const{values}=parseArgs({options:{manifest:{type:'string'},cli:{type:'string'},browser:{type:'string'},help:{type:'boolean'}}})
if(values.help){console.log('node scripts/native/run.mjs --manifest <reviewed-assets-inputs.json> [--cli <dsh.cmd>] [--browser <chromium>]\nRuns actual assets/content owners in exclusive homes. Launch/SavedStory require a separate final GM dispatch.');process.exit(0)}
if(!values.manifest)throw Error('EXPLICIT_REVIEWED_INPUTS_REQUIRED')
const workspace=fileURLToPath(new URL('../../',import.meta.url)).replace(/[\\/]$/u,''),run=await newRun(workspace),input=JSON.parse(await readFile(resolve(values.manifest),'utf8')),packages=await stageInputs(input,run)
if(packages.some(item=>item.name==='dsh-rp-gm'))throw Error('ASSET_CHECKPOINT_MUST_NOT_USE_UNACCEPTED_OR_OLD_GM')
for(const name of ['dsh-rp-story-kit','dsh-rp-database','dsh-rp-last-step','dsh-rp-context','dsh-loop-studio','dsh-rp-studio'])if(!packages.some(item=>item.name===name))throw Error(`REQUIRED_ASSET_INPUT_MISSING:${name}`)
const cli=values.cli??join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'),probePath=join(run,'probe.mjs'),patch=join(run,'fixture.patch.yml'),report={schemaVersion:1,run,phase:'native-assets-content-checkpoint',hostVersion:input.hostVersion,status:'incomplete',fullSavedStory:'not-run; final accepted GM required',browserErrors:[],cleanupErrors:[]}
await writeFile(join(run,'package.json'),'{"name":"story-kit-native-fixture","private":true,"type":"module"}\n',{flag:'wx'})
await writeFile(probePath,await readFile(new URL('./probe.mjs',import.meta.url)),{flag:'wx'})
await writeFile(patch,`- id: session-title-llm\n  disabled: true\n- id: llm-deepseek\n  disabled: true\n- id: llm-deepseek-account\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: story-kit-native-local\n    model: local\n- id: tools\n  config:\n    mode: native\n- insert:\n    - id: story-kit-native-probe\n      name: ${JSON.stringify(probePath.replaceAll('\\','/'))}\n`,{flag:'wx'})
let host,browser
async function cleanup(){const active=host,outcomes=await Promise.allSettled([Promise.resolve().then(()=>browser?.close()),Promise.resolve().then(()=>host?.close())]);for(const[index,result]of outcomes.entries())if(result.status==='rejected')report.cleanupErrors.push({resource:index===0?'browser':'host',message:redact(result.reason.message)});if(active){const record=report.processes.find(item=>item.pid===active.child.pid);record.stopped=active.child.exitCode!==null||active.child.signalCode!==null}browser=null;host=null}
async function open(home,env,label){
  host=await startHost({cli,workspace,env:{...env,DSH_HOME:home},patch,logPath:join(run,`${label}-host.log`)})
  ;(report.processes??=[]).push({phase:label,pid:host.child.pid,home})
  browser=await chromium.launch({headless:true,executablePath:values.browser??process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH??join(process.env.LOCALAPPDATA,'ms-playwright/chromium-1217/chrome-win64/chrome.exe')})
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000)
  page.on('pageerror',error=>report.browserErrors.push({phase:label,type:'pageerror',message:redact(error.message)}));page.on('console',message=>{if(['error','warning'].includes(message.type()))report.browserErrors.push({phase:label,type:message.type(),message:redact(message.text())})})
  await ready(page,host.url);return page
}
try{
  const homeA=join(run,'home-a'),installedA=await install({cli,run,home:homeA,packages,workspace});report.installedA=installedA.installed
  console.log('[native] source PNG/worldbook/library/content scenario')
  const pageA=await open(homeA,installedA.env,'source'),pack=await sourceAssets({page:pageA,run,workspace,report});await cleanup()
  const homeB=join(run,'home-b'),installedB=await install({cli,run,home:homeB,packages,workspace});report.installedB=installedB.installed
  console.log('[native] independent destination content import')
  const pageB=await open(homeB,installedB.env,'destination'),ids=await destinationAssets({page:pageB,pack,run,report});await cleanup()
  console.log('[native] cold process restart of destination libraries')
  const coldPage=await open(homeB,installedB.env,'cold'),call=ownerClient(coldPage),asset=await call('/api/rp-story-kit/request',{action:'asset',kind:'character',assetId:ids.characterId,version:1}),profile=await call('/api/rp-last-step/request',{action:'profile',profileId:ids.profileId,version:1}),document=await call('/api/rp-database/request',{action:'document',documentId:ids.documentId,version:1}),counters=await call('/api/story-kit-native-probe',{action:'counters'})
  assert.equal(asset.status,200);assert.equal(profile.value.profile.status,'draft');assert.equal(document.status,200);assert.equal(document.value.document.sha256,ids.documentSha256);const coldSource=await call('/api/rp-story-kit/request',{action:'source',sourceId:asset.value.asset.sourceId});assert.equal(coldSource.value.source.sha256,ids.sourceSha256);assert.equal(counters.value.result.modelCalls,0);report.cold={characterPresent:true,profileDraft:true,documentPresent:true,sourceAndDocumentHashesEqual:true,modelCalls:0}
  assert.deepEqual(report.browserErrors,[]);report.status='passed-assets-content-only'
}catch(error){report.error={message:redact(error.message),stack:redact(error.stack)};throw error}
finally{await cleanup();await writeFile(join(run,'integration.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({run,status:report.status,error:report.error?.message,cleanupErrors:report.cleanupErrors}))}
