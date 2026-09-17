# AGENTS.md

## 项目概览

「果冻单词」——白色纸感主题的背单词 Web 应用，兼具彩虹色线条与透明果冻效果。

核心能力：
1. 多格式文件上传（图片 jpg/png/jpeg、Word、PDF、PPT、Excel）→ 提取英文单词；上传页支持点击/拖拽/Ctrl+V 粘贴（截图、复制的文件、英文文本自动包装 txt）
2. 识别完成即带释义返回（LLM 批量直译：12 词/批 + 16 路并发池，100 词约 3 秒）；`/api/translate` 仅作背诵页兜底补译
3. 单词卡"照抄键入"背诵：英文单词大字展示 + 逐字母果冻格子键入，正确拼写 3 遍 = 已背诵 1 遍（可累加），拼错则本轮清零重抄
4. 背诵队列：新加入的单词排最上方，未背完的优先于已背完；重复导入的单词不跳过——重置本轮进度重新背诵（历史累计遍数保留）；背诵页可星标单词
5. 文件即用即焚：上传文件存对象存储（key 前缀 `tmp-words/`），识别成功返回词列表后立即删除 S3 对象并标记 upload_files 为 deleted
6. 背诵记录：紧凑统计条 + 星标词星系（行星环绕运动、景深、透明背景、行星带，点击展示词源/词根/释义/音乐剧台词，LLM 生成并 localStorage 缓存）+ 一周趋势图 + 气泡排行榜（hover 互动、点击当场拼写、拼错重拼，纯前端不写库）+ 今日记录 + 按日期分组历史 + 支持作者弹窗（双收款码）+ 留言板（公开留言需昵称+联系方式，联系方式仅站长可见，站长在 /admin 审核后公开）
7. 账号体系（邀请制）：自建 accounts/sessions 表（非 Supabase Auth），scrypt 密码哈希 + httpOnly cookie `jelly_session`（7 天）；账号上限 100 个，注册通道关闭，账号由站长在 /admin 生成账密后私下分发；数据按 user_id 隔离，首次部署访问 /login 出现"创建站长账号"，创建 admin 后 user_id 为 NULL 的历史数据自动划归站长
8. 同时在线限流：前端 25s 间隔 POST /api/heartbeat 刷 sessions.last_seen_at，活跃窗口 90s，超过 APP_ONLINE_LIMIT（默认 100）则 admitted=false，页面显示"暂时客满，正在排队等待～"（不出现数字）；登录接口满员时同样拒绝（429 queued）；心跳 401（过期/被踢）自动跳登录页
9. 识别配额：普通用户 10 次/天（APP_RECOGNIZE_DAILY_LIMIT 可调，accounts.recognize_date/recognize_count 按天计数），站长不限；识别入口 429 拦截 + 上传页显示今日剩余次数和"每次识别不超过 200 个单词"提示

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
│   ├── practice/page.tsx         # 背诵练习页（/practice，照抄键入核心交互；WordCard 键入状态局部化 + QueueItem memo，拼写零卡顿；加载后自动补齐缺释义/缺音标的未背完词，单词大字下方显示音标）
│   ├── login/page.tsx            # 登录页（/login；GET /api/auth/login 返回 mode：unready=库未初始化 / setup=创建站长账号 / login=登录）
│   ├── admin/page.tsx            # 站长面板（/admin，仅 role=admin；全站统计 + 账号管理（生成明文账密/停用/启用/删除，上限 100）+ 留言审核（通过/隐藏/删除，可见联系方式））
│   ├── records/page.tsx          # 背诵记录页（/records；含支持作者弹窗（双码：public/support-alipay.jpg 支付宝赞赏 + public/support-wechat.jpg 微信交流）、问题反馈留言板 FeedbackBoard、气泡排行）
│   ├── layout.tsx                # 全局布局 + 顶部导航
│   ├── globals.css               # @theme 设计变量（原型迁移源）+ 果冻动画 keyframes
│   └── api/
│       ├── upload/route.ts       # POST 上传文件 → S3 临时存储（key 含 u{userId} 段）+ upload_files 表（requireAccount）
│       ├── auth/login/route.ts   # GET mode 判断 / POST setup（表空创建站长+历史数据划归）/ login（校验密码+满员 429）；cookie httpOnly 7 天
│       ├── auth/logout/route.ts  # POST 删 session + 清 cookie
│       ├── auth/me/route.ts      # GET 当前账号 + 识别配额（admin limit=null）
│       ├── heartbeat/route.ts    # POST 心跳（刷 last_seen_at + 在线计数）→ { admitted }；会话失效 401
│       ├── admin/accounts/route.ts # POST list/create（满 100 报 409，username=word+6 位 hex，8 位随机密码）/disable（踢下线）/enable/delete（代码级联删 4 表+sessions，禁删自己）；requireAdmin
│       ├── admin/stats/route.ts  # GET 全站统计（账号/在线/总词数/总背诵轮/今日背诵/今日识别/待审留言）；requireAdmin
│       ├── recognize/route.ts    # POST 识别单词（图片→LLM 多模态 OCR；文档→FetchClient 解析→LLM 选词）
│       ├── translate/route.ts    # POST 批量 LLM 直译补齐缺失释义/音标（小批 12 词 + 16 路并发池，100 词约 3 秒；默认异步回写 words 表只补空字段）
│       ├── words/route.ts        # GET 单词列表 / POST 批量加入背诵（新词插入；重复导入重置本轮进度重新背诵；全部 requireAccount + .eq('user_id') 隔离）
│       ├── words/[id]/route.ts   # PATCH 编辑释义 / 星标 starred / DELETE 删除单词（requireAccount + user_id 隔离）
│       ├── practice/today/route.ts # GET 今日队列（未背完在前、组内新词置顶 id 降序）+ 进度 + 最近导入批次统计（requireAccount + user_id 隔离）
│       ├── practice/type/route.ts  # POST 拼写校验（错误清零重抄并写错误流水；正确+1，满 3 遍完成一轮背诵；requireAccount + user_id 隔离）
│       ├── records/route.ts      # GET 统计 + 星标词列表 + 一周趋势 + 今日记录 + 历史分组 + 三个排行榜（requireAccount + user_id 隔离）
│       ├── word-detail/route.ts  # POST LLM 生成单词详情（词源/词根/双语出处/角色/翻译/剧情背景）；例句三级兜底保证 100% 有例句：①LLM 分级选句（话剧→文学→新闻）+ 联网探针核验；②核验不过则联网搜索真实网页摘句（柯林斯词典/新闻，LLM 仅补翻译与背景）；③仍无则通用例句诚实标注 General Example；缓存 key jelly-detail:v4:*，记录页星系弹窗用
│       ├── feedback/route.ts    # GET 已审核留言（公开，表缺失返回 ready:false）/ POST 提交留言（requireAccount，昵称+联系方式必填，挂 user_id 进待审核队列）
│       ├── feedback/admin/route.ts # POST 留言审核（requireAdmin session 鉴权：list 含联系方式/approve/hide/delete）
│       ├── cleanup/route.ts      # POST 删除批次临时文件（requireAccount + user_id 隔离；兜底接口）
│       ├── recognize/route.ts 内含识别配额：入口 429 quotaExhausted 拦截 + 成功后 consumeRecognizeQuota 扣减（admin 不限）
│       ├── translate/route.ts、word-detail/route.ts # requireAccount + user_id 隔离
├── components/site-header.tsx    # 顶部导航（当前页高亮 + 用户区：头像下拉显示用户名/站长面板入口/退出登录）
├── components/heartbeat-gate.tsx # 心跳排队遮罩（25s 间隔 POST /api/heartbeat；admitted=false 显示"暂时客满，正在排队等待～"；401 跳登录页）
├── src/middleware.ts             # 页面守卫（matcher /、/practice、/records、/admin，无 jelly_session cookie 重定向 /login）
├── lib/auth.ts                   # 认证核心（scrypt 哈希/requireAccount/requireAdmin/createSession/heartbeat/isOnlineFull/probeAuthReady 60s 缓存探针；常量 ACCOUNTS_LIMIT=100、ONLINE_LIMIT、RECOGNIZE_DAILY_LIMIT=10）
├── lib/use-account.ts            # 前端账号 hook（GET /api/auth/me；401 跳登录）
├── lib/word-app.ts               # SDK 客户端单例 + 识别/释义/JSON 解析等共享函数
└── storage/database/             # Supabase 数据层（schema + client）
```

## 数据模型（6 张表）

- `accounts`：username（3-20 位字母数字下划线，唯一）、password_hash（scrypt salt:hash hex）、role（admin/user）、status（active/disabled）、display_name、recognize_date（配额日期）+ recognize_count（当日已用次数）、created_at；上限 100 个，站长在 /admin 生成明文账密分发
- `sessions`：token（64 位 hex，cookie jelly_session）、account_id、created_at、expires_at（7 天）、last_seen_at（心跳刷新，90s 活跃窗口内算在线）
- `words`：**user_id（数据隔离）**、word（小写唯一）、pos、translation、translation_source（upload/search）、source_file、batch_id、correct_round（当前轮 0-3）、recite_count（已背诵轮数）、target_recite（本轮需完成遍数，重复导入时提升为 recite_count+1）、import_count（导入次数）、total_typed（累计正确拼写数）、status（pending/practicing/done）、starred（星标，记录页组成星系）、phonetic（美式 IPA 音标，LLM 批量直译顺带生成）、recited_at（最后完成一轮的时间，用于今日记录）
- `upload_files`：**user_id（数据隔离）**、filename、file_key（S3 key，含 u{userId} 段）、file_type（image/pdf/word/ppt/excel/text）、batch_id、status（active/deleted）、deleted_at
- `feedback_messages`：**user_id（留言人，站长面板可见）**、nickname、contact（联系方式仅站长可见，公开接口不下发）、content、status（pending/approved，站长在 /admin 审核后 approved 才公开）、created_at
- `practice_records`：**user_id（数据隔离）**、word_id（cascade）、word、round_index（本轮第几遍 1-3，**0 表示拼错流水**，用于犯错最多排行）、session_no（第几次背诵轮）、created_at；round_index=3 的记录代表完成一轮背诵（历史分组、连续天数与一周趋势以此为准）

## 代码风格

- 全部标点使用半角（字符串内中文除外）；组件/函数参数必须显式类型标注
- 前端页面统一 `'use client'`；接口路由返回 `NextResponse.json`
- 设计变量一律用 `@theme` 语义类名（bg-surface/80、text-on-surface-variant、jelly-* 等），禁止硬编码色值（彩虹渐变 linear-gradient 内联色值除外，与原型保持一致）
- 图标统一 lucide-react，禁止 emoji 当图标
- 修改 schema.ts 后必须 `coze-coding-ai db generate-models && coze-coding-ai db upgrade`（注意该工具只连平台库，用户自有 Supabase 见下条）

## 注意事项

- 用户自有 Supabase 与平台库 schema 双轨：`coze-coding-ai db` 系列命令固定连平台 dev 库；用户库的结构变更必须提供 SQL 由用户在 Supabase Dashboard SQL Editor 执行。words 表新增列 `target_recite`/`import_count` 时，代码通过 `src/lib/word-app.ts` 的 `probeWordsNewColumns` 运行时探测（进程内缓存），列缺失自动降级为旧行为（重复导入跳过、无导入次数排行），执行过 DDL 后无需重启即自动启用新逻辑（重新部署进程即重新探测）
- `starred` 列同理走 `probeWordsStarred` 探测降级：列缺失时 records 接口不返回星标词、today 接口不带 starred 字段、背诵页隐藏星标入口（`starredReady` 状态）、PATCH 星标报错由前端乐观更新回滚兜底；列缺失的库需执行 `ALTER TABLE words ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false;`
- `phonetic` 列同理走 `probeWordsPhonetic` 探测降级：列缺失时 today 接口不带 phonetic、补译循环不触发音标补齐、回写跳过 phonetic、背诵页自动隐藏音标行；列缺失的库需执行 `ALTER TABLE words ADD COLUMN IF NOT EXISTS phonetic text;`（执行后无需重启，重新部署即生效）
- 账号体系初始化（用户自有 Supabase 首次部署必做）：在 Supabase Dashboard SQL Editor 执行账号系统 DDL（建 accounts/sessions 表+索引、四业务表加 user_id 列）；随后访问网站会跳 /login 显示"创建站长账号"，创建后 user_id 为 NULL 的历史数据（words/practice_records/upload_files/feedback_messages）自动划归站长
- probeAuthReady（60s 进程内缓存）探测 accounts 表可用性：表缺失时 GET /api/auth/login 返回 mode:unready、所有 requireAccount 接口 401"未登录"，前端自动跳 /login；新建表后需 NOTIFY pgrst, 'reload schema' 刷新 PostgREST schema cache
- 在线限流：APP_ONLINE_LIMIT 环境变量（默认 100）；心跳 25s、活跃窗口 90s；排队文案统一"暂时客满，正在排队等待～"，任何接口/页面不得暴露在线人数与上限数字
- 识别配额：APP_RECOGNIZE_DAILY_LIMIT 环境变量（默认 10 次/天）；admin 不限；recognize 入口 429 quotaExhausted + 成功后 consumeRecognizeQuota 两步扣减（select 后 update，容忍并发竞态）
- 站长管理：/admin 面板（requireAdmin）；账号生成后明文密码仅展示一次；删除账号代码级联删 sessions/words/practice_records/upload_files；禁删自己

- 数据库已于 2026-09 迁移至 Supabase 官网项目（ref `oalgwdejwsjjklwdymhk`，凭证在 `.env.local`，含 starred/target_recite/import_count 列）；旧火山引擎实例仅为历史存档，平台注入的 COZE_SUPABASE_* 指向平台库，均被 `.env.local` 强制覆盖
- 上传文件即用即焚：`/api/recognize` 成功返回词列表前删除 S3 对象（`getStorage().deleteFile({ fileKey })`）并标记 upload_files status=deleted；删除失败仅告警不阻塞识别
- S3 临时文件 key 统一 `tmp-words/{batchId}/{filename}`；`/api/cleanup` 仅作历史批次兜底
- LLM 输出 JSON 需容错解析（`src/lib/word-app.ts` 的 `parseWordsJson`）
- 释义格式：1-2 个中文释义以 `;` 分隔（如 `努力; 尝试`）
- 图片识别用 `doubao-seed-2-0-lite-260215`（多模态），释义批量直译用 `doubao-seed-2-0-mini-260215`（低成本，每批 40 词单次调用；识别完成即带释义返回，translate 仅兜底个别缺词）
- 数据库凭证加载优先级：进程/平台注入 < `.env`（部署打包会向其追加平台变量，同名键后者覆盖前者） < `.env.local`（强制覆盖，最高优先）。用户自有 Supabase 凭证唯一权威来源是 `.env.local`，严禁把凭证写回 `.env`
