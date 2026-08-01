# AGENTS.md — 墨问开发约定

本文件适用于整个仓库。目标是让人和编码代理以小步、可验证、可回退的方式迭代这款 Android 优先的本地 EPUB 阅读器。

## 先读再改

- 本项目固定使用 Expo SDK 54。写代码或调整依赖前，必须阅读对应的版本化文档：<https://docs.expo.dev/versions/v54.0.0/>。
- 不要凭最新版 Expo、React Native 或 WebView 的记忆修改 API；SDK 54 对应 React Native 0.81、React 19.1，最低 Node.js 版本为 20.19.x。
- 先查看 `package.json`、相关源码、现有 diff 和调用链，再提出或实施修改。优先修复根因，不叠加临时分支或书籍特判。
- 工作区可能包含用户尚未提交的修改。保留无关改动，不做 `git reset --hard`、`git checkout --` 或大范围格式化。

## 产品与架构不变量

- `foliate-js` 是唯一 EPUB 排版引擎。不要恢复自制分页器、按段落估算页数、`FlatList` 正文阅读器或无原始 EPUB 的旧回退阅读器。
- `App.tsx` 只负责应用级状态、书架操作、持久化协调和页面切换；`src/components/` 负责书架、阅读屏、工具栏、弹层和 AI 面板；`src/FoliateReader.tsx` 只负责 WebView 生命周期与原生桥接。
- `src/foliate/runtime.ts` 与 `src/foliate/runtimePart*.ts` 共同组成 WebView 内的 HTML/CSS/JavaScript 运行时源码；修改排版、分页、脚注或手势时只改这些源文件，并同步运行 Foliate smoke 测试。
- `src/ui/theme.ts` 是主题和调色板的唯一来源，`src/ui/styles.ts` 是共享原生样式；组件不得重新定义第二套主题常量。
- `web/foliate-entry.js` 是 Foliate 浏览器包入口；`src/generated/foliateBundle.ts` 是生成物。需要改变打包入口时编辑 `web/` 或 `scripts/build-foliate.mjs`，然后运行 `npm run build:foliate`，不要手改生成文件。
- `src/epub.ts` 负责导入和解析元数据/AI 上下文；原始 `epubUri` 必须保留，实际排版交给 Foliate。
- EPUB CFI 是书签、历史对话和恢复阅读位置的权威定位。全书进度使用 Foliate 的 total progression/position，不能退化为章节内页码或段落比例。
- 上下连续和左右翻页都由 Foliate 的 flow 控制。左右翻页必须即时切页，不加入页面淡出、滑动过渡或人为延迟。
- 阅读正文的主题、字体、字号、行距、段距、页边距、缩进和对齐统一从 `ReaderPrefs` 注入。新增偏好时同步更新类型、默认值、持久化迁移、WebView 配置和脚本夹具。
- EPUB 自带 CSS 不可信。覆盖样式时优先使用语义规则，并为标题、图注、表格、列表、脚注等结构设置明确例外；不要按某一本书的文件名或章节号打补丁。
- 注释链接应在当前阅读界面内展示完整内容。内部脚注跳转不得把用户丢到章节末尾，弹层不得出现横向滚动。
- 长按文字默认选中所在段落并打开 AI；长按图片传递图片；中央单击切换工具栏；分页模式左右点击切页。这些手势不可互相吞事件。

## 文件边界

- 一个文件只保留一个主要职责；新组件优先放入 `src/components/` 对应领域目录，不把业务组件重新堆回 `App.tsx`。
- 纯计算、消息校验和格式转换放入无 UI 依赖的模块，便于 Node 测试；组件文件不直接承担 EPUB 解析或持久化迁移。
- `src/generated/foliateBundle.ts`、`android/`、`ios/`、`.expo/` 和 `dist/` 属于生成物或环境目录，不手工编辑，也不把它们当作拆分目标。
- 本仓库的规范文件名是根目录 `AGENTS.md`；不要另建大小写不同或内容重复的 `agent.md`。

## 代码实现准则

