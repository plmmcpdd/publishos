# PublishOS — TikTok Web Automation Checklist

## 版本信息
- **Version**: 1.0
- **Date**: 2026-06-04
- **Author**: @研发 (Tech Lead)
- **Status**: Final

## 1. 目标

为外部开发团队提供 TikTok 网页端自动化发布的第一周 spike 验收标准。验证结果决定 v1 的实现策略：
- **Green** = 全自动可行，客户端一键发布
- **Yellow** = 半自动，需客户一键确认兜底
- **Red** = 降级方案，客户端导出 + 客户手动上传

## 2. TikTok Web 端现状

### 2.1 已知事实（Day 1 验证）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 未登录访问 `/upload` | ❌ 直接重定向到登录墙 | 必须登录后才能访问上传界面 |
| 反自动化 SDK | ⚠️ 三重叠加 | `webmssdk` + `secsdk` + `libraweb` |
| Web 端 AI 标签支持 | ✅ `show_aigc_label_web: v1` | 网页端支持 AI 生成内容标记 |
| 登录态持久化 | ❓ 未验证 | 需要真实账号 + 真实浏览器环境测试 |

### 2.2 反自动化检测详解

**webmssdk** — 设备指纹收集：
- 屏幕分辨率、色彩深度
- 浏览器插件列表
- Canvas 指纹、WebGL 指纹
- 时区、语言、字体列表
- 鼠标移动轨迹（速度、加速度、停顿）
- 页面滚动行为（速度、距离）
- 页面停留时长

**secsdk** — 行为安全检测：
- 输入事件模式（键盘输入间隔、鼠标点击模式）
- 页面交互频率
- 异常操作检测（如瞬间完成表单填写）

**libraweb** — 风控策略：
- IP 信誉评分（ASN、地理位置、代理检测）
- 账号行为基线（正常用户的操作模式）
- 设备环境一致性（登录时 vs 操作时）

## 3. 验收标准

### 3.1 Green 级别（全自动）

**标准：** 客户端可以完全自动完成发布，无需客户手动点击 TikTok 的「Post」按钮。

| 检查项 | 验收标准 | 测试方法 |
|--------|----------|----------|
| 登录态持久化 | 7 天内无需重新登录 | 使用真实账号，关闭浏览器后重新打开，检查是否仍登录 |
| 自动化上传 | 连续 30 天，每天 1-2 次上传无风控触发 | 脚本自动化执行，记录风控事件 |
| 反检测绕过 | `webmssdk` 不标记异常 | 检查浏览器控制台无异常日志，账号无限制提示 |
| 设备指纹一致性 | 同一设备指纹持续使用 | 对比每次操作的指纹哈希值 |
| 发布成功率 | > 95% | 记录成功/失败次数 |
| AI 标签自动勾选 | 上传时 `show_aigc_label_web` 正确设置 | 检查上传请求 payload |

**达到 Green 后的实现：**
- 客户端开启 Auto-Publish 后，完全无需客户介入
- 内容从审核通过到 TikTok 发布全自动
- 发布完成后自动回传状态

### 3.2 Yellow 级别（半自动）

**标准：** 自动化可以完成 90% 的工作，但需要客户最后点击确认。

| 检查项 | 验收标准 | 测试方法 |
|--------|----------|----------|
| 登录态持久化 | 3-7 天内无需重新登录 | 同上 |
| 自动化填表 | 文案、hashtag、封面可以自动填入 | 人工检查上传页面内容是否正确 |
| 文件上传 | 视频可以自动附加到上传表单 | 检查 TikTok 上传界面是否已加载视频 |
| AI 标签 | 可以自动勾选（但可能需要客户确认） | 检查上传界面 AI 标签状态 |
| 最终发布 | 需要客户点击 TikTok 的「Post」按钮 | 记录客户操作次数 |

