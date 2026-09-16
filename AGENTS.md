# AGENTS.md

## 项目概览

「果冻单词」——白色纸感主题的背单词 Web 应用，兼具彩虹色线条与透明果冻效果。

核心能力：
1. 多格式文件上传（图片 jpg/png/jpeg、Word、PDF、PPT、Excel）→ 提取英文单词；上传页支持点击/拖拽/Ctrl+V 粘贴（截图、复制的文件、英文文本自动包装 txt）
2. 识别完成即带释义返回（LLM 批量直译：12 词/批 + 16 路并发池，100 词约 3 秒）；`/api/translate` 仅作背诵页兜底补译
3. 单词卡"照抄键入"背诵：英文单词大字展示 + 逐字母果冻格子键入，正确拼写 3 遍 = 已背诵 1 遍（可累加），拼错则本轮清零重抄
4. 背诵队列：新加入的单词排最上方，未背完的优先于已背完；重复导入的单词不跳过——重置本轮进度重新背诵（历史累计遍数保留）；背诵页可星标单词
5. 文件即用即焚：上传文件存对象存储（key 前缀 `tmp-words/`），识别成功返回词列表后立即删除 S3 对象并标记 upload_files 为 deleted
6. 背诵记录：紧凑统计条 + 星标词星系（球状连线缓慢旋转、悬浮放大、点击展示词源/词根/释义/音乐剧台词，LLM 生成并 localStorage 缓存）+ 一周趋势图 + 气泡排行榜（hover 互动、点击当场拼写、拼错重拼，纯前端不写库）+ 今日记录 + 按日期分组历史

## 技术栈

- Next.js 16 App Router + React 19 + TypeScript 5（前端为主，全部客户端交互）
- Tailwind CSS v4（`@theme` 定义设计变量，见 `src/app/globals.css`）
- Supabase（Drizzle schema 定义在 `src/storage/database/shared/schema.ts`，客户端 `src/storage/database/supabase-client.ts`）
- `coze-coding-dev-sdk`（仅后端）：LLMClient（图片多模态 OCR / 文本选词 / 释义批量直译 / 词源与剧目台词生成）、FetchClient（解析 PDF/Office 文档）、S3Storage（临时文件）

## 构建与运行

- 开发：`coze dev`（HMR 自动生效，端口读取 `DEPLOY_RUN_PORT`）
- 生产：`coze build` && `coze start`
- 数据库模型同步：`coze-coding-ai db generate-models`（改 schema.ts 后）→ `coze-coding-ai db upgrade`（执行迁移）。注意：该工具固定连接平台库，**用户自有 Supabase 的结构变更需在 Supabase Dashboard SQL Editor 手动执行 DDL**（详见注意事项）；`generate-models` 会从数据库反向重写 schema.ts，自定义字段改动后不要重复执行它，直接跑 `db upgrade`
- 类型检查：`pnpm ts-check`；静态检查：`pnpm lint`

## 目录结构

```
src/
├── app/
│   ├── page.tsx                  # 上传识别页（/；支持点击/拖拽/Ctrl+V 粘贴截图或英文文本，粘贴文本自动包装为 txt 走识别链路）
│   ├── practice/page.tsx         # 背诵练习页（/practice，照抄键入核心交互；加载后自动补译未背完且缺释义的词，当前词支持一键翻译约 1 秒返回）
│   ├── records/page.tsx          # 背诵记录页（/records）
│   ├── layout.tsx                # 全局布局 + 顶部导航
│   ├── globals.css               # @theme 设计变量（原型迁移源）+ 果冻动画 keyframes
│   └── api/
│       ├── upload/route.ts       # POST 上传文件 → S3 临时存储 + upload_files 表
│       ├── recognize/route.ts    # POST 识别单词（图片→LLM 多模态 OCR；文档→FetchClient 解析→LLM 选词）
│       ├── translate/route.ts    # POST 批量 LLM 直译补齐缺失释义（小批 12 词 + 16 路并发池，100 词约 3 秒；默认异步回写 words 表只补空释义）
│       ├── words/route.ts        # GET 单词列表 / POST 批量加入背诵（新词插入；重复导入重置本轮进度重新背诵）
│       ├── words/[id]/route.ts   # PATCH 编辑释义 / 星标 starred / DELETE 删除单词
│       ├── practice/today/route.ts # GET 今日队列（未背完在前、组内新词置顶 id 降序）+ 进度 + 最近导入批次统计
│       ├── practice/type/route.ts  # POST 拼写校验（错误清零重抄并写错误流水；正确+1，满 3 遍完成一轮背诵）
│       ├── records/route.ts      # GET 统计 + 星标词列表 + 一周趋势 + 今日记录 + 历史分组 + 三个排行榜（含释义供气泡拼写提示）
│       ├── word-detail/route.ts  # POST LLM 生成单词详情（词源/词根/台词出处/角色/台词中文翻译），记录页星系弹窗用
│       └── cleanup/route.ts      # POST 删除批次临时文件（兜底接口，识别即焚后通常无需调用）
├── components/site-header.tsx    # 顶部导航（当前页高亮）
├── lib/word-app.ts               # SDK 客户端单例 + 识别/释义/JSON 解析等共享函数
└── storage/database/             # Supabase 数据层（schema + client）
```

