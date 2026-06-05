// Global variables
let currentUser = null;
let myPid = null;
let myNickname = null;
let currentChatPid = null;
let chats = {};
let userInfoCache = {};
let ws = null;
let reconnectTimer = null;
let searchTimer = null;
let offlineTimers = {}; // 存储用户离线定时器
const OFFLINE_GRACE_PERIOD = 30000; // 30秒宽限期

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // 检查是否已登录
    const savedUser = localStorage.getItem('chatUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        myPid = currentUser.pid;
        myNickname = currentUser.nickname;
        showChatInterface();
    }
    
    window.addEventListener('beforeunload', function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        // 清除所有离线定时器
        Object.keys(offlineTimers).forEach(function(pid) {
            clearTimeout(offlineTimers[pid]);
        });
        offlineTimers = {};
    });
    
    // 点击外部关闭搜索结果
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.new-chat')) {
            hideSearchResults();
        }
    });
});

// 显示登录表单
function showLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

// 显示注册表单
function showRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

// 登录
async function doLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        showToast('请输入用户名和密码', 'error');
        return;
    }
    
    try {
        const response = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'userLogin',
                username: username,
                password: password
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = data.user;
            myPid = data.user.pid;
            myNickname = data.user.nickname;
            localStorage.setItem('chatUser', JSON.stringify(data.user));
            showToast('登录成功', 'success');
            showChatInterface();
        } else {
            showToast(data.error || '登录失败', 'error');
        }
    } catch (e) {
        showToast('网络错误，请重试', 'error');
    }
}

// 注册
async function doRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const nickname = document.getElementById('regNickname').value.trim();
    const password = document.getElementById('regPassword').value;
    
    if (!username || !nickname || !password) {
        showToast('请填写完整信息', 'error');
        return;
    }
    
    try {
        const response = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'userRegister',
                username: username,
                nickname: nickname,
                password: password
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('注册成功，请登录', 'success');
            document.getElementById('loginUsername').value = username;
            showLogin();
        } else {
            showToast(data.error || '注册失败', 'error');
        }
    } catch (e) {
        showToast('网络错误，请重试', 'error');
    }
}

// 退出登录
function doLogout() {
    localStorage.removeItem('chatUser');
    currentUser = null;
    myPid = null;
    myNickname = null;
    currentChatPid = null;
    
    if (ws) {
        ws.close();
        ws = null;
    }
    
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('authContainer').style.display = 'flex';
    
    // 清空表单
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regUsername').value = '';
    document.getElementById('regNickname').value = '';
    document.getElementById('regPassword').value = '';
    
    showToast('已退出登录', 'success');
}

// 显示聊天界面
function showChatInterface() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';
    
    document.getElementById('myNickname').textContent = myNickname;
    document.getElementById('myPid').textContent = myPid;
    
    // 加载历史聊天记录
    loadChatHistory();
    
    connectWebSocket();
    updateChatList();
}

// 保存聊天历史到本地存储
function saveChatHistory() {
    const history = {
        chats: chats,
        userInfoCache: userInfoCache
    };
    localStorage.setItem('chatHistory', JSON.stringify(history));
}

// 从本地存储加载聊天历史
function loadChatHistory() {
    const saved = localStorage.getItem('chatHistory');
    if (saved) {
        try {
            const history = JSON.parse(saved);
            chats = history.chats || {};
            userInfoCache = history.userInfoCache || {};
            
            // 清除在线状态，需要重新检查
            Object.keys(chats).forEach(pid => {
                chats[pid].online = false;
            });
        } catch (e) {
            chats = {};
            userInfoCache = {};
        }
    }
}

// 搜索输入处理
function handleSearchInput(event) {
    const keyword = event.target.value.trim();
    
    // 防抖
    if (searchTimer) {
        clearTimeout(searchTimer);
    }
    
    if (keyword.length > 0) {
        searchTimer = setTimeout(() => {
            doSearch();
        }, 300);
    } else {
        hideSearchResults();
    }
}

// 搜索按键处理
function handleSearchKeyPress(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        doSearch();
    }
}