**达到 Yellow 后的实现：**
- 客户端自动打开浏览器，预填所有内容
- 客户只需点击 TikTok 的「Post」按钮
- 发布完成后客户端自动回传状态
- 这是推荐的安全策略（平台看到的仍是"真人操作"）

### 3.3 Red 级别（降级）

**标准：** 自动化无法稳定运行，或存在高风险被封号。

| 触发条件 | 说明 |
|----------|------|
| 登录态 24 小时内失效 | 频繁要求重新登录 |
| 连续 3 次触发风控 | 账号出现验证码、限制提示 |
| 上传接口变更 | TikTok 更新导致自动化脚本失效 |
| 设备指纹被标记 | 同一指纹被多次标记异常 |
| 账号被封 | 测试账号因自动化行为被封 |

**达到 Red 后的实现：**
- 客户端改为「一键导出」模式
- 自动将视频 + 文案打包成下载包
- 客户手动打开 TikTok App，上传视频
- 客户端提供文案复制功能，方便客户粘贴
- 这是最保守但最安全的方案

## 4. 测试方法

### 4.1 测试环境

**最小测试环境：**
- 1 个真实 TikTok 账号（Business 或 Creator 账号）
- 1 台 Windows 或 macOS 电脑（与目标客户端一致）
- 稳定的家庭网络（不使用代理/VPN）
- 测试视频素材（10-15 秒，合规内容）

**推荐测试环境：**
- 3 个不同账号（Business/Creator/Personal）
- 2 台不同设备（Windows + macOS）
- 2 个不同网络环境（家庭 + 办公）
- 测试周期：7 天连续测试

### 4.2 测试脚本框架

```javascript
// 使用 Playwright 的测试框架示例
const { chromium } = require('playwright');

async function testTikTokUpload() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    // 模拟真实用户环境
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // 不启用 webdriver 标记
  });
  
  const page = await context.newPage();
  
  // 1. 登录检查
  await page.goto('https://www.tiktok.com/upload');
  // 验证是否已登录（未登录则记录失败）
  
  // 2. 上传流程
  // 选择文件
  // 填写文案
  // 添加 hashtag
  // 勾选 AI 标签
  // 点击发布
  
  // 3. 验证结果
  // 检查发布成功页面
  // 记录 platform_post_id
  
  await browser.close();
}
```

### 4.3 测试数据记录

每次测试记录：
```json
{
  "test_id": "test_001",
  "timestamp": "2026-06-04T10:00:00Z",
  "account_type": "business",
  "device": "macbook_pro_m1",
  "network": "home_wifi",
  "browser": "chromium_120",
  "steps": {
    "login_check": "passed",
    "upload_file": "passed",
    "fill_caption": "passed",
    "add_hashtags": "passed",
    "check_ai_label": "passed",
    "click_post": "passed",
    "verify_publish": "passed"
  },
  "duration_seconds": 45,
  "errors": [],
  "platform_post_id": "tiktok_1234567890",
  "notes": ""
}
```

## 5. 风险与缓解

### 5.1 已知风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| TikTok 更新上传界面 | 高 | 高 | 建立监控，接口变更时自动告警 |
| 账号被封 | 中 | 高 | 使用测试账号，避免客户账号直接测试 |
| 登录态频繁失效 | 中 | 中 | 实现自动重登录，或提醒客户手动登录 |
| 反检测升级 | 中 | 高 | 持续更新 stealth 策略，保持低调操作 |
| 网络不稳定 | 低 | 中 | 重试机制，异步队列 |

### 5.2 反检测最佳实践

1. **使用真实浏览器环境**：不要 headless，使用真实 Chromium 窗口
2. **模拟人类行为**：
   - 鼠标移动有曲线和停顿
   - 输入有间隔（不是瞬间完成）
   - 页面滚动有速度和惯性
   - 操作之间有随机等待时间
3. **保持设备一致性**：
   - 同一设备指纹长期使用
   - 同一 IP 地址长期使用
   - 同一浏览器 profile 长期使用
