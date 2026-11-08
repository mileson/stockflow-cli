# StockFlow CLI

供 AI、终端和脚本调用的淘宝/天猫商品采集与 CSV 导出工具。Node.js 20+，无运行时第三方依赖；浏览器操作复用已安装的 ego-browser / ego lite，不需要本地 Web 服务或 Native Host。

## 安装与发现

公开仓库：[mileson/stockflow-cli](https://github.com/mileson/stockflow-cli)。安装或更新当前版本：

```sh
npm install --global "https://github.com/mileson/stockflow-cli/releases/download/v0.1.1/stockflow-cli-0.1.1.tgz"
```

本地源码也可执行 `npm install -g .`。

```sh
stockflow --version
stockflow --help
stockflow schema collect
stockflow doctor
```

CLI 与插件共用采集、37 列 CSV、规格映射和调价算法。CLI 任务保存在 `~/.stockflow/jobs`，与插件面板的当前批次独立；CLI 不读取或覆盖面板的价格设置，不保存登录凭证。默认使用 ego lite 当前浏览器会话，不自动切换账号。`doctor` 只核验浏览器连接，商品登录在实际采集时检查。

## 一次采集并导出

`links.txt` 每行一个完整商品链接，最多 100 行；去除空行并合并重复链接。支持 `item.taobao.com/item.htm?id=数字` 和 `detail.tmall.com/item.htm?id=数字`，不支持短链。

```sh
stockflow collect --links-file links.txt --job-id products-001 \
  --output products.csv --price-mode percent --price-value 250
```

也可重复传入 `--url`，或使用 stdin：

```sh
printf '%s\n' \
  'https://item.taobao.com/item.htm?id=1089477839197' \
  'https://item.taobao.com/item.htm?id=557037371871' \
  | stockflow collect --links-file - --output products.csv \
      --price-mode fixed --price-value=-20
```

`--url` 与 `--links-file` 互斥。所有业务参数均为命名参数，未知参数和重复标量会被拒绝。`--data-dir /absolute/path` 可指定独立任务目录。相对输入输出路径基于调用目录；输出目录须已存在。文件存在时默认拒绝，明确传 `--overwrite` 才覆盖普通文件。

`--dry-run` 在打开浏览器、创建任务之前检查输入、调价规则和输出路径，不写入文件；不会验证页面可访问性、价格或登录。多个 CLI 写入同一任务目录时通过锁串行执行。

## 调价和库存

| 参数 | 含义 |
| --- | --- |
| 不传价格参数，或 `--price-mode original` | 保持采集原价和原优惠价 |
| `--price-mode fixed --price-value 20` | 每个规格原价加 20 元 |
| `--price-mode fixed --price-value=-20` | 每个规格原价减 20 元 |
| `--price-mode percent --price-value 250` | 原价乘 2.5；不是加价 250% |
| `--price-mode percent --price-value 1000` | 原价乘 10，比例上限 |

比例必须大于 0%，最多 1000%；金额及比例最多两位小数。计算始终基于原始采集价格，按分四舍五入，不累计调价。启用调价时“价格”和“最高促销价”同步调整；调整后不大于 0 元会拒绝导出。缺失价格不会猜填。

默认 `--unknown-stock zero`：未知库存按 0 导出，JSON 的 `artifact.zeroStockCount` 和 `artifact.warnings` 明确提醒上货前核对。`--unknown-stock error` 会阻止含未知库存的导出。原始采集记录保持未知值，不伪造库存。商品类目等其他未取得字段保持空值。

## 查询、恢复与重试

```sh
stockflow jobs list --limit 20
stockflow jobs get --job-id products-001
stockflow jobs resume --job-id products-001 --overwrite
stockflow jobs retry --job-id products-001 --overwrite
```

命令在前台顺序采集，逐条保存结果，终止后可恢复。重复 `collect --job-id` 拒绝覆盖原任务；AI 遇到超时应先 `jobs get`，不能盲目生成新任务。`jobs resume` 继续待采集项；`jobs retry` 同时重试失败项，都跳过已有成功项。

登录或页面验证会暂停，保留浏览器交给用户，返回 `needsUser:true`、`browserSpaceId`。用户明确完成操作后，才能调用：

```sh
stockflow jobs resume --job-id products-001 --user-ready --overwrite
```

`--user-ready` 表示用户已确认可以接回浏览器，不代表自动同意网站协议。普通网页错误也可能返回暂停，应根据 `message` 检查浏览器。正常完成后自动关闭本任务采集页面；中断或登录阻塞时保留以便继续。不会关闭用户原有窗口。Ctrl-C 完成当前有界采集后停止，退出 130；强制杀进程后下次调用会恢复未完成项。

部分失败时仍导出成功商品，退出非零，并返回逐项状态；AI 必须检查 `ok`、退出码和 `counts`，不可把部分文件当作全部成功。所有成功项都缺失或导出校验不通过时，不生成空 CSV。

## 只改价格，再次导出

```sh
stockflow export --job-id products-001 --output products-1000.csv \
  --price-mode percent --price-value 1000
stockflow export --job-id products-001 --output products-minus20.csv \
  --price-mode fixed --price-value=-20
```

无需浏览器、无需重新采集。`export` 与恢复命令省略价格参数时沿用任务最近保存的设置。可以加 `--dry-run` 验证原始数据和导出规则。文件生成成功后返回绝对 `artifact.path`、本地 `artifact.url`、字节数、行数、调价规则及库存警告。此 URL 是本机文件链接，不是公网下载链接；CLI 不自动上传文件。

## AI 输出合同

成功和部分结果：stdout 仅一个 JSON；一般失败：stderr 仅一个 JSON；无进度文字污染输出。所有回执含 `schemaVersion:1` 和 `ok`。错误包含稳定的 `error.code`、可读 `message` 与 `hint`。批量暂停或部分失败输出仍在 stdout，保留 `jobId` 供恢复。

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 2 | 参数或输入不正确 |
| 3 | 暂停，需检查浏览器或用户登录 |
| 4 | 部分失败、库存/价格等导出校验失败或收尾未完成 |
| 5 | 环境、任务锁、文件或运行错误 |
| 130 | 用户中断 |

AI 推荐流程：`schema collect` → `doctor` → `collect --dry-run` → `collect` → 检查回执 → 向用户交付 `artifact.path`。需要调整价格时使用 `export`。本工具只采集与生成文件，不执行妙手导入、上货或公开发布。

CLI 采集与面板共用 task-overlay.js 的品牌图标、渐变边缘和点阵波纹，显示当前商品序号 / 总数。浮层“停止”会在当前商品结束后停止队列并导出已有结果；剩余链接可通过 jobs resume 继续。正常结束、停止和失败均清理浮层；登录验证时先移除浮层再交给用户。CLI 包内携带图标，不依赖浏览器安装插件。

## 从早期版本升级

若安装时提示 stockflow 命令已存在，先核对 `npm ls -g --depth=0` 和命令路径；确认属于早期的 `stockflow-workspace` 包后，执行 `npm uninstall --global stockflow-workspace`，再运行上方安装命令。采集记录仍保留在 `~/.stockflow`。不要用 `--force` 覆盖其他软件的命令。