## 数据模型（3 张表）

- `words`：word（小写唯一）、pos、translation、translation_source（upload/search）、source_file、batch_id、correct_round（当前轮 0-3）、recite_count（已背诵轮数）、target_recite（本轮需完成遍数，重复导入时提升为 recite_count+1）、import_count（导入次数）、total_typed（累计正确拼写数）、status（pending/practicing/done）、starred（星标，记录页组成星系）、recited_at（最后完成一轮的时间，用于"今日记录"）
- `upload_files`：filename、file_key（S3 key）、file_type（image/pdf/word/ppt/excel/text）、batch_id、status（active/deleted）、deleted_at
- `practice_records`：word_id（cascade）、word、round_index（本轮第几遍 1-3，**0 表示拼错流水**，用于"犯错最多"排行）、session_no（第几次背诵轮）、created_at；round_index=3 的记录代表完成一轮背诵（历史分组、连续天数与一周趋势以此为准）

## 代码风格

- 全部标点使用半角（字符串内中文除外）；组件/函数参数必须显式类型标注
- 前端页面统一 `'use client'`；接口路由返回 `NextResponse.json`
- 设计变量一律用 `@theme` 语义类名（bg-surface/80、text-on-surface-variant、jelly-* 等），禁止硬编码色值（彩虹渐变 linear-gradient 内联色值除外，与原型保持一致）
- 图标统一 lucide-react，禁止 emoji 当图标
- 修改 schema.ts 后必须 `coze-coding-ai db generate-models && coze-coding-ai db upgrade`（注意该工具只连平台库，用户自有 Supabase 见下条）

## 注意事项

- 用户自有 Supabase 与平台库 schema 双轨：`coze-coding-ai db` 系列命令固定连平台 dev 库；用户库的结构变更必须提供 SQL 由用户在 Supabase Dashboard SQL Editor 执行。words 表新增列 `target_recite`/`import_count` 时，代码通过 `src/lib/word-app.ts` 的 `probeWordsNewColumns` 运行时探测（进程内缓存），列缺失自动降级为旧行为（重复导入跳过、无导入次数排行），执行过 DDL 后无需重启即自动启用新逻辑（重新部署进程即重新探测）
- `starred` 列同理走 `probeWordsStarred` 探测降级：列缺失时 records 接口不返回星标词、today 接口不带 starred 字段、背诵页隐藏星标入口（`starredReady` 状态）、PATCH 星标报错由前端乐观更新回滚兜底；列缺失的库需执行 `ALTER TABLE words ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false;`
- 数据库已于 2026-09 迁移至 Supabase 官网项目（ref `oalgwdejwsjjklwdymhk`，凭证在 `.env.local`，含 starred/target_recite/import_count 列）；旧火山引擎实例仅为历史存档，平台注入的 COZE_SUPABASE_* 指向平台库，均被 `.env.local` 强制覆盖
- 上传文件即用即焚：`/api/recognize` 成功返回词列表前删除 S3 对象（`getStorage().deleteFile({ fileKey })`）并标记 upload_files status=deleted；删除失败仅告警不阻塞识别
- S3 临时文件 key 统一 `tmp-words/{batchId}/{filename}`；`/api/cleanup` 仅作历史批次兜底
- LLM 输出 JSON 需容错解析（`src/lib/word-app.ts` 的 `parseWordsJson`）
- 释义格式：1-2 个中文释义以 `;` 分隔（如 `努力; 尝试`）
- 图片识别用 `doubao-seed-2-0-lite-260215`（多模态），释义批量直译用 `doubao-seed-2-0-mini-260215`（低成本，每批 40 词单次调用；识别完成即带释义返回，translate 仅兜底个别缺词）
- 数据库凭证加载优先级：进程/平台注入 < `.env`（部署打包会向其追加平台变量，同名键后者覆盖前者） < `.env.local`（强制覆盖，最高优先）。用户自有 Supabase 凭证唯一权威来源是 `.env.local`，严禁把凭证写回 `.env`
