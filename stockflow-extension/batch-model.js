(function(root) {
'use strict';
// Shared export contract; this collector has its own mapping because it reads full SKU data.
const { HEADERS } = typeof module !== 'undefined' && module.exports ? require('./csv-exporter.js') : root.StockFlowCsv;

function parseLinks(text) {
  if (typeof text !== 'string') throw new Error('请分行输入商品链接。');
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error('请至少输入一个商品链接。');
  if (lines.length > 100) throw new Error('每批最多采集 100 个链接。');
  return [...new Set(lines.map((line, index) => {
    let u;
    try { u = new URL(line); } catch { throw new Error(`第 ${index + 1} 行不是完整链接。`); }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port ||
        !['item.taobao.com', 'detail.tmall.com'].includes(u.hostname) ||
        u.pathname !== '/item.htm' || !/^\d+$/.test(u.searchParams.get('id') || '')) {
      throw new Error(`第 ${index + 1} 行请使用淘宝或天猫商品详情链接（item.htm?id=商品编号）。`);
    }
    return `https://${u.hostname}/item.htm?id=${u.searchParams.get('id')}`;
  }))];
}

function mediaUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const u = new URL(value.startsWith('//') ? `https:${value}` : value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}
const uniqueMedia = list => [...new Set((list || []).map(mediaUrl).filter(Boolean))];
const htmlEscape = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function priceText(price) {
  const value = price?.priceText;
  return value != null && /^\d+(?:\.\d+)?$/.test(String(value)) ? String(value) : '';
}
function stockValue(info) {
  if (info?.moreQuantity === true || info?.moreQuantity === 'true') return '';
  const value = info?.quantity;
  return value != null && /^\d+$/.test(String(value)) ? Number(value) : '';
}
function attributesOf(res) {
  const attributes = {};
  const params = res.plusViewVO?.industryParamVO || {};
  for (const p of [...(params.basicParamList || []), ...(params.enhanceParamList || [])]) {
    if (p.propertyName) attributes[p.propertyName] = String(p.valueName ?? '');
  }
  for (const group of res.componentsVO?.extensionInfoVO?.infos || []) {
    if (group.type !== 'BASE_PROPS') continue;
    for (const p of group.items || []) if (p.title) attributes[p.title] = (p.text || []).join(',');
  }
  return attributes;
}
function skuRows(res) {
  const values = new Map();
  for (const prop of res.skuBase?.props || []) {
    for (const value of prop.values || []) values.set(`${prop.pid}:${value.vid}`, {
      name: `${prop.name}:${value.name}`, image: mediaUrl(value.image),
    });
  }
  const skus = res.skuBase?.skus?.length ? res.skuBase.skus : [{skuId:'0',propPath:''}];
  return skus.map(sku => {
    const parts = (sku.propPath || '').split(';').filter(Boolean).map(key => values.get(key));
    if (parts.some(p => !p)) throw new Error('商品规格不完整，请重新加载后重试。');
    const info = res.skuCore?.sku2info?.[sku.skuId] || {};
    return {
      'sku名称': parts.map(p => p.name).join(';'),
      '颜色属性图链接': parts.find(p => p.image)?.image || '',
      '价格': priceText(info.price),
      '最高促销价': priceText(info.subPrice),
      '库存': stockValue(info),
    };
  });
}
function normalizeProduct(res, detailImages = []) {
  if (!res?.item?.title || !/^\d+$/.test(String(res.item.itemId || ''))) throw new Error('未读取到商品资料，请确认页面已加载。');
  const attributes = attributesOf(res);
  const main = uniqueMedia(res.item.images || res.componentsVO?.headImageVO?.images).slice(0,10);
  const details = uniqueMedia(detailImages).filter(x => !/\/s\.gif(?:\?|$)/.test(x));
  const detailHtml = details.map(url => `<img src="${htmlEscape(url)}" />`).join('');
  const base = {
    '商品id': String(res.item.itemId), '标题': String(res.item.title), '商品类目': '', '自定义分类': '未分类',
    '货号': attributes['货号'] || '', '商品编码': attributes['商品条形码'] || attributes['条形码'] || '',
    '生产许可证': attributes['生产许可证编号'] || '', '3C证书编号': attributes['CCC证书编号'] || attributes['3C证书编号'] || '',
    '发货地': res.componentsVO?.deliveryVO?.deliveryFromAddr || '',
    '电脑详情文字': detailHtml, '手机详情文字': detailHtml,
    '主图视频': mediaUrl(res.item.videos?.[0]?.url),
    '商品属性': Object.entries(attributes).map(([k,v]) => `${k}:${v.replace(/;/g,'；')}`).join(';'),
  };
  main.forEach((url,i) => { base[`主图${i+1}链接`] = url; });
  const rows = skuRows(res).map((row,i) => ({...(i === 0 ? base : {}), ...row}));
  const warnings = ['商品类目、上下架时间及未提供的专用图片字段留空'];
  if (rows.some(row => row['库存'] === '')) warnings.push('部分库存未提供精确数量，导出时按 0 处理，上货前请核对');
  if (rows.some(row => row['价格'] === '')) warnings.push('部分规格价格未取得，已留空');
  if (!details.length) warnings.push('详情图片未加载，请展开图文详情后重试');
  if (!main.length) warnings.push('未取得商品主图');
  return {id:base['商品id'], title:base['标题'], rows, warnings, mainCount:main.length, detailCount:details.length};
}
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
}
// Integer cents avoid binary floating-point errors at half-cent boundaries.
function hundredths(value) {
  const text=String(value);const negative=text.startsWith('-');
  const [whole,fraction='']=text.replace(/^[+-]/,'').split('.');
  return BigInt(whole)*100n*(negative?-1n:1n)+BigInt(fraction.padEnd(2,'0'))*(negative?-1n:1n);
}
function validatePriceRule(rule={mode:'original'}) {
  if (!rule || !['original','fixed','percent'].includes(rule.mode)) throw new Error('请选择有效的调价方式。');
  if (rule.mode==='original') return {mode:'original'};
  const value=String(rule.value ?? '').trim();
  const name=rule.mode==='percent'?'比例':'调整金额';
  if (!/^[+-]?\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw new Error(`${name}请输入数字，最多保留两位小数。`);
  const amount=hundredths(value);
  if (rule.mode==='percent' && (amount<=0n || amount>100000n)) throw new Error('比例必须大于 0%，且不超过 1000%。');
  return {mode:rule.mode,value};
}
function adjustPrice(original,rule) {
  if (rule.mode==='original') return String(original);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(original))) throw new Error('原始价格无效，请重新采集。');
  const cents=hundredths(original),amount=hundredths(rule.value);
  const result=rule.mode==='fixed'?cents+amount:(cents*amount+5000n)/10000n;
  if(result<=0n) throw new Error('调整后的价格必须大于 0 元（保留两位小数），请修改调价设置。');
  return `${result/100n}.${String(result%100n).padStart(2,'0')}`;
}
// Validate persisted results too: old batches may contain the same missing fields.
function prepareExport(products,priceRule) {
  const rule=validatePriceRule(priceRule);
  let zeroStockCount = 0;
  const rows = products.flatMap((p,i) => {
    if (!p.rows?.length) throw new Error(`第 ${i+1} 个商品没有销售规格，请重新采集。`);
    const base = p.rows[0];
    if (!String(base['标题'] || '').trim() || !/^\d+$/.test(String(base['商品id'] || ''))) {
      throw new Error(`第 ${i+1} 个商品缺少标题或商品编号，请重新采集。`);
    }
    return p.rows.map((row,j) => {
      const label = `「${base['标题']}」第 ${j+1} 个规格`;
      if (!/^\d+(?:\.\d+)?$/.test(String(row['价格'] ?? ''))) throw new Error(`${label}缺少有效价格，请重新采集后导出。`);
      let price;
      try { price=adjustPrice(row['价格'],rule); } catch(error) { throw new Error(`${label}：${error.message}`); }
      const stock = row['库存'];
      const missing = stock == null || String(stock).trim() === '';
      if (!missing && !/^\d+$/.test(String(stock))) throw new Error(`${label}库存无效，请核对后导出。`);
      if (missing) zeroStockCount++;
      return {...row, '价格':price, ...(rule.mode==='original'?{}:{'最高促销价':price}), '库存':missing ? 0 : stock, ...(j === 0 ? {'序号':i+1} : {})};
    });
  });
  if (!rows.length) throw new Error('还没有可导出的商品。');
  const text = '\uFEFF' + [HEADERS.join(','), ...rows.map(row => HEADERS.map(h => csvCell(row[h])).join(','))].join('\r\n');
  return {text,zeroStockCount};
}
function buildCsv(products) { return prepareExport(products).text; }
const api = {parseLinks,normalizeProduct,buildCsv,prepareExport,HEADERS,mediaUrl,validatePriceRule,adjustPrice};
root.StockFlowBatchModel=api;
if(typeof module !== 'undefined' && module.exports) module.exports=api;
})(globalThis);
