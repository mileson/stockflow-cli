(function(root) {
'use strict';
const {parseLinks,normalizeProduct,prepareExport} = (typeof module !== 'undefined' && module.exports ? require('./batch-model.js') : root.StockFlowBatchModel);

class CollectionQueue {
  constructor({collector,save=()=>{},initial=null}) {
    this.collector=collector; this.save=save; this.running=false; this.resuming=false; this.stopRequested=false;
    this.state=initial || {status:'idle',items:[],message:''};
    if(this.state.browserSpaceId!=null) this.collector.spaceId=this.state.browserSpaceId;
    if(this.state.browserName) this.collector.name=this.state.browserName;
    if (['running','stopping'].includes(this.state.status)) {
      this.state.status='paused'; this.state.message='上次采集已中断，点击继续采集。';
      this.state.items.forEach(item=>{if(item.status==='running') item.status='pending';});
    }
  }
  commit() { this.save(this.state); }
  start(text) {
    if(this.running || this.resuming) throw new Error('已有采集正在进行，请等待或停止当前批次。');
    const urls=parseLinks(text);
    if(this.state.handedOff) throw new Error('请先完成浏览器操作并继续当前批次，再开始新一批。');
    this.state={status:'running',items:urls.map(url=>({url,status:'pending'})),message:''};
    this.stopRequested=false; this.commit(); this.done=this.run();
  }
  stop() {
    if(!this.running) return;
    this.stopRequested=true;this.state.status='stopping';this.state.message='完成当前商品后停止，已采集结果会保留。';this.commit();
  }
  async resume({retry=false}={}) {
    if(this.running || this.resuming) throw new Error('采集正在进行。');
    if(!this.state.items.length) throw new Error('请先输入商品链接。');
    this.resuming=true;
    try {if(this.state.handedOff) await this.collector.resume();}
    finally {this.resuming=false;}
    if(retry) this.state.items.forEach(x=>{if(x.status==='failed') x.status='pending';});
    this.state.handedOff=false;this.stopRequested=false;this.done=this.run();
  }
  async run() {
    this.running=true;this.state.status='running';this.state.message='正在逐条采集，请保留 ego lite 窗口。';this.commit();
    try {
      for(const item of this.state.items) {
        if(this.stopRequested) break;
        if(item.status!=='pending') continue;
        item.status='running';delete item.error;this.commit();
        try {
          const result=await this.collector.collect(item.url,{index:this.state.items.indexOf(item)+1,total:this.state.items.length});
          if(result.stopRequested) this.stopRequested=true;
          this.state.browserSpaceId=this.collector.spaceId;
          this.state.browserName=this.collector.name;
          if(result.blocked) {
            item.status='pending';this.state.status='paused';this.state.handedOff=true;this.state.message=result.message;break;
          }
          item.product=normalizeProduct(result.res,result.detailImages);
          item.status='success';
        } catch(error) {
          if(error.stopRequested) this.stopRequested=true;
          if(error.itemFailure) {item.status='failed';item.error=error.message;}
          else {
            item.status='pending';this.state.status='paused';this.state.message=error.message;
            this.state.handedOff=error.needsControl===true;
            this.state.browserSpaceId=this.collector.spaceId;
            this.state.browserName=this.collector.name;
            break;
          }
        }
        this.commit();
      }
      if(this.state.status!=='paused') {
        this.state.status=this.stopRequested?'stopped':'completed';
        this.state.message=this.stopRequested?'已停止，可继续采集或导出已完成商品。':'本批采集结束，可导出已完成商品。';
      }
    } finally {this.running=false;this.commit();}
  }
  export(priceRule) {
    const products=this.state.items.filter(x=>x.status==='success').map(x=>x.product);
    if(!products.length) throw new Error('还没有可导出的商品。');
    return prepareExport(products,priceRule);
  }
  csv() { return this.export().text; }
  summary() {
    return {...this.state,items:this.state.items.map(({product,...item})=>({...item,product:product && {
      id:product.id,title:product.title,mainCount:product.mainCount,detailCount:product.detailCount,
      skuCount:product.rows.length,examplePrice:product.rows[0]?.['价格'],
      unknownStockCount:product.rows.filter(row=>row['库存']==null || String(row['库存']).trim()==='').length,
      warnings:(product.warnings || []).map(note=>note==='部分库存未提供精确数量，已留空' ? '部分库存未提供精确数量，导出时按 0 处理，上货前请核对' : note),
    }}))};
  }
}
root.StockFlowCollectionQueue=CollectionQueue;
if(typeof module !== 'undefined' && module.exports) module.exports={CollectionQueue};
})(globalThis);
