# TikTok 自动化测试 Checklist — 第一周 Spike
> 目标: 验证 Electron 客户端在客户本地设备上，通过 TikTok web 端完成「登录 → 上传 → 发布」全流程的可行性和稳定性。

---

## 测试环境要求

| 组件 | 要求 |
|------|------|
| 设备 | 真实 Windows 10/11 或 macOS 12+ 设备（不要用虚拟机 / Docker） |
| 网络 | 美国家宽 IP（与客户目标环境一致） |
| 浏览器 | Electron 内置 Chromium（版本 ≥ 120） |
| 账号 | 真实 TikTok 账号（建议 business account），不要用新注册号测试 |
| 反检测工具 | `playwright-stealth` 或 `puppeteer-stealth` |

---

## 测试项目

### A. 基础环境检测

- [ ] **A1. Navigator 指纹隐藏** — 验证 `navigator.webdriver` 为 `undefined`，`navigator.plugins` 非空
- [ ] **A2. Chrome DevTools Protocol 关闭** — 确保 `--remote-debugging-port` 未启用，防止 `window.chrome` 暴露
- [ ] **A3. User-Agent 正确** — 显示为真实 Chrome 浏览器，不含 HeadlessChrome 或 Electron 字样
- [ ] **A4. WebGL/Canvas 指纹** — 与真实设备一致（可用 browserleaks.com/canvas 验证）
- [ ] **A5. 时区/语言** — 与 IP 地理位置匹配（America/New_York + en-US）

### B. TikTok 访问与登录

- [ ] **B1. 首页可访问** — `https://www.tiktok.com` 正常加载，不被 Cloudflare 拦截
- [ ] **B2. 登录页面可达** — `/login` 页面元素可交互，无异常跳转
- [ ] **B3. 短信/邮箱登录** — 使用真实凭证完成登录，记录登录时长
- [ ] **B4. 登录态持久化** — 关闭 Electron 窗口后重新打开，检测 Cookie 是否保留（预期: 48-72 小时）
- [ ] **B5. 多设备登录检测** — 模拟同一账号在真实手机和 Electron 上同时登录，观察是否触发安全验证
- [ ] **B6. 登录频率限制** — 24 小时内重复登录/登出 5 次，观察是否触发风控（验证码/锁定）

### C. 上传页面探测

- [ ] **C1. 上传页可达** — 登录后访问 `/upload`，页面加载完整 upload UI（非登录墙）
- [ ] **C2. 文件选择器** — 通过 Playwright 触发 `<input type="file">`，选择 5-60MB 的视频文件
- [ ] **C3. 上传进度检测** — 监听页面 DOM 或 XHR，获取上传进度百分比（0% → 100%）
- [ ] **C4. 封面选择** — 自动选择第 1 帧或自定义封面图
- [ ] **C5. 文案填写** — 在 caption 输入框填入文本 + hashtag
- [ ] **C6. AI 标签检测** — 检测页面中 AI-generated content toggle 的 DOM 路径，记录 selector
- [ ] **C7. 隐私设置** — 设置 public/private/allow_comments 等选项
- [ ] **C8. 发布按钮** — 触发 Post 按钮，检测页面跳转或成功提示

### D. 反自动化对抗测试

- [ ] **D1. 鼠标轨迹模拟** — 使用 Bezier 曲线生成人类化鼠标移动路径，避免直线轨迹
- [ ] **D2. 键盘输入模拟** — 在输入框中模拟人类打字节奏（随机间隔 50-150ms），避免瞬间填充
- [ ] **D3. 页面停留时长** — 在上传页面停留 ≥ 30 秒，模拟人类操作节奏
- [ ] **D4. 滚动行为** — 在上传前随机滚动 For You feed 5-10 条视频，模拟真实用户行为
- [ ] **D5. 多行为稀释** — 每隔 2-3 小时执行一次非上传操作（点赞、浏览），检测账号是否更安全
- [ ] **D6. webmssdk/secsdk 检测** — 抓包分析 TikTok 是否发送异常行为评分事件（高风险=0-10分）

