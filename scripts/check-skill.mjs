import {readFile,access} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve,dirname,relative} from 'node:path'

const directory=fileURLToPath(new URL('../skills/adapting-roleplay-story-assets/',import.meta.url)),file=resolve(directory,'SKILL.md'),raw=await readFile(file,'utf8')
const header=/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(raw)
if(!header)throw new Error('Skill frontmatter is missing')
const name=/^name:\s*(.+)$/mu.exec(header[1])?.[1],description=/^description:\s*(.+)$/mu.exec(header[1])?.[1]
if(name!=='adapting-roleplay-story-assets'||!description||description.length>1024)throw new Error('Skill name/description invalid')
let references=0
for(const match of raw.matchAll(/\]\((references\/[^)]+)\)/gu)){const target=resolve(dirname(file),match[1]);if(relative(directory,target).startsWith('..'))throw new Error('Skill reference escapes its package');await access(target);if(!(await readFile(target,'utf8')).trim())throw new Error('Empty skill reference');references++}
if(references<2)throw new Error('Expected mapping and behavior references')
console.log(JSON.stringify({name,frontmatter:true,references,behaviorEvaluation:'reference-application; no independent model benchmark'}))
