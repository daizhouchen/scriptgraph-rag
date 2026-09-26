# ScriptGraph

> 剧本改稿工作台：查回原文，留下任务，在下一稿逐项复核。

[打开本机工作台](https://daizhouchen.github.io/scriptgraph-rag/) · [按步骤体验](docs/product.md#完成一轮可验收的改稿) · [架构说明](docs/architecture.md) · [技术实验室](https://daizhouchen.github.io/scriptgraph-rag/#lab)

ScriptGraph 帮助编剧和剧本统筹处理一个具体问题：读到跨场疑点后，怎样把依据和修改方案留下来，并在下一稿核对它是否已经处理。导入自己的 Fountain / TXT，确认分场、人物与道具，用原文字词和实体关联找材料，再建立带版本引用的改稿任务。

工作台在浏览器内处理文本并用 IndexedDB 保存项目。无需注册、API Key、Python 或 Neo4j。它不接实时大模型，不从用户文本自动推断人物关系、道具归属或剧情矛盾；原有 GraphRAG 引擎和固定评测保留在独立的 [`#lab` 技术实验室](#lab)。

## 先完成一轮改稿

没有准备好的剧本，可以点击「用完整示例走一遍」。原创教学短片《末班放映》包含 8 场初稿、2 项预设人工审阅任务和一份可导入的修订稿；这些任务不是自动检测结果。

1. 在「剧本与关系」读第 5、6 场，查看黄铜钥匙的原文与已确认索引。
2. 到「查证原文」搜索 `黄铜钥匙`，比较「只查原文」与「原文 + 关系扩展」。打开出处，区分直接命中与沿实体补充的场次。
3. 勾选相关结果，创建自己的改稿任务，写下疑点、处理方案和验收条件；或打开示例中已有的交接任务。
4. 点击「导入／编辑新版」，载入示例修订稿，先预览分场与变化，再确认导入。旧稿和旧任务引用仍可打开。
5. 在「版本与复查」查看变化，进入任务复核，补充当前稿本的原文依据，再保存处理结论。仅修改备注或导入新稿不会完成这一轮复核。
6. 等待「已保存到此浏览器」，刷新检查项目仍在。导出 JSON 备份，再从项目库恢复为独立副本，核对版本、任务与历史引用。

自己的剧本也走同一条路径，详见 [导入与验收说明](docs/product.md)。

## 原文、关系与判断各自负责什么

| 工作环节 | 当前实现 | 需要使用者确认的部分 |
|---|---|---|
| 导入 | 浏览器读取 UTF-8 Fountain / TXT 或粘贴文本；预览场次、行号和格式候选 | 修正分场，取消误识别人物，补充道具与别名 |
| 查证 | 字词匹配；同场满足多个关键词；沿已确认实体的实际提及扩展场次 | 关联场次是否与问题有关，原文是否支持判断 |
| 改稿任务 | 标题、修改方案、处理状态和一处或多处版本引用 | 疑点是否成立、怎样修改、什么算完成 |
| 版本对照 | 保留每一稿；对照内容、唯一场头和相对顺序；列出无法唯一对应的场次 | 重复场头、改名等不确定对应，以及改动的创作意义 |
| 复核与保存 | 当前稿本复核记录、IndexedDB 保存、项目 JSON 备份与校验恢复 | 补上新版依据后确认结果，定期导出备份 |

每条引用绑定「版本 ID + 场次 ID + 行号 + 原文摘录」。新版插场或调序不会把旧任务悄悄改指向同序号的新场次。关系图只表达人物／道具名称在场次中的提及；共同出现不等于人物有关系，提及道具不等于持有。

当前页面搜索使用字词匹配与实体—场次图，不使用语义向量、LLM 问答或自动连续性检查。没有直接命中的查询不会凭图关系补出答案。

## 本机运行

使用 Node.js 22，在仓库根目录执行：

```bash
cd web
npm ci
npm run dev
```

打开 `http://localhost:5173/`。默认入口就是本机工作台。剧本文本不会被提交给应用 API；项目保存在当前站点、当前浏览器的 IndexedDB，不能自动跨设备同步。清理站点数据或更换浏览器不会带走项目，请使用「备份项目」下载 JSON。

保存失败时，页面会显示未保存状态并提供重试与备份；不要把仍在页面内的修改当作已经落盘。恢复备份先校验原文、分场和引用，再创建独立项目，不覆盖已有项目。

## 开发检查

在 `web/` 中执行：

```bash
npm test
npm run build
```

浏览器领域测试覆盖分场与候选确认、真实图扩展、不可漂移的引用、版本对照、任务复核和备份完整性。它们验证工程规则，不是创作质量或用户效率评测。实现分层和数据约束见 [架构说明](docs/architecture.md)。

<a id="lab"></a>

## 技术实验室：保留 GraphRAG 研究路径

[打开技术实验室](https://daizhouchen.github.io/scriptgraph-rag/#lab)。原 Python 引擎、FastAPI、Neo4j 适配和评测集继续保留，服务于固定合成语料的检索机制对比；它们不在后台分析本机工作台导入的剧本。

| 入口 | 运行内容 |
|---|---|
| 公开 `#lab` | 两部固定原创语料；样例问题读取 Python 引擎预计算快照，自由输入只做浏览器关键词查找 |
| 本地 `#lab` + FastAPI | 使用本地配置的语料和检索后端，比较 BM25、字符向量、混合检索与图扩展 |
| Python 评测 | 4 个原创合成剧本、120 场、180 条固定问答、48 处可控冲突；与本机工作台项目分开 |

技术实验室的连续性候选与改稿关联路径需要人工复核。公开实验室中的临时标记不写入 IndexedDB 项目，也不替代评测集作者的正式审核。

<details>
<summary>固定合成集结果：provisional，尚待作者逐条复核</summary>

以下是仓库 [baseline.json](reports/baseline.json) 的固定合成集结果，`review_status` 为 `pending_user_review`。这些指标属于原 Python 实验路径，不代表用户导入文本的检索质量、自动冲突检测能力或真实剧组效率。

| 方法 | 单场 Recall@5 | 多跳 Recall@5 | 时序 Recall@5 | Citation P@1 | 无答案拒答率 |
|---|---:|---:|---:|---:|---:|
| BM25 | 1.000 | 0.883 | 1.000 | 0.980 | 1.000 |
| 字符向量 | 0.683 | 0.792 | 0.000 | 0.466 | 1.000 |
| 混合检索 | 1.000 | 0.858 | 1.000 | 0.980 | 1.000 |
| 混合检索 + 图扩展 | 1.000 | 1.000 | 1.000 | 0.953 | 1.000 |

当前合成集的 48 个注入冲突检测 F1 为 1.000，仍属 provisional。向量基线使用确定性中文字符 n-gram；可选 sentence-transformers / FAISS 与 Neo4j 适配不等于公开站运行了这些服务。数据口径见 [数据卡](DATA_CARD.md)。

</details>

### 启动本地技术实验室

```bash
docker compose up --build
```

打开 `http://localhost:8000/#lab`。该路径由容器内 FastAPI 托管构建产物；同一个服务提供 `/api/projects`、`/api/query`、`/api/consistency/check` 和 `/api/impact`。Docker Compose 还启动 Neo4j，实际后端以服务配置为准。

不使用 Docker 时，在仓库根目录启动 Python 服务：

```bash
uv sync --extra dev
uv run uvicorn scriptgraph.api:app --reload
```

另一个终端按上文启动 `web/`，访问 `http://localhost:5173/#lab`。未设置 `VITE_STATIC_DEMO=true` 时，仅实验室视图通过开发代理访问本地 API；新工作台仍在浏览器内运行。要在本地查看公开快照版本，可在启动或构建前将该环境变量设为 `true`。GitHub Pages 构建已设置它。

### 复现与数据复核

在仓库根目录执行：

```bash
uv run pytest -q
uv run ruff check .
uv run python -m scriptgraph.eval --data data --output reports/baseline.json
python scripts/review_dataset.py --kind questions --reviewer YOUR_NAME
python scripts/review_dataset.py --kind conflicts --reviewer YOUR_NAME
```

修改实验室语料或检索逻辑后，用 `uv run python scripts/export_demo.py` 从同一份原文、解析器和引擎重新导出快照，再在 `web/` 测试、构建。不要另写一套样例答案或引用。语料生成与许可见 [data/README.md](data/README.md)；关键样本正式审核完成前，指标持续标为 provisional。

## English summary

ScriptGraph is a browser-local screenplay revision workbench: import and confirm scenes and entities, retrieve literal text and entity-linked scenes, create source-bound revision tasks, compare drafts, and explicitly review tasks against the current version. Projects persist in IndexedDB and can be backed up to validated JSON. Imported text is not sent to an application API or analyzed by a live LLM. The original Python / FastAPI / Neo4j GraphRAG experiments remain at `#lab`; their fixed synthetic-corpus evaluation is provisional.

## License

Code is licensed under Apache-2.0. Generated sample screenplays and evaluation data are released under CC BY 4.0.