### E. 稳定性与压力测试

- [ ] **E1. 单次发布成功率** — 连续 10 次发布，成功率 ≥ 90%
- [ ] **E2. 连续发布间隔** — 同一账号 1 小时内发布 3 条视频，是否触发频率限制
- [ ] **E3. 登录态衰减** — 保持 Electron 运行 72 小时不操作，第 73 小时尝试发布，是否仍有效
- [ ] **E4. 断网恢复** — 上传过程中断网 30 秒，恢复后能否自动重试或报错
- [ ] **E5. 大文件测试** — 上传 200MB+ 视频（如有），检测内存/网络稳定性
- [ ] **E6. 多账号切换** — 同一 Electron 实例切换 2 个 TikTok 账号，Cookie 隔离是否有效

### F. 风控触发与恢复

- [ ] **F1. 验证码触发** — 什么行为会触发 captcha？记录触发条件和频率
- [ ] **F2. Shadowban 检测** — 发布后用 hashtag 搜索最新帖子，是否出现在结果中
- [ ] **F3. 账号限制** — 连续 5 天每天发布 3 条，是否收到平台警告或限流
- [ ] **F4. 申诉恢复** — 如果账号被限流，通过 TikTok 申诉流程恢复的成功率

---

## 验收标准

| 等级 | 条件 | 结论 |
|------|------|------|
| **Green** | B1-B8 全部通过，E1 成功率 ≥ 90%，E3 登录态 ≥ 72h，F3 5 天无警告 | **全自动发布可行** |
| **Yellow** | B1-B8 通过，但 E1 成功率 70-90%，或 E3 登录态 < 72h，或 F2 偶尔 shadowban | **半自动+人工兜底** — 客户端需要"一键确认"机制，发布失败时自动 fallback 到导出模式 |
| **Red** | B1-B8 任意一项失败，或 E1 成功率 < 70%，或 F3 3 天内被警告 | **全自动不可行** — TikTok 降级为「导出成片+文案，客户手动上传」 |

---

## 测试数据记录模板

每次测试记录:
```json
{
  "test_id": "tiktok_spike_001",
  "timestamp": "2026-06-10T14:00:00Z",
  "device": {
    "os": "macos_14.5",
    "browser": "chrome_124",
    "ip": "...",
    "geo": "US-NY"
  },
  "account": {
    "username": "@test_acme",
    "type": "business",
    "age_days": 180
  },
  "test_type": "B4",
  "result": "pass",
  "duration_seconds": 45,
  "notes": "Login session persisted after 48h",
  "screenshot": "s3://.../spike_001_B4.png"
}
```

---

## 已知风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| webmssdk 升级检测新指纹 | 高 | 全自动变 Red | 每周运行一次 A 组检测，发现指纹变化及时告警 |
| TikTok 关闭 web 端上传功能 | 中 | 全自动变 Red | 监控 `/upload` 页面可用性，失效时降级为导出模式 |
| 登录态强制缩短至 24h | 中 | Yellow 变 Red | 客户端托盘通知客户重新登录，设计「一键重登」流程 |
| 同一 IP 多账号被标记 | 中 | 客户账号被封 | 严格一账号一设备，不在同一设备上登录多个客户账号 |
| 视频内容本身触发审核 | 低 | 单条发布失败 | 运营预审 + 版权扫描，确保内容合规 |

---

## 外部团队第一周交付物

1. **测试报告** — 按 A-F 逐项记录，附截图和日志
2. **自动化脚本** — 可重复运行的 Playwright 测试脚本（脱敏后分享）
3. **风险评级** — Green/Yellow/Red 结论 + 建议方案
4. **DOM Selector 文档** — TikTok 上传页各元素的精确 selector（供客户端开发使用）
