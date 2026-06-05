# 临时聊天室 (Temp Chat)

一个基于 PHP 的一次性临时聊天网站。每个用户进入网站会自动生成一个 32 位的临时 PID，通过交换 PID 即可开始聊天。

![Preview](preview.png)

## ✨ 特性

- 🔐 **临时身份** - 每次访问自动生成 32 位唯一 PID，刷新页面重新生成
- 💬 **即时通讯** - WebSocket 实时消息推送，无延迟
- 👥 **多人聊天** - 支持同时与多个用户聊天
- 🟢 **在线状态** - 实时检测对方是否在线
- 🗑️ **阅后即焚** - 退出时自动清除所有聊天记录
- 📱 **响应式设计** - 支持桌面和移动设备
- 🐳 **Docker 部署** - 一键启动，无需复杂配置

## 🚀 快速开始

### 使用 Docker Compose（推荐）

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd temp-chat
   ```

2. **启动服务**
   ```bash
   docker compose up -d --build
   ```

3. **访问网站**
   
   打开浏览器访问：http://localhost:8080

4. **停止服务**
   ```bash
   docker compose down
   ```

### 手动部署

如果不使用 Docker，需要：

1. PHP 8.0+ 环境
2. Apache/Nginx Web 服务器

配置 Web 服务器指向 `src` 目录，并确保 `data` 目录可写。

## 📁 项目结构

```
temp-chat/
├── docker-compose.yml    # Docker Compose 配置
├── Dockerfile           # PHP 环境配置
├── README.md            # 项目说明
├── src/                 # 源代码
│   ├── index.php        # 主页面
│   ├── api.php          # API 接口
│   ├── style.css        # 样式文件
│   └── app.js           # 前端逻辑
└── data/                # 数据存储（自动创建）
```

## 🔧 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| TZ | Asia/Shanghai | 时区设置 |

### 端口配置

| 服务 | 端口 | 说明 |
|------|------|------|
| Web | 8080 | 网站访问端口 |
| WebSocket | 9000 | WebSocket 通信端口 |

如需修改端口，编辑 `docker-compose.yml` 文件中的 `ports` 配置。

## 💡 使用说明

### 开始聊天

1. **获取你的 PID**
   - 进入网站后，左上角会显示你的 32 位 PID
   - 点击复制按钮复制你的 PID

2. **分享 PID**
   - 将你的 PID 通过其他方式（如短信、邮件等）发送给想聊天的人

3. **开始聊天**
   - 在输入框中输入对方的 PID
   - 点击箭头按钮或按回车开始聊天

4. **发送消息**
   - 在底部输入框输入消息
   - 点击发送按钮或按回车发送

### 注意事项

- ⚠️ **刷新页面会生成新的 PID**，之前的聊天记录将无法恢复
- ⚠️ 对方离线时发送的消息不会被送达
- ⚠️ WebSocket 连接断开会自动重连
- ⚠️ 消息仅在双方都在线时有效，服务器默认保留消息 1 小时

## 🛠️ 技术栈

- **后端**: PHP 8.2 + Redis
- **前端**: 原生 Java CSS3
- **容器**: Docker + Docker Compose
- **Web 服务器**: Apache

## 📊 API 接口
WebSocket 通信

连接地址: `ws://localhost:9000`

#### 注册用户
```json
{
    "type": "register",
    "pid": "32位PID字符串"
}
```

#### 发送消息
```json
{
    "type": "send",
    "from": "发送者PID",
    "to": "接收者PID",
    "text": "消息内容",
    "time": 1234567890
}
```

#### 检查在线状态
```json
{
    "type": "checkStatus",
    "pid": "目标用户PID"
}
```

#### 心跳
```json
{
    "type": "ping"
}
GET /api.php?action=check&pid=用户PID
```

## 🔒 安全说明

- 消息通过 Redis 临时存储，服务器不持久化任何聊天内容
- 用户 5 WebSocket 实时传输，不在服务器持久化
- 用户断开连接即清除所有数据
- 建议在生产环境中启用 WSS (WebSocket Secure) 和
## 📝 更新日志

### v1.0.0
- 初始版本发布
- 支持基本聊天功能
- Docker 一键部署

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

Made with ❤️ for temporary conversations
