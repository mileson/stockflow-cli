#!/usr/bin/env node
'use strict';
const {parse,COMMANDS,OPTIONS}=require('./contract.cjs');const {run}=require('./runner.cjs');const {version}=require('../package.json');
async function main(){
  try{
    const {command,options,target}=parse(process.argv.slice(2));let result;
    if(command==='help')result={exitCode:0,data:{name:'stockflow',version,commands:target?{[target]:COMMANDS[target]}:COMMANDS,options:OPTIONS,exitCodes:{0:'success',2:'invalid_input',3:'paused_or_user_action_required',4:'partial_or_export_validation',5:'runtime_error',130:'interrupted'},examples:["stockflow collect --links-file links.txt --output products.csv --price-mode percent --price-value 250","stockflow collect --url 'https://item.taobao.com/item.htm?id=1089477839197' --output products.csv --price-mode fixed --price-value=-20","stockflow export --job-id JOB_ID --output repriced.csv --price-mode percent --price-value 1000"]}};
    else if(command==='version')result={exitCode:0,data:{version,node:process.version}};
    else result=await run(command,options);
    process.stdout.write(JSON.stringify({schemaVersion:1,ok:result.exitCode===0,...result.data})+'\n');process.exitCode=result.exitCode;
  }catch(e){process.stderr.write(JSON.stringify({schemaVersion:1,ok:false,error:{code:e.code||'RUNTIME_ERROR',message:e.message,hint:e.hint||'运行 stockflow --help 查看用法。'}})+'\n');process.exitCode=e.exitCode||5;}
}
main();