// 搜索用户
async function doSearch() {
    const keyword = document.getElementById('searchInput').value.trim();
    
    if (!keyword) {
        hideSearchResults();
        return;
    }
    
    if (keyword === myPid || keyword === currentUser.username) {
        showToast('不能和自己聊天', 'error');
        return;
    }
    
    try {
        const response = await fetch(`api.php?action=search&keyword=${encodeURIComponent(keyword)}`);
        const data = await response.json();
        
        if (data.success && data.users.length > 0) {
            // 过滤掉自己
            const users = data.users.filter(u => u.pid !== myPid);
            showSearchResults(users);
        } else {
            showSearchResults([]);
        }
    } catch (e) {
        showToast('搜索失败，请重试', 'error');
    }
}

// 显示搜索结果
function showSearchResults(users) {
    const container = document.getElementById('searchResults');
    
    if (users.length === 0) {
        container.innerHTML = '<div class="search-result-item empty">未找到相关用户</div>';
        container.style.display = 'block';
        return;
    }
    
    // 缓存用户信息
    users.forEach(user => {
        userInfoCache[user.pid] = user;
    });
    
    container.innerHTML = users.map(user => {
        const onlineClass = user.online ? 'online' : 'offline';
        const matchLabel = {
            'pid': 'PID',
            'username': '用户名',
            'nickname': '昵称'
        }[user.matchType] || '';
        
        return `<div class="search-result-item" onclick="selectSearchResult('${user.pid}')">
            <div class="avatar small">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
            </div>
            <div class="result-info">
                <div class="result-name">${escapeHtml(user.nickname)} <span class="status-indicator ${onlineClass}"></span></div>
                <div class="result-sub">@${escapeHtml(user.username)} · ${matchLabel}匹配</div>
            </div>
            <div class="result-pid">${user.pid.substring(0, 8)}...</div>
        </div>`;
    }).join('');
    
    container.style.display = 'block';
}

// 隐藏搜索结果
function hideSearchResults() {
    document.getElementById('searchResults').style.display = 'none';
}

// 选择搜索结果
function selectSearchResult(pid) {
    hideSearchResults();
    document.getElementById('searchInput').value = '';
    startChatWithPid(pid);
}

// 开始聊天
function startChatWithPid(pid) {
    if (pid === myPid) {
        showToast('不能和自己聊天', 'error');
        return;
    }
    
    if (!chats[pid]) {
        chats[pid] = {
            messages: [],
            unread: 0,
            lastMessage: '',
            lastTime: null,
            online: false
        };
    }
    
    // 获取用户信息
    if (!userInfoCache[pid]) {
        fetch(`api.php?action=getUser&pid=${pid}`)
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    userInfoCache[pid] = data.user;
                    chats[pid].online = data.user.online;
                    updateChatList();
                    saveChatHistory();
                }
            });
    }
    
    openChat(pid);
    updateChatList();
    saveChatHistory();
}

// Connect WebSocket
function connectWebSocket() {
    const wsUrl = 'ws://' + window.location.hostname + ':9000';
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
        if (myPid) {
            ws.send(JSON.stringify({
                type: 'register',
                pid: myPid
            }));
        }
    };
    
    ws.onmessage = function(event) {
        handleWebSocketMessage(JSON.parse(event.data));
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = function() {
        console.log('WebSocket closed, reconnecting...');
        reconnectTimer = setTimeout(connectWebSocket, 5000);
    };
}

// Handle WebSocket message
function handleWebSocketMessage(data) {
    var type = data.type;
    
    switch (type) {
        case 'registered':
            console.log('Registered successfully');
            // 检查所有聊天用户的在线状态
            Object.keys(chats).forEach(pid => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'checkStatus',
                        pid: pid
                    }));
                }
            });
            break;
            
        case 'message':
            var chatPid = data.from;
            
            if (!chats[chatPid]) {
                chats[chatPid] = { messages: [], unread: 0, lastMessage: '', lastTime: null, online: false };
            }
            
            var msg = {
                from: data.from,
                to: data.to,
                text: data.text,
                time: data.time
            };
            
            chats[chatPid].messages.push(msg);
            chats[chatPid].lastMessage = data.text;
            chats[chatPid].lastTime = data.time;
            
            if (chatPid !== currentChatPid) {
                chats[chatPid].unread++;
            }
            
            // 获取发送者信息
            if (!userInfoCache[chatPid]) {
                fetch(`api.php?action=getUser&pid=${chatPid}`)
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            userInfoCache[chatPid] = result.user;
                            updateChatList();
                        }
                    });
            }
            
            updateChatList();
            saveChatHistory();
            
            if (currentChatPid === chatPid) {
                renderMessages();
            }
            break;
            
        case 'sent':
            if (!data.online) {
                // 检查是否在30秒缓冲期内
                if (offlineTimers[currentChatPid]) {
                    // 在缓冲期内，不立即提示，只显示临时提示
                    showToast('对方暂时离线，消息可能无法送达', 'warning');
                } else {
                    // 已确认离线，显示无法送达
                    var systemMsg = {
                        type: 'system',
                        text: '对方已经离开，消息无法送达',
                        time: Date.now()
                    };
                    if (currentChatPid && chats[currentChatPid]) {
                        chats[currentChatPid].messages.push(systemMsg);
                        renderMessages();
                    }
                    showToast('对方已经离开', 'error');
                }
            }
            break;
            
        case 'userStatus':
            updateUserStatus(data.pid, data.online);
            break;
            
        case 'status':
            updateUserStatus(data.pid, data.online);
            break;
            
        case 'pong':
            break;
    }
}