- TypeScript 类型是接口契约。避免 `any`；跨 WebView 的消息使用可判别联合类型，并对来自页面的字段做边界检查。
- React 组件保持职责清晰。高频回调用 `useCallback`，昂贵派生数据用 `useMemo`，但不要为了形式滥用 memoization。
- 阅读位置、拖动进度等高频事件应节流或合并；不要在每个移动事件中写 AsyncStorage、重建整棵 React 树或重新注入整本 EPUB。
- WebView bridge 必须可重复初始化和清理事件监听器。配置变更优先增量应用，除非文件或运行时本身变化，不重新传输 EPUB。
- 不使用正文字符串长度估算真实页数、图片高度或 CFI。等待排版引擎返回位置和布局结果。
- 用户可见错误要说明下一步；调试日志应带稳定前缀，并且不得打印 API 密钥、完整 EPUB、用户提问或大段书籍内容。
- API 密钥只进入 `expo-secure-store`。SecureStore 的 key 使用固定、非空、兼容字符集的常量；不要把密钥写入 AsyncStorage、源码、日志或提交记录。
- 新增 Expo/React Native 原生依赖使用 `npx expo install <package>`，再确认它支持 SDK 54。不要直接追最新版。
- 除非明确需要原生依赖或配置变化，不运行 `expo prebuild`。不要手改生成的 `android/`、`ios/`、`.expo/` 或 `dist/`。

## UI 与交互

- 所有设置页、弹层和状态栏必须适配 `paper`、`wheat`、`mist`、`night` 四种主题，颜色来自 `getReaderPalette`，不要散落仅适合浅色主题的硬编码颜色。
- 尊重安全区域和用户页边距。正文左右必须视觉居中；页码固定靠近底部安全区，不参与正文分页高度计算。
- 控件优先符合移动端直觉：连续值用滑块，二选一用同排分段按钮或开关，灰色拖动条所在区域可下拉关闭。
- 保证常用触控目标约 44dp；不要只让文字或图标本身可点击。
- 不新增空洞文案、拟人化口号或打断阅读的提示。反馈短、具体、可操作。
- 视觉调整至少检查窄屏 Android、大字号、夜间主题、短章节、含图片/图注/脚注章节。

## 推荐工作流

1. 用 `rg` 找到状态来源、渲染入口和消息协议，复述根因或约束。
2. 选择能解决根因的最小改动；删除被替代的分支和死代码，不保留第二套阅读实现。
3. 如果修改 Foliate 打包入口或依赖，运行 `npm run build:foliate` 并提交更新后的 `src/generated/foliateBundle.ts`。
4. 运行与改动相称的验证，并检查 `git diff --check` 与最终 diff。
5. 明确说明已验证什么、未验证什么。除非用户要求，不生成 APK/AAB，不启动耗时原生构建。

## 验证命令

基础检查：

```powershell
npm run typecheck
git diff --check
```

修改 Foliate bridge、CSS、脚注、分页或生成包时，额外使用用户提供的 EPUB：

```powershell
npm run smoke:foliate -- "C:\path\to\book.epub"
```

真机交互由 Expo 开发服务器验证：

```powershell
npm start
```

只有明确要求原生构建时才构建。下载依赖或构建工具统一使用本机代理 `http://127.0.0.1:7890`，仅设置当前进程的 `HTTP_PROXY`/`HTTPS_PROXY`，不修改全局代理。Android 本地构建只产出 `arm64-v8a`，除非用户另有要求。

## 完成标准

- 用户要求的行为已在唯一的 Foliate 路径中实现，没有旧引擎或书籍特判。
- 新旧持久化数据都能加载；新增字段有默认值和迁移兼容。
- 四种主题、两种翻页方式及相关手势没有明显回归。
- `npm run typecheck` 与 `git diff --check` 通过；相关生成物已更新。
- 没有提交密钥、用户 EPUB、日志、缓存、构建产物或无关工作区改动。
- 交付说明以结果为先，列出验证和仍需真机确认的边界。
