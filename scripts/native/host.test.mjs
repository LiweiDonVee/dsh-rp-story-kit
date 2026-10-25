import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {quoteCli,newRun,createHome,validateInputs} from './host.mjs'

test('native harness rejects ambiguous Windows CLI arguments',()=>{
  assert.equal(quoteCli('C:/Program Files/dsh.cmd'),'"C:/Program Files/dsh.cmd"')
  for(const input of ['bad"arg','bad\narg','%PATH%'])assert.throws(()=>quoteCli(input),/CLI_ARGUMENT/u)
})
test('native harness inputs identify exact reviewed packages without credentials or a guessed GM',()=>{
  const input={hostVersion:'0.2.1-rc.3',packages:[{name:'dsh-rp-story-kit',version:'0.1.0',sha256:'a'.repeat(64),path:'C:/synthetic.tgz'}]}
  assert.equal(validateInputs(input),input)
  for(const invalid of [{...input,hostVersion:'0.2.1-rc.2'},{...input,packages:[...input.packages,...input.packages]},{...input,packages:[{...input.packages[0],sha256:'latest'}]}])assert.throws(()=>validateInputs(invalid),/INPUT/u)
})
test('native harness exclusively creates fresh homes within its own new evidence run',async t=>{
  const root=await mkdtemp(join(tmpdir(),'story-kit-native-guard-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const run=await newRun(root),home=join(run,'home-a');await createHome(run,home)
  await assert.rejects(createHome(run,home),/HOME_ALREADY_EXISTS/u)
  await assert.rejects(createHome(run,join(root,'foreign')),/OUTSIDE_RUN/u)
  await mkdir(join(root,'old-home'));await writeFile(join(root,'old-home','sessions'),'synthetic existing bytes')
  await assert.rejects(createHome(run,join(root,'old-home')),/OUTSIDE_RUN/u)
})
