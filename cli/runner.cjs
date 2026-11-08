'use strict';
const fs=require('node:fs');const {randomUUID}=require('node:crypto');const {pathToFileURL}=require('node:url');
const {CliError}=require('./contract.cjs');const {Store,jobId,outputPath,writeOutput}=require('./store.cjs');
const {parseLinks,validatePriceRule,prepareExport}=require('../stockflow-extension/batch-model.js');
const {CollectionQueue}=require('../tools/batch-collector/queue.cjs');const {EgoCollector,runEgo}=require('../tools/batch-collector/browser.cjs');
function pricing(o,fallback={mode:'original'}){
  if(o['price-value']!==undefined&&o['price-mode']===undefined)throw new CliError('INVALID_ARGUMENT','--price-value 需要同时指定 --price-mode');
  if(o['price-mode']==='original'&&o['price-value']!==undefined)throw new CliError('INVALID_ARGUMENT','保持原价时不接受 --price-value');
  try{return validatePriceRule(o['price-mode']?{mode:o['price-mode'],value:o['price-value']}:fallback);}catch(e){throw new CliError('INVALID_PRICE_RULE',e.message);}
}
async function inputLinks(o){
  if(!!o.url===!!o['links-file'])throw new CliError('INVALID_ARGUMENT','请指定 --url 或 --links-file，且只选一种');
  let text;
  if(o.url)text=o.url.join('\n');else if(o['links-file']==='-'){
    if(process.stdin.isTTY)throw new CliError('INPUT_REQUIRED','请通过管道提供逐行链接');
    const chunks=[];let size=0;for await(const part of process.stdin){size+=part.length;if(size>100000)throw new CliError('INPUT_TOO_LARGE','链接输入超过限制');chunks.push(part);}text=Buffer.concat(chunks).toString('utf8');
  }else{const file=o['links-file'];if(fs.statSync(file).size>100000)throw new CliError('INPUT_TOO_LARGE','链接输入超过限制');text=fs.readFileSync(file,'utf8');}
  try{return parseLinks(text.replace(/^\uFEFF/,''));}catch(e){throw new CliError('INVALID_LINKS',e.message);}
}
function summary(job){
  const state=job.state||{status:'created',items:[]};const counts={success:0,failed:0,pending:0};
  const items=state.items.map(x=>{counts[x.status==='running'?'pending':x.status]++;return {url:x.url,status:x.status,...(x.error?{error:x.error}:{}),...(x.product?{productId:x.product.id,title:x.product.title,skuCount:x.product.rows.length,warnings:x.product.warnings}:{} )};});
  return {jobId:job.id,status:state.status,counts,items,priceRule:job.priceRule,unknownStock:job.unknownStock,output:job.output,artifact:job.artifact||null,message:state.message||'',browserSpaceId:job.browserSpaceId??null,needsUser:state.handedOff===true};
}
function exportJob(job,o){
  const products=job.state.items.filter(x=>x.status==='success').map(x=>x.product);
  let result;try{result=prepareExport(products,job.priceRule);}catch(e){throw new CliError('EXPORT_VALIDATION',e.message,4);}
  if(result.zeroStockCount && job.unknownStock==='error')throw new CliError('UNKNOWN_STOCK',`有 ${result.zeroStockCount} 个规格库存未知；核对后可使用 --unknown-stock zero 按 0 导出`,4);
  if(o['dry-run'])return {rowCount:products.reduce((n,p)=>n+p.rows.length,0),zeroStockCount:result.zeroStockCount};
  writeOutput(job.output,result.text,o.overwrite);
  return {path:job.output,url:pathToFileURL(job.output).href,bytes:Buffer.byteLength(result.text),rowCount:products.reduce((n,p)=>n+p.rows.length,0),zeroStockCount:result.zeroStockCount,priceRule:job.priceRule,warnings:result.zeroStockCount?[`${result.zeroStockCount} 个规格的未知库存按 0 导出，上货前请核对。`]:[]};
}
async function run(command,o,{collectorFactory=()=>new EgoCollector()}={}){
  const store=new Store(o['data-dir']);
  if(command==='doctor'){
    let connected=false;try{await runEgo("console.log('STOCKFLOW_RESULT:'+JSON.stringify({spaces:(await listTaskSpaces()).length}));",10_000);connected=true;}catch{}
    return {exitCode:connected?0:5,data:{ready:connected,node:process.version,browser:'ego-lite',connected,loginVerified:false,dataDir:store.dir,hint:connected?'采集时核验商品登录；无需启动本地服务或安装 Native Host。':'请确认 ego-browser 已安装且 ego lite 正在运行。'}};
  }
  if(command==='jobs list'){
    const limit=o.limit===undefined?20:Number(o.limit);if(!Number.isInteger(limit)||limit<1||limit>100)throw new CliError('INVALID_ARGUMENT','--limit 必须为 1 到 100 的整数');
    const r=store.list(limit);return {exitCode:0,data:{jobs:r.jobs.map(summary),hasMore:r.hasMore}};
  }
  if(command==='jobs get')return {exitCode:0,data:summary(store.get(o['job-id']))};
  let job,initialSnapshot;
  if(command==='collect'){
    const links=await inputLinks(o);const id=jobId(o['job-id']||randomUUID());
    if(store.exists(id))throw new CliError('JOB_EXISTS','任务 ID 已存在，请用 jobs get 查询或 jobs resume 继续');
    job={id,createdAt:new Date().toISOString(),priceRule:pricing(o),unknownStock:o['unknown-stock']||'zero',output:outputPath(o.output,o),state:{status:'created',items:links.map(url=>({url,status:'pending'}))},browserName:`StockFlow CLI ${id}`};
  }else{
    job=store.get(o['job-id']);initialSnapshot=JSON.stringify(job);job.priceRule=pricing(o,job.priceRule);job.unknownStock=o['unknown-stock']||job.unknownStock;
    job.output=outputPath(o.output||job.output,o);
    if(job.state.handedOff && command!=='export'&&!o['user-ready'])throw new CliError('USER_ACTION_REQUIRED','浏览器已交给用户；用户完成登录或验证后，用 --user-ready 继续',3);
  }
  if(o['dry-run'])return {exitCode:0,data:{dryRun:true,...summary(job),...(command==='export'?{preview:exportJob(job,o)}:{})}};
  const unlock=store.lock();let interrupted=false;
  try{
    if(initialSnapshot && JSON.stringify(store.get(job.id))!==initialSnapshot)throw new CliError('JOB_CHANGED','任务刚被其他调用更新，请查询后重试',5);
    if(command==='export'){job.artifact=exportJob(job,o);store.save(job);return {exitCode:job.state.items.some(x=>x.status!=='success')?4:0,data:summary(job)};}
    if(command==='collect'&&store.exists(job.id))throw new CliError('JOB_EXISTS','任务 ID 已存在');
    const collector=collectorFactory();collector.name=job.browserName;collector.spaceId=job.browserSpaceId??null;
    const save=state=>{job.state=state;job.browserSpaceId=collector.spaceId;job.browserName=collector.name;store.save(job);};
    const queue=new CollectionQueue({collector,initial:job.state,save});
    const interrupt=()=>{interrupted=true;queue.stop();};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
    try{
      save(queue.state);
      // Assign and persist the browser before navigating, so an interrupted call can resume it.
      if(!collector.spaceId && queue.state.items.some(x=>x.status==='pending'||(command==='jobs retry'&&x.status==='failed'))){await collector.begin();save(queue.state);}
      if(interrupted){queue.state.status='stopped';save(queue.state);}
      else {await queue.resume({retry:command==='jobs retry'});await queue.done;}
      if(['completed','stopped'].includes(queue.state.status)){
        try{await collector.finish();delete job.cleanupWarning;job.browserSpaceId=null;queue.state.browserSpaceId=null;queue.state.browserName=collector.name;save(queue.state);}catch(e){job.cleanupWarning=e.message;store.save(job);}
      }
    }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
    const data=summary(job);
    if(job.state.items.some(x=>x.status==='success')){
      try{job.artifact=exportJob(job,o);data.artifact=job.artifact;}catch(e){data.exportError={code:e.code||'OUTPUT_FAILED',message:e.message};}
      store.save(job);
    }
    if(job.cleanupWarning)data.cleanupWarning=job.cleanupWarning;
    const exitCode=interrupted?130:job.state.status==='paused'?3:job.state.status==='completed'&&job.state.items.every(x=>x.status==='success')&&!data.exportError&&!job.cleanupWarning?0:4;
    return {exitCode,data};
  }catch(e){e.hint=e.hint||`使用 jobs get --job-id ${job.id} 查看已保存状态；不要直接重建同名任务。`;throw e;}
  finally{unlock();}
}
module.exports={run,summary,pricing,inputLinks};