// Update user status
function updateUserStatus(pid, online) {
    if (chats[pid]) {
        const wasOnline = chats[pid].online;
        chats[pid].online = online;
        
        if (userInfoCache[pid]) {
            userInfoCache[pid].online = online;
        }
        
        if (pid === currentChatPid) {
            var statusEl = document.getElementById('onlineStatus');
            if (statusEl) {
                statusEl.textContent = online ? '在线' : '离线';
                statusEl.style.color = online ? 'var(--success-color)' : 'var(--text-muted)';
            }
        }
        
        if (wasOnline && !online) {
            // 用户从在线变为离线，启动30秒缓冲定时器
            if (offlineTimers[pid]) {
                clearTimeout(offlineTimers[pid]);
            }
            offlineTimers[pid] = setTimeout(function() {
                // 30秒后检查用户是否仍离线
                if (chats[pid] && !chats[pid].online) {
                    var systemMsg = {
                        type: 'system',
                        text: '对方已离开',
                        time: Date.now()
                    };
                    chats[pid].messages.push(systemMsg);
                    if (pid === currentChatPid) {
                        renderMessages();
                    }
                    saveChatHistory();
                }
                delete offlineTimers[pid];
            }, OFFLINE_GRACE_PERIOD);
        } else if (!wasOnline && online) {
            // 用户从离线变为在线，清除缓冲定时器
            if (offlineTimers[pid]) {
                clearTimeout(offlineTimers[pid]);
                delete offlineTimers[pid];
            }
        }
        
        updateChatList();
        saveChatHistory();
    }
}

// 获取用户显示名称
function getUserDisplayName(pid) {
    if (userInfoCache[pid]) {
        return userInfoCache[pid].nickname;
    }
    return pid.substring(0, 8) + '...';
}

// Copy PID
function copyPid() {
    navigator.clipboard.writeText(myPid).then(function() {
        showToast('PID已复制到剪贴板', 'success');
    }).catch(function() {
        var input = document.createElement('input');
        input.value = myPid;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('PID已复制到剪贴板', 'success');
    });
}

// Update chat list
function updateChatList() {
    var chatList = document.getElementById('chatList');
    var pids = Object.keys(chats);
    
    if (pids.length === 0) {
        chatList.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg><p>暂无聊天</p><span>搜索用户开始聊天</span></div>';
        return;
    }
    
    pids.sort(function(a, b) {
        var timeA = chats[a].lastTime || 0;
        var timeB = chats[b].lastTime || 0;
        return timeB - timeA;
    });
    
    chatList.innerHTML = pids.map(function(pid) {
        var chat = chats[pid];
        var isActive = pid === currentChatPid;
        var timeStr = chat.lastTime ? formatTime(chat.lastTime) : '';
        var displayName = getUserDisplayName(pid);
        var onlineClass = chat.online ? 'status-online' : 'status-offline';
        
        return '<div class="chat-item ' + (isActive ? 'active' : '') + '" onclick="openChat(\'' + pid + '\')">' +
            '<div class="avatar small ' + onlineClass + '"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>' +
            '<div class="chat-item-info">' +
            '<div class="chat-item-pid">' + escapeHtml(displayName) + '</div>' +
            '<div class="chat-item-preview">' + escapeHtml(chat.lastMessage || '开始聊天') + '</div>' +
            '</div>' +
            '<div class="chat-item-meta">' +
            '<span class="chat-item-time">' + timeStr + '</span>' +
            (chat.unread > 0 ? '<span class="unread-badge">' + chat.unread + '</span>' : '') +
            '</div>' +
            '</div>';
    }).join('');
}

