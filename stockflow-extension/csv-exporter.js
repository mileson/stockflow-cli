// 文件说明书 (File Manual)
// ## 核心功能 (Core Function)
// 把 ProductDraft 转成与群内妙手样例一致的 37 列 UTF-8 BOM CSV；新两阶段批次仅导出本轮已确认、已选择的上架图与白底图。
//
// ## 输入 (Input)
// - 已采集并人工复核的商品草稿、SKU、套图角色与详情 HTML。
//
// ## 输出 (Output)
// - 37 列 CSV 文本；首行商品、后续行承载同商品 SKU。
//
// ## 定位 (Position)
// 扩展导出契约层，不负责上传妙手或京东。
//
// ## 依赖 (Dependency)
// - StockFlowCore 商品领域模型。
//
// ## 维护规则 (Maintenance Rules)
// 1. 每次修改代码逻辑后，必须检查并更新上述的【核心功能】、【输入】、【输出】等信息，确保文档与代码一致。
// 2. 禁止修改或删除本【维护规则】章节的内容。
// 3. 修改完成后，必须同步更新 stockflow-workspace_stockflow-extension_README.md 中关于本文件的描述。

(function initCsvExporter(root) {
  const HEADERS = Object.freeze([
    "序号", "商品id", "标题", "商品类目", "自定义分类", "sku名称", "颜色属性图链接", "价格", "库存", "货号", "商品编码", "最高促销价", "上架时间", "下架时间", "生产许可证", "3C证书编号", "发货地", "主图1链接", "主图2链接", "主图3链接", "主图4链接", "主图5链接", "主图6链接", "主图7链接", "主图8链接", "主图9链接", "主图10链接", "长图链接", "电脑详情文字", "手机详情文字", "3:4主图1链接", "3:4主图2链接", "3:4主图3链接", "3:4主图4链接", "3:4主图5链接", "主图视频", "商品属性",
  ]);

  function escapeCsv(value) {
    const text = value == null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function attributeString(attributes) {
    return Object.entries(attributes || {})
      .filter(([, value]) => value !== "" && value != null)
      .map(([key, value]) => `${key}:${String(value).replace(/;/g, "；")}`)
      .join(";");
  }

  function pickAssets(draft, role, { allowedIds = null, approvedOnly = false } = {}) {
    return (draft.assets || [])
      .filter((asset) => asset.selected && (approvedOnly ? asset.reviewStatus === "approved" : asset.reviewStatus !== "rejected")
        && asset.role === role && (!allowedIds || allowedIds.has(asset.id)))
      .map((asset) => asset.previewUrl || asset.sourceUrl)
      .filter(Boolean);
  }

  function pickListingAssets(draft) {
    const batch = [...(draft.washBatches || [])].sort((left, right) => right.number - left.number)[0];
    if (draft.washMode !== "pattern" && batch?.stage === 2) {
      const allowedIds = new Set(batch.resultAssetIds || []);
      return ["main", "scene", "selling-point", "white"].flatMap((role) => pickAssets(draft, role, { allowedIds, approvedOnly: true }));
    }
    const roles = root.StockFlowCore?.LISTING_IMAGE_ROLES || ["main"];
    return roles.flatMap((role) => pickAssets(draft, role));
  }

  function buildRows(draftInput) {
    const draft = root.StockFlowCore?.createProductDraft
      ? root.StockFlowCore.createProductDraft(draftInput)
      : draftInput;
    const main = pickListingAssets(draft).slice(0, 10);
    const currentBatch = [...(draft.washBatches || [])].sort((left, right) => right.number - left.number)[0];
    const detailOptions = draft.washMode !== "pattern" && currentBatch?.stage === 2 ? { allowedIds: new Set(currentBatch.resultAssetIds || []), approvedOnly: true } : {};
    const detail = [pickAssets(draft, "detail", detailOptions), pickAssets(draft, "scene", detailOptions), pickAssets(draft, "selling-point", detailOptions)].flat();
    const detailHtml = draft.descriptionHtml || detail.map((url) => `<img src="${url}" />`).join("");
    const base = {
      "序号": 1,
      "商品id": draft.productId,
      "标题": draft.title,
      "商品类目": draft.category,
      "自定义分类": draft.customCategory || "未分类",
      "价格": draft.price,
      "库存": draft.stock,
      "最高促销价": draft.price,
      "发货地": draft.origin,
      "电脑详情文字": detailHtml,
      "手机详情文字": detailHtml,
      "商品属性": attributeString(draft.attributes),
    };
    main.forEach((url, index) => {
      base[`主图${index + 1}链接`] = url;
    });
    const skus = draft.skus?.length ? draft.skus : [{ name: "", price: draft.price, stock: draft.stock, imageUrl: "" }];
    return skus.map((sku, index) => {
      const row = index === 0 ? { ...base } : {};
      row["sku名称"] = sku.name || "";
      row["颜色属性图链接"] = sku.imageUrl || "";
      row["价格"] = sku.price || (index === 0 ? draft.price : "");
      row["库存"] = sku.stock || (index === 0 ? draft.stock : "");
      row["最高促销价"] = row["价格"];
      return row;
    });
  }

  function buildCsv(draft) {
    const rows = buildRows(draft);
    const lines = [HEADERS.join(",")];
    for (const row of rows) lines.push(HEADERS.map((header) => escapeCsv(row[header])).join(","));
    return `\uFEFF${lines.join("\r\n")}`;
  }

  const api = { HEADERS, escapeCsv, buildRows, buildCsv };
  root.StockFlowCsv = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
