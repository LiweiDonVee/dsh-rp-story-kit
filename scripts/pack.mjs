import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'

const root=fileURLToPath(new URL('../',import.meta.url)),artifacts=join(root,'artifacts'),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
if(!process.env.npm_execpath)throw new Error('Run this pack script through pnpm package')
await mkdir(artifacts,{recursive:true})
await promisify(execFile)(process.execPath,[process.env.npm_execpath,'pack','--pack-destination',artifacts],{cwd:root,windowsHide:true})
const name=`${manifest.name}-${manifest.version}.tgz`,sha256=createHash('sha256').update(await readFile(join(artifacts,name))).digest('hex')
await writeFile(join(artifacts,'SHA256SUMS.txt'),`${sha256}  ${name}\n`,'utf8')
console.log(JSON.stringify({artifact:join(artifacts,name),sha256}))
