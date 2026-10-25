import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,mkdtemp,readFile,writeFile,realpath,lstat} from 'node:fs/promises'
import {join,resolve,sep,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'

const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const packageNames=new Set(['dsh-rp-database','dsh-rp-last-step','dsh-rp-context','dsh-loop-studio','dsh-rp-story-kit','dsh-rp-studio','dsh-rp-gm'])
export const redact=text=>String(text).replace(/([?&]token=)[^\s"'<>]+/gu,'$1[REDACTED]')
export function quoteCli(input){if(typeof input!=='string'||/["\r\n%]/u.test(input))throw Error('CLI_ARGUMENT_UNSUPPORTED');return`"${input}"`}
export function validateInputs(input){
  if(input?.hostVersion!=='0.2.1-rc.3'||!Array.isArray(input.packages)||!input.packages.length)throw Error('INPUT_INVALID')
  const seen=new Set()
  for(const item of input.packages){if(!packageNames.has(item.name)||seen.has(item.name)||!isAbsolute(item.path)||!/^[a-f0-9]{64}$/u.test(item.sha256)||!/^[0-9a-zA-Z.+-]+$/u.test(item.version))throw Error('INPUT_INVALID');seen.add(item.name)}
  return input
}
export async function newRun(workspace){
  const root=await realpath(workspace),runtime=join(root,'.runtime')
  try{await mkdir(runtime)}catch(error){if(error.code!=='EEXIST')throw error}
  if((await lstat(runtime)).isSymbolicLink()||await realpath(runtime)!==runtime)throw Error('RUNTIME_OUTSIDE_WORKSPACE')
  return mkdtemp(join(runtime,'story-kit-native-'))
}
export async function createHome(run,home){
  const parent=await realpath(run),target=resolve(home)
  if(!target.startsWith(parent+sep)||resolve(target,'..')!==parent)throw Error('HOME_OUTSIDE_RUN')
  try{await mkdir(target)}catch(error){if(error.code==='EEXIST')throw Error('HOME_ALREADY_EXISTS');throw error}
  await writeFile(join(target,'package.json'),'{"name":"story-kit-native-home","private":true,"type":"module"}\n',{flag:'wx'})
  return target
}
async function stop(child){
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return
  if(process.platform==='win32')await execute('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{})
  else child.kill('SIGTERM')
  if(child.exitCode===null&&child.signalCode===null)await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('OWNED_PROCESS_STOP_TIMEOUT')),5000);child.once('exit',()=>{clearTimeout(timer);done()})})
}
export async function cliCommand(cli,args,env,cwd){
  return new Promise((done,reject)=>{
    const child=spawn(quoteCli(cli),args.map(quoteCli),{env,cwd,shell:process.platform==='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});let output=''
    const timer=setTimeout(()=>{void stop(child).then(()=>reject(Error('CLI_TIMEOUT')),reject)},60000)
    for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output=(output+bytes).slice(-200000)})
    child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);if(code===0)done(output.trim());else reject(Error(`CLI_FAILED:${code}:${redact(output.slice(-3000))}`))})
  })
}
async function archiveFile(archive,entry){const{stdout}=await execute('tar',['-xOf',archive,`package/${entry}`],{windowsHide:true,encoding:'buffer',maxBuffer:16*1024*1024});return stdout}
function entryPath(value){const entry=value?.replace(/^\.\//u,'');if(!entry||!/^[-a-zA-Z0-9_./]+$/u.test(entry)||entry.startsWith('/')||entry.split('/').some(part=>part==='..'||part==='.'))throw Error('PACKAGE_ENTRY_INVALID');return entry}
export async function stageInputs(input,run){
  validateInputs(input);const directory=join(run,'inputs');await mkdir(directory)
  const packages=[]
  for(const item of input.packages){
    const bytes=await readFile(item.path);if(hash(bytes)!==item.sha256)throw Error(`INPUT_HASH_MISMATCH:${item.name}`)
    const archive=join(directory,`${item.name}-${item.version}-${item.sha256}.tgz`);await writeFile(archive,bytes,{flag:'wx'})
    const manifest=JSON.parse((await archiveFile(archive,'package.json')).toString('utf8'));if(manifest.name!==item.name||manifest.version!==item.version)throw Error('PACKAGE_MANIFEST_MISMATCH')
    const entries=[...new Set(['package.json',entryPath(manifest.main),entryPath(manifest.exports['./client']),entryPath(manifest.dsh.bundle.patch),'README.md','LICENSE'])],files={}
    for(const entry of entries)files[entry]=hash(await archiveFile(archive,entry))
    packages.push({...item,archive,files})
  }
  await writeFile(join(run,'staged-inputs.json'),JSON.stringify({hostVersion:input.hostVersion,packages},null,2)+'\n',{flag:'wx'});return packages
}
export async function install({cli,run,home,packages,workspace}){
  await createHome(run,home)
  const env={...process.env,DSH_HOME:home,DSH_TOOLS_MODE:'native',DEEPSEEK_API_KEY:'unused-local-story-kit-native'}
  for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY'])delete env[key]
  const version=await cliCommand(cli,['--version'],env,workspace);if(version!=='0.2.1-rc.3')throw Error(`HOST_VERSION_MISMATCH:${version}`)
  const installed=[]
  for(const item of packages){
    console.log(`[native] install ${item.name}@${item.version}`)
    const output=await cliCommand(cli,['plugin','--profile','web','add',item.archive],env,workspace);await writeFile(join(home,`install-${item.name}.log`),redact(output)+'\n')
    const directory=await realpath(join(home,'profiles/web/node_modules',item.name)),files={}
    if(!directory.startsWith((await realpath(home))+sep))throw Error('INSTALLED_PATH_OUTSIDE_HOME')
    for(const[entry,expected]of Object.entries(item.files)){files[entry]=hash(await readFile(join(directory,entry)));if(files[entry]!==expected)throw Error(`INSTALLED_BYTES_MISMATCH:${item.name}/${entry}`)}
    installed.push({name:item.name,version:item.version,archiveSha256:item.sha256,directory,files})
  }
  return{env,installed,version}
}
export async function startHost({cli,workspace,env,patch,logPath}){
  const child=spawn(quoteCli(cli),['web','--patch',patch,'--host','127.0.0.1','--port','0','--no-open'].map(quoteCli),{cwd:workspace,env,shell:process.platform==='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='',error,closed=false
  child.once('error',value=>{error=value});for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{logs=(logs+bytes).slice(-200000)})
  const close=async()=>{if(closed)return;closed=true;try{await stop(child)}finally{await writeFile(logPath,redact(logs))}}
  try{const deadline=Date.now()+45000;while(Date.now()<deadline){if(error)throw error;const url=/https?:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/u.exec(logs)?.[0];if(url)return{url,child,close};if(child.exitCode!==null)throw Error(`HOST_EXITED:${redact(logs.slice(-3000))}`);await new Promise(done=>setTimeout(done,100))}throw Error(`HOST_TIMEOUT:${redact(logs.slice(-3000))}`)}catch(error){await close();throw error}
}