4. **避免批量操作**：
   - 不要在短时间内连续上传多条
   - 不要在同一 IP 下操作多个账号
   - 操作时间分布要自然（工作时间）
5. **真人行为稀释**：
   - 鼓励客户偶尔主动使用 TikTok（浏览、点赞、评论）
   - 这些真实行为会"稀释"自动化痕迹

## 6. 实现建议

### 6.1 Green 级别实现

```
[客户端 App]
  │
  ├─▶ 检测登录状态
  ├─▶ 未登录 → 引导客户登录（一次）
  ├─▶ 已登录 → 自动执行：
  │     ├─ 打开 TikTok 上传页
  │     ├─ 上传视频
  │     ├─ 填写文案和 hashtag
  │     ├─ 勾选 AI 标签
  │     ├─ 点击发布
  │     └─ 等待发布完成
  │
  └─▶ 捕获 platform_post_id
      └─ 回传状态到网关
```

### 6.2 Yellow 级别实现（推荐）

```
[客户端 App]
  │
  ├─▶ 检测登录状态
  ├─▶ 已登录 → 自动执行：
  │     ├─ 打开 TikTok 上传页
  │     ├─ 上传视频
  │     ├─ 填写文案和 hashtag
  │     ├─ 勾选 AI 标签
  │     └─ 显示确认弹窗：
  │           "Click 'Post' on TikTok to publish"
  │
  ├─▶ 客户点击 TikTok 的 "Post"
  ├─▶ 客户端检测到发布完成
  └─▶ 回传状态到网关
```

### 6.3 Red 级别实现（降级）

```
[客户端 App]
  │
  ├─▶ 下载视频到本地 Downloads 文件夹
  ├─▶ 显示文案和 hashtag（可复制）
  ├─▶ 显示步骤提示：
  │     1. Open TikTok App
  │     2. Tap + to upload
  │     3. Select video from Downloads
  │     4. Paste caption and hashtags
  │     5. Tap Post
  │
  └─▶ 客户手动完成后，点击 "Done"
      └─ 手动回传状态到网关
```

## 7. 测试计划

### 7.1 Week 1 Spike 计划

| Day | 任务 | 验收目标 |
|-----|------|----------|
| 1 | 环境搭建 + 首次上传测试 | 能完成一次完整上传 |
| 2 | 登录态持久化测试 | 24 小时内无需重新登录 |
| 3 | 反检测绕过测试 | 基础 stealth 通过，无异常标记 |
| 4 | 连续操作测试 | 3 次连续上传无风控触发 |
| 5 | 人类行为模拟测试 | 添加鼠标/键盘模拟，测试稳定性 |
| 6 | 7 天持久化测试 | 登录态持续 7 天 |
| 7 | 综合评估 + 报告 | 确定 Green/Yellow/Red 级别 |

### 7.2 测试报告模板

```markdown
# TikTok Web Automation Test Report

## 测试周期
- 开始日期：2026-06-04
- 结束日期：2026-06-11
- 测试账号：@test_account (Business)
- 测试设备：MacBook Pro M1, macOS 14.0
- 网络环境：家庭 WiFi，无代理

## 测试结果汇总
| 检查项 | 结果 | 说明 |
|--------|------|------|
| 登录态持久化 | 通过/失败 | 7天内是否需要重新登录 |
| 自动化上传 | 通过/失败 | 是否能自动完成上传流程 |
| 反检测绕过 | 通过/失败 | 是否触发风控 |
| 发布成功率 | XX% | 成功/失败次数 |
| AI 标签 | 通过/失败 | 是否能自动勾选 |

## 结论
- [ ] Green (全自动)
- [ ] Yellow (半自动)
- [ ] Red (降级)

## 建议
...
```

## 8. 版本历史

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-04 | Initial checklist for handoff |

---

**Document Status**: Final  
**Owner**: @研发 (Tech Lead)  
**Next Review**: 2026-06-11 (after Week 1 spike)
