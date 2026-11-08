'use strict';
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {randomUUID}=require('node:crypto');
const {CliError}=require('./contract.cjs');
function jobId(id){if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id||''))throw new CliError('INVALID_ARGUMENT','任务 ID 格式无效');return id;}
class Store {
  constructor(dir){this.dir=path.resolve(dir||path.join(os.homedir(),'.stockflow'));}
  file(id){return path.join(this.dir,'jobs',jobId(id)+'.json');}
  get(id){try{return JSON.parse(fs.readFileSync(this.file(id),'utf8'));}catch(e){throw new CliError(e.code==='ENOENT'?'JOB_NOT_FOUND':'STATE_UNREADABLE',e.code==='ENOENT'?'找不到此任务':'任务记录无法读取，请保留文件排查',5);}}
  exists(id){return fs.existsSync(this.file(id));}
  save(job){const file=this.file(job.id);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify({...job,updatedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
  list(limit){const dir=path.join(this.dir,'jobs');if(!fs.existsSync(dir))return {jobs:[],hasMore:false};const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json'));const sorted=files.map(x=>({id:x.slice(0,-5),time:fs.statSync(path.join(dir,x)).mtimeMs})).sort((a,b)=>b.time-a.time);return {jobs:sorted.slice(0,limit).map(x=>this.get(x.id)),hasMore:sorted.length>limit};}
  lock(){
    fs.mkdirSync(this.dir,{recursive:true,mode:0o700});const file=path.join(this.dir,'active.lock');
    for(let attempt=0;attempt<2;attempt++){
      try{const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);return ()=>fs.unlinkSync(file);}
      catch(error){if(error.code!=='EEXIST')throw error;let pid;try{pid=JSON.parse(fs.readFileSync(file,'utf8')).pid;}catch{throw new CliError('BUSY','任务锁无法读取，请先核对正在运行的 stockflow 进程',5);}
        try{process.kill(pid,0);throw new CliError('BUSY','已有采集或导出正在运行，请稍后查询任务',5);}catch(e){if(e.code!=='ESRCH')throw e;fs.unlinkSync(file);}
      }
    }
    throw new CliError('BUSY','无法取得任务锁',5);
  }
}
function outputPath(value,{overwrite=false}={}){
  const file=path.resolve(value);if(fs.existsSync(file)&&(!overwrite||!fs.lstatSync(file).isFile()))throw new CliError('OUTPUT_EXISTS','输出路径已存在；指定新路径，或使用 --overwrite 覆盖普通文件',2);
  if(!fs.existsSync(path.dirname(file)))throw new CliError('OUTPUT_DIRECTORY_MISSING','输出目录不存在，请先创建目录',2);
  return file;
}
function writeOutput(file,text,overwrite){
  const temp=file+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,text,{encoding:'utf8',mode:0o600,flag:'wx'});if(overwrite)fs.renameSync(temp,file);else{fs.linkSync(temp,file);fs.unlinkSync(temp);}}
  catch(e){throw new CliError(e.code==='EEXIST'?'OUTPUT_EXISTS':'OUTPUT_FAILED',e.code==='EEXIST'?'输出文件已存在，未覆盖':'无法写入输出文件，采集结果已保存',5);}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
module.exports={Store,jobId,outputPath,writeOutput};
