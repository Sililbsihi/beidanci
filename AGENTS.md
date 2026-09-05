# AGENTS.md

## 项目概览

「果冻单词」——白色纸感主题的背单词 Web 应用，兼具彩虹色线条与透明果冻效果。

核心能力：
1. 多格式文件上传（图片 jpg/png/jpeg、Word、PDF、PPT、Excel）→ 提取英文单词
2. 无中文释义的单词自动通过 Web 搜索匹配 1-2 个简洁释义（`;` 分隔）
3. 单词卡"照抄键入"背诵：英文单词大字展示 + 逐字母果冻格子键入，正确拼写 3 遍 = 已背诵 1 遍（可累加），拼错则本轮清零重抄
4. 临时文件机制：上传文件存对象存储（key 前缀 `tmp-words/`），本批单词全部完成一轮背诵后自动删除
5. 背诵记录：统计卡（累计单词/次数/连续天数/今日已背）+ 今日记录 + 按日期分组历史

## 技术栈

- Next.js 16 App Router + React 19 + TypeScript 5（前端为主，全部客户端交互）
- Tailwind CSS v4（`@theme` 定义设计变量，见 `src/app/globals.css`）
- Supabase（Drizzle schema 定义在 `src/storage/database/shared/schema.ts`，客户端 `src/storage/database/supabase-client.ts`）
- `coze-coding-dev-sdk`（仅后端）：LLMClient（图片多模态 OCR / 文本选词 / 释义提炼）、FetchClient（解析 PDF/Office 文档）、SearchClient（释义搜索）、S3Storage（临时文件）

## 构建与运行

- 开发：`coze dev`（HMR 自动生效，端口读取 `DEPLOY_RUN_PORT`）
- 生产：`coze build` && `coze start`
- 数据库模型同步：`coze-coding-ai db generate-models`（改 schema.ts 后）→ `coze-coding-ai db upgrade`（执行迁移）
- 类型检查：`pnpm ts-check`；静态检查：`pnpm lint`

## 目录结构

```
src/
├── app/
│   ├── page.tsx                  # 上传识别页（/）
│   ├── practice/page.tsx         # 背诵练习页（/practice，照抄键入核心交互）
│   ├── records/page.tsx          # 背诵记录页（/records）
│   ├── layout.tsx                # 全局布局 + 顶部导航
│   ├── globals.css               # @theme 设计变量（原型迁移源）+ 果冻动画 keyframes
│   └── api/
│       ├── upload/route.ts       # POST 上传文件 → S3 临时存储 + upload_files 表
│       ├── recognize/route.ts    # POST 识别单词（图片→LLM 多模态 OCR；文档→FetchClient 解析→LLM 选词）
│       ├── translate/route.ts    # POST 批量搜索中文释义（webSearch→LLM 提炼 1-2 个）
│       ├── words/route.ts        # GET 单词列表 / POST 批量加入背诵（按小写去重）
│       ├── words/[id]/route.ts   # PATCH 编辑释义 / DELETE 删除单词
│       ├── practice/today/route.ts # GET 今日队列（排序：抄写中>待开始>已完成）+ 进度
│       ├── practice/type/route.ts  # POST 拼写校验（错误清零重抄；正确+1，满 3 遍完成一轮背诵）
│       ├── records/route.ts      # GET 统计 + 今日记录 + 历史分组 + 临时文件状态
│       └── cleanup/route.ts      # POST 删除批次临时文件（背诵完成后由前端触发）
├── components/site-header.tsx    # 顶部导航（当前页高亮）
├── lib/word-app.ts               # SDK 客户端单例 + 识别/释义/JSON 解析等共享函数
└── storage/database/             # Supabase 数据层（schema + client）
```

## 数据模型（3 张表）

- `words`：word（小写唯一）、pos、translation、translation_source（upload/search）、source_file、batch_id、correct_round（当前轮 0-3）、recite_count（已背诵轮数）、total_typed（累计正确拼写数 = recite_count*3）、status（pending/practicing/done）、recited_at（最后完成一轮的时间，用于"今日记录"）
- `upload_files`：filename、file_key（S3 key）、file_type（image/pdf/word/ppt/excel/text）、batch_id、status（active/deleted）、deleted_at
- `practice_records`：word_id（cascade）、word、round_index（本轮第几遍 1-3）、session_no（第几次背诵轮）、created_at；round_index=3 的记录代表完成一轮背诵（历史分组与连续天数以此为准）

## 代码风格

- 全部标点使用半角（字符串内中文除外）；组件/函数参数必须显式类型标注
- 前端页面统一 `'use client'`；接口路由返回 `NextResponse.json`
- 设计变量一律用 `@theme` 语义类名（bg-surface/80、text-on-surface-variant、jelly-* 等），禁止硬编码色值（彩虹渐变 linear-gradient 内联色值除外，与原型保持一致）
- 图标统一 lucide-react，禁止 emoji 当图标
- 修改 schema.ts 后必须 `coze-coding-ai db generate-models && coze-coding-ai db upgrade`

## 注意事项

- S3 临时文件 key 统一 `tmp-words/{batchId}/{filename}`；删除通过 `/api/cleanup`（上传文件仅在背诵批次期间存在）
- LLM 输出 JSON 需容错解析（`src/lib/word-app.ts` 的 `parseWordsJson`）
- 释义格式：1-2 个中文释义以 `;` 分隔（如 `努力; 尝试`）
- 图片识别用 `doubao-seed-2-0-lite-260215`（多模态），释义提炼用 `doubao-seed-2-0-mini-260215`（低成本）