// Open chat window
function openChat(pid) {
    currentChatPid = pid;
    
    if (chats[pid]) {
        chats[pid].unread = 0;
    }
    
    document.getElementById('chatPlaceholder').style.display = 'none';
    document.getElementById('chatWindow').style.display = 'flex';
    document.getElementById('targetNameDisplay').textContent = getUserDisplayName(pid);
    
    // 更新在线状态显示
    var statusEl = document.getElementById('onlineStatus');
    var online = chats[pid] ? chats[pid].online : false;
    statusEl.textContent = online ? '在线' : '离线';
    statusEl.style.color = online ? 'var(--success-color)' : 'var(--text-muted)';
    
    // 检查在线状态
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'checkStatus',
            pid: pid
        }));
    }
    
    renderMessages();
    updateChatList();
    saveChatHistory();
    document.getElementById('messageInput').focus();
}

// Close chat window
function closeChat() {
    currentChatPid = null;
    document.getElementById('chatPlaceholder').style.display = 'flex';
    document.getElementById('chatWindow').style.display = 'none';
    updateChatList();
}

// Render messages
function renderMessages() {
    var container = document.getElementById('messages');
    
    if (!currentChatPid || !chats[currentChatPid]) {
        container.innerHTML = '';
        return;
    }
    
    var messages = chats[currentChatPid].messages;
    var displayName = getUserDisplayName(currentChatPid);
    
    if (messages.length === 0) {
        container.innerHTML = '<div class="system-message"><span>开始与 ' + escapeHtml(displayName) + ' 聊天</span></div>';
        return;
    }
    
    container.innerHTML = messages.map(function(msg) {
        if (msg.type === 'system') {
            return '<div class="system-message warning"><span>' + escapeHtml(msg.text) + '</span></div>';
        }
        
        var isSent = msg.from === myPid;
        var timeStr = formatTime(msg.time);
        var senderName = isSent ? myNickname : getUserDisplayName(msg.from);
        
        return '<div class="message ' + (isSent ? 'sent' : 'received') + '">' +
            '<div class="avatar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>' +
            '<div class="message-content">' +
            '<div class="message-sender">' + escapeHtml(senderName) + '</div>' +
            '<div class="message-bubble">' + escapeHtml(msg.text) + '</div>' +
            '<span class="message-time">' + timeStr + '</span>' +
            '</div>' +
            '</div>';
    }).join('');
    
    container.scrollTop = container.scrollHeight;
}

// Send message
function sendMessage() {
    var input = document.getElementById('messageInput');
    var text = input.value.trim();
    
    if (!text || !currentChatPid) return;
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('连接已断开，请刷新页面', 'error');
        return;
    }
    
    var message = {
        from: myPid,
        to: currentChatPid,
        text: text,
        time: Date.now()
    };
    
    if (!chats[currentChatPid]) {
        chats[currentChatPid] = { messages: [], unread: 0, lastMessage: '', lastTime: null, online: false };
    }
    chats[currentChatPid].messages.push(message);
    chats[currentChatPid].lastMessage = text;
    chats[currentChatPid].lastTime = message.time;
    
    input.value = '';
    
    renderMessages();
    updateChatList();
    saveChatHistory();
    
    ws.send(JSON.stringify({
        type: 'send',
        from: message.from,
        to: message.to,
        text: message.text,
        time: message.time
    }));
}

// Handle enter key
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// Format time
function formatTime(timestamp) {
    var date = new Date(timestamp);
    var now = new Date();
    var diff = now - date;
    
    if (diff < 60000) {
        return '刚刚';
    } else if (diff < 3600000) {
        return Math.floor(diff / 60000) + '分钟前';
    } else if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else {
        return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
}

// HTML escape
function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show toast
function showToast(message, type) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + (type || '');
    
    setTimeout(function() { toast.classList.add('show'); }, 10);
    
    setTimeout(function() {
        toast.classList.remove('show');
    }, 3000);
}
