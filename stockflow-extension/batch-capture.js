(function(root) {
function captureProduct() {
  const raw = window.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res;
  if (!raw?.item) return null;
  const sku2info = {};
  for (const [id, value] of Object.entries(raw.skuCore?.sku2info || {})) {
    sku2info[id] = {quantity:value.quantity, moreQuantity:value.moreQuantity, price:value.price, subPrice:value.subPrice};
  }
  const item = raw.item;
  const res = {
    item: {itemId:item.itemId,title:item.title,images:item.images,videos:(item.videos || []).map(x => ({url:x.url}))},
    skuBase: raw.skuBase,
    skuCore: {sku2info},
    plusViewVO: {industryParamVO:raw.plusViewVO?.industryParamVO},
    componentsVO: {
      deliveryVO:{deliveryFromAddr:raw.componentsVO?.deliveryVO?.deliveryFromAddr},
      extensionInfoVO:{infos:(raw.componentsVO?.extensionInfoVO?.infos || []).filter(x => x.type === 'BASE_PROPS')},
    },
  };
  const detailImages = [...document.querySelectorAll('.descV8-container img,.descV6-pc-container img,.descV6-mobile-container img')]
    .map(img => img.getAttribute('data-src') || img.getAttribute('data-ks-lazyload') || img.getAttribute('src'));
  return {res,detailImages};
}

root.StockFlowCaptureProduct=captureProduct;
if(typeof module !== 'undefined' && module.exports) module.exports=captureProduct;
})(globalThis);
