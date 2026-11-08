'use strict';
const fs=require('node:fs');
const path=require('node:path');
const taskOverlay=require('../../stockflow-extension/task-overlay.js');
const logoUrl='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../../stockflow-extension/icons/icon-48.png')).toString('base64');
const { spawn } = require('node:child_process');

// Runs in the page. Only return product fields; never persist account/trade/session data.
const captureProduct = require('../../stockflow-extension/batch-capture.js');

function runEgo(script, timeoutMs=90_000) {
  return new Promise((resolve,reject) => {
    const child = spawn('ego-browser',['nodejs'],{shell:false,stdio:['pipe','pipe','pipe']});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('浏览器响应超时，已暂停；请检查页面后继续。')); }, timeoutMs);
    child.stdout.on('data',chunk => { stdout += chunk; if(stdout.length > 12_000_000) child.kill(); });
    // ego-browser emits console output on stderr in the installed CLI version.
    child.stderr.on('data',chunk => { stderr += chunk; if(stderr.length > 12_000_000) child.kill(); });
    child.stdin.on('error',() => {});
    child.on('error',error => { clearTimeout(timer); reject(new Error(`无法启动 ego lite：${error.code || '请检查安装'}`)); });
    child.on('close',code => {
      clearTimeout(timer);
      const line = (stdout+'\n'+stderr).split('\n').find(x => x.startsWith('STOCKFLOW_RESULT:'));
      if (code !== 0 || !line) {
        const stopped = /EGO_.*(?:CONTROL|INACTIVE|UNASSIGNED)|hand.?off|user.*control/i.test(stdout + stderr);
        reject(Object.assign(new Error(stopped ? '浏览器已交给你操作，准备好后点击继续采集。' : '浏览器操作未完成，请检查 ego lite 后继续采集。'),{needsControl:stopped}));
        return;
      }
      try { resolve(JSON.parse(line.slice('STOCKFLOW_RESULT:'.length))); } catch { reject(new Error('未能读取采集结果，请重试。')); }
    });
    child.stdin.end(script);
  });
}

class EgoCollector {
  constructor() { this.name = 'StockFlow 多链接商品采集'; this.spaceId = null; this.workbenchLabel = null; }
  taskScript() { return `const task=await taskSpace(${JSON.stringify(this.spaceId ?? this.name)});`; }
  async begin() {
    const result=await runEgo(`${this.taskScript()}console.log('STOCKFLOW_RESULT:'+JSON.stringify({spaceId:task.spaceId}));`);
    this.spaceId=result.spaceId;
  }
  async open(url) {
    const result = await runEgo(`${this.taskScript()}
      const tabs=await task.tabs();
      const existing=tabs.find(t=>t.label && t.url===${JSON.stringify(url)});
      const p=existing ? task.page(existing.label) : await task.newPage();
      await p.goto(${JSON.stringify(url)});
      console.log('STOCKFLOW_RESULT:'+JSON.stringify({spaceId:task.spaceId,label:p.label}));`);
    this.spaceId = result.spaceId; this.workbenchLabel = result.label;
  }
  async resume() {
    if (this.spaceId == null) return;
    // Only called by an explicit user action to continue after a handoff.
    await runEgo(`const task=await takeOverTaskSpace(${JSON.stringify(this.spaceId)});
      console.log('STOCKFLOW_RESULT:'+JSON.stringify({spaceId:task.spaceId}));`);
  }
  async collect(url,progress={index:1,total:1}) {
    const result = await runEgo(`${this.taskScript()}
      const page=task.page('p1');
      const requested=${JSON.stringify(url)};
      const id=new URL(requested).searchParams.get('id');
      await page.goto(requested,{timeout:30000});
      let blocked=false,payload=null,stopRequested=false;
      await page.evaluate(()=>{globalThis.__stockFlowStopRequested=false;});
      const overlay=${taskOverlay.toString()};
      try { await page.evaluate(overlay,${JSON.stringify({...progress,logoUrl,stopMode:'page'})}); } catch { /* Visual feedback must not block collection. */ }
      try {
      const gated=()=>page.evaluate(()=> /login\\.taobao|login\\.tmall|passport\\./.test(location.host) || !!document.querySelector('input[name="fm-login-id"],#nc_1_n1z'));
      blocked=await gated();
      if(!blocked){
        try { await page.waitForFunction(expected=>String(window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res?.item?.itemId)===expected,id,{timeout:15000}); }
        catch { blocked=await gated(); }
      }
      if(!blocked){
        // Detail images may be lazy-loaded. Only scroll to the observed detail section.
        await page.evaluate(()=>{const n=document.querySelector('.descV8-container,.descV6-pc-container,.descV6-mobile-container') || [...document.querySelectorAll('p')].find(n=>n.textContent==='图文详情');n?.scrollIntoView({block:'start'});});
        try { await page.waitForFunction(()=>document.querySelectorAll('.descV8-container img,.descV6-pc-container img,.descV6-mobile-container img').length>0,undefined,{timeout:10000}); } catch {}
        payload=await page.evaluate(${captureProduct.toString()});
      }
      } finally {
        try {stopRequested=await page.evaluate(()=>globalThis.__stockFlowStopRequested===true);} catch {}
        try {await page.evaluate(overlay,null);} catch {}
      }
      if(blocked) await task.handOff();
      const mismatch=payload && String(payload.res.item.itemId)!==id;
      console.log('STOCKFLOW_RESULT:'+JSON.stringify({spaceId:task.spaceId,blocked,stopRequested,payload:mismatch?null:payload}));`);
    this.spaceId = result.spaceId;
    if (result.blocked) return {blocked:true,spaceId:this.spaceId,message:'请在 ego lite 完成登录或验证，然后点击继续采集。'};
    if (!result.payload) throw Object.assign(new Error('页面未提供该商品资料，可能已下架或尚未加载。'),{itemFailure:true,stopRequested:result.stopRequested});
    return {...result.payload,stopRequested:result.stopRequested};
  }
  async finish() {
    if (this.spaceId == null) return;
    await runEgo(`${this.taskScript()}await task.finish({keep:${JSON.stringify(this.workbenchLabel ? [this.workbenchLabel] : [])}});
      console.log('STOCKFLOW_RESULT:{}');`);
    this.spaceId=null; this.workbenchLabel=null; this.name=`StockFlow 商品采集 ${Date.now()}`;
  }
}
module.exports = {EgoCollector,captureProduct,runEgo};
