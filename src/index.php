<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>临时聊天室</title>
    <link rel="stylesheet" href="style.css">
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
</head>
<body>
    <!-- 登录/注册页面 -->
    <div class="auth-container" id="authContainer">
        <div class="auth-box">
            <div class="auth-header">
                <h1>聊天室</h1>
                <p>登录或注册开始聊天</p>
            </div>
            
            <!-- 登录表单 -->
            <div class="auth-form" id="loginForm">
                <div class="form-group">
                    <label>用户名</label>
                    <input type="text" id="loginUsername" placeholder="请输入用户名" maxlength="20">
                </div>
                <div class="form-group">
                    <label>密码</label>
                    <input type="password" id="loginPassword" placeholder="请输入密码" maxlength="50">
                </div>
                <button class="auth-btn" onclick="doLogin()">登录</button>
                <p class="auth-switch">
                    还没有账号？<a href="javascript:void(0)" onclick="showRegister()">立即注册</a>
                </p>
            </div>
            
            <!-- 注册表单 -->
            <div class="auth-form" id="registerForm" style="display: none;">
                <div class="form-group">
                    <label>用户名</label>
                    <input type="text" id="regUsername" placeholder="3-20个字符，字母数字下划线" maxlength="20">
                </div>
                <div class="form-group">
                    <label>昵称</label>
                    <input type="text" id="regNickname" placeholder="1-20个字符" maxlength="20">
                </div>
                <div class="form-group">
                    <label>密码</label>
                    <input type="password" id="regPassword" placeholder="至少6位" maxlength="50">
                </div>
                <button class="auth-btn" onclick="doRegister()">注册</button>
                <p class="auth-switch">
                    已有账号？<a href="javascript:void(0)" onclick="showLogin()">返回登录</a>
                </p>
            </div>
        </div>
    </div>
    
    <!-- 主聊天界面 -->
    <div class="container" id="chatContainer" style="display: none;">
        <!-- 左侧边栏 -->
        <div class="sidebar">
            <div class="user-info">
                <div class="avatar">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                    </svg>
                </div>
                <div class="my-pid">
                    <span class="label" id="myNickname">加载中...</span>
                    <span class="pid-value" id="myPid">加载中...</span>
                    <button class="copy-btn" onclick="copyPid()" title="复制PID">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                    </button>
                </div>
                <button class="logout-btn" onclick="doLogout()" title="退出登录">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
                    </svg>
                </button>
            </div>
            
            <div class="new-chat">
                <input type="text" id="searchInput" placeholder="输入PID/用户名/昵称搜索" oninput="handleSearchInput(event)" onkeypress="handleSearchKeyPress(event)">
                <button onclick="doSearch()" class="start-btn">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                </button>
                <!-- 搜索结果下拉框 -->
                <div class="search-results" id="searchResults" style="display: none;"></div>
            </div>
            
            <div class="chat-list" id="chatList">
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                    </svg>
                    <p>暂无聊天</p>
                    <span>搜索用户开始聊天</span>
                </div>
            </div>
        </div>
        
        <!-- 右侧聊天区域 -->
        <div class="chat-area">
            <div class="chat-placeholder" id="chatPlaceholder">
                <div class="placeholder-content">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="80" height="80">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                    </svg>
                    <h2>聊天室</h2>
                    <p>选择一个聊天或搜索用户开始新对话</p>
                    <div class="features">
                        <div class="feature">
                            <span class="icon">🔒</span>
                            <span>端到端安全</span>
                        </div>
                        <div class="feature">
                            <span class="icon">⚡</span>
                            <span>实时消息</span>
                        </div>
                        <div class="feature">
                            <span class="icon">�</span>
                            <span>固定身份</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="chat-window" id="chatWindow" style="display: none;">
                <div class="chat-header">
                    <div class="chat-info">
                        <div class="avatar small">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                            </svg>
                        </div>
                        <div class="chat-target">
                            <span class="target-pid" id="targetNameDisplay">-</span>
                            <span class="status" id="onlineStatus">离线</span>
                        </div>
                    </div>
                    <button class="close-btn" onclick="closeChat()">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
                
                <div class="messages" id="messages">
                    <!-- 消息将在这里显示 -->
                </div>
                
                <div class="input-area">
                    <div class="input-tools">
                        <button class="tool-btn" onclick="toggleEmojiPanel()" title="表情">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
                            </svg>
                        </button>
                        <button class="tool-btn" onclick="selectImage()" title="图片">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                            </svg>
                        </button>
                        <button class="tool-btn" onclick="selectFile()" title="文件">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.01l1.41 1.41L11 14.84V19h2v-4.16l1.59 1.59L16 15.01 12.01 11 8 15.01z"/>
                            </svg>
                        </button>
                    </div>
                    <input type="text" id="messageInput" placeholder="输入消息..." onkeypress="handleKeyPress(event)">
                    <button onclick="sendMessage()" class="send-btn">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                        </svg>
                    </button>
                </div>
                
                <!-- 表情选择面板 -->
                <div class="emoji-panel" id="emojiPanel" style="display: none;">
                    <div class="emoji-categories" id="emojiCategories"></div>
                    <div class="emoji-list" id="emojiList"></div>
                </div>
                
                <!-- 隐藏的文件选择input -->
                <input type="file" id="imageInput" accept="image/*" style="display: none;" onchange="handleImageSelect(event)">
                <input type="file" id="fileInput" style="display: none;" onchange="handleFileSelect(event)">
            </div>
        </div>
    </div>
    
    <!-- Toast 通知 -->
    <div class="toast" id="toast"></div>
    
    <!-- 右键菜单 -->
    <div class="context-menu" id="contextMenu" style="display: none;">
        <div class="context-menu-item" onclick="doRecallMessage()">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
            </svg>
            <span>撤回消息</span>
        </div>
    </div>
    
    <!-- 图片查看大图模态框 -->
    <div class="image-modal" id="imageModal" style="display: none;" onclick="closeImageModal()">
        <div class="image-modal-content" onclick="event.stopPropagation()">
            <button class="image-modal-close" onclick="closeImageModal()">
                <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
            <img id="imageModalImg" src="" alt="大图预览">
            <div class="image-modal-info" id="imageModalInfo"></div>
        </div>
    </div>
    
    <script src="app.js"></script>
</body>
</html>
