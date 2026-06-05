let currentUser = null;
let myPid = null;
let myNickname = null;
let authToken = null;
let currentChatPid = null;
let chats = {};
let userInfoCache = {};
let ws = null;
let reconnectTimer = null;
let searchTimer = null;
let offlineTimers = {};
let pendingMessages = {};
const OFFLINE_GRACE_PERIOD = 30000;
const RECALL_TIME_LIMIT = 120000;
let contextMenuTargetMessageId = null;
let emojis = [];
let emojiCategories = [];
let currentEmojiCategory = null;

async function apiRequest(action, options = {}) {
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (authToken) {
        headers['Authorization'] = 'Bearer ' + authToken;
    }

    const url = 'api.php?action=' + action + (authToken ? '&token=' + authToken : '');
    
    try {
        const response = await fetch(url, {
            headers: headers,
            ...options
        });

        if (response.status === 401) {
            handleAuthFailure();
            return null;
        }

        const data = await response.json();
        return data;
    } catch (e) {
        console.error('API request failed:', e);
        return { success: false, error: '网络错误' };
    }
}

async function apiPost(action, body = {}) {
    return apiRequest(action, {
        method: 'POST',
        body: JSON.stringify({ ...body, token: authToken })
    });
}

async function apiGet(action, params = {}) {
    let queryString = '';
    if (Object.keys(params).length > 0) {
        queryString = '&' + new URLSearchParams(params).toString();
    }
    return apiRequest(action + queryString, {
        method: 'GET'
    });
}

function handleAuthFailure() {
    showToast('登录已过期，请重新登录', 'error');
    clearAuthData();
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('authContainer').style.display = 'flex';
}

function saveAuthData(user, token) {
    currentUser = user;
    myPid = user.pid;
    myNickname = user.nickname;
    authToken = token;
    
    localStorage.setItem('chatUser', JSON.stringify(user));
    localStorage.setItem('authToken', token);
}

function saveCurrentChatPid() {
    if (currentChatPid) {
        localStorage.setItem('currentChatPid', currentChatPid);
    } else {
        localStorage.removeItem('currentChatPid');
    }
}

function restoreCurrentChatPid() {
    const saved = localStorage.getItem('currentChatPid');
    if (saved && saved !== 'null' && saved !== 'undefined') {
        currentChatPid = saved;
        return true;
    }
    return false;
}

function clearAuthData() {
    currentUser = null;
    myPid = null;
    myNickname = null;
    authToken = null;
    currentChatPid = null;
    chats = {};
    userInfoCache = {};
    pendingMessages = {};
    
    localStorage.removeItem('chatUser');
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentChatPid');
}

async function verifyAndRestoreSession() {
    const savedToken = localStorage.getItem('authToken');
    
    if (!savedToken) {
        return false;
    }
    
    authToken = savedToken;
    
    try {
        const result = await apiGet('verifyToken');
        if (result && result.success) {
            currentUser = result.user;
            myPid = result.user.pid;
            myNickname = result.user.nickname;
            
            localStorage.setItem('chatUser', JSON.stringify(result.user));
            return true;
        } else {
            clearAuthData();
            return false;
        }
    } catch (e) {
        clearAuthData();
        return false;
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    const sessionRestored = await verifyAndRestoreSession();
    
    if (sessionRestored) {
        showChatInterface();
    } else {
        clearAuthData();
        document.getElementById('chatContainer').style.display = 'none';
        document.getElementById('authContainer').style.display = 'flex';
    }

    window.addEventListener('beforeunload', function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        Object.keys(offlineTimers).forEach(function(pid) {
            clearTimeout(offlineTimers[pid]);
        });
        offlineTimers = {};
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.new-chat')) {
            hideSearchResults();
        }
        if (!e.target.closest('#contextMenu')) {
            hideContextMenu();
        }
    });

    document.addEventListener('contextmenu', function(e) {
        if (!e.target.closest('.message')) {
            hideContextMenu();
        }
    });
});

function showLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

async function doLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        showToast('请输入用户名和密码', 'error');
        return;
    }

    const data = await apiPost('userLogin', {
        username: username,
        password: password
    });

    if (!data) return;

    if (data.success) {
        saveAuthData(data.user, data.token);
        showToast('登录成功', 'success');
        showChatInterface();
    } else {
        showToast(data.error || '登录失败', 'error');
    }
}

async function doRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const nickname = document.getElementById('regNickname').value.trim();
    const password = document.getElementById('regPassword').value;

    if (!username || !nickname || !password) {
        showToast('请填写完整信息', 'error');
        return;
    }

    const data = await apiPost('userRegister', {
        username: username,
        nickname: nickname,
        password: password
    });

    if (!data) return;

    if (data.success) {
        showToast('注册成功，请登录', 'success');
        document.getElementById('loginUsername').value = username;
        showLogin();
    } else {
        showToast(data.error || '注册失败', 'error');
    }
}

async function doLogout() {
    if (authToken) {
        await apiPost('logout', { pid: myPid });
    }

    if (ws) {
        ws.close();
        ws = null;
    }

    clearAuthData();

    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('authContainer').style.display = 'flex';

    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regUsername').value = '';
    document.getElementById('regNickname').value = '';
    document.getElementById('regPassword').value = '';

    showToast('已退出登录', 'success');
}

async function showChatInterface() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';

    document.getElementById('myNickname').textContent = myNickname;
    document.getElementById('myPid').textContent = myPid;

    restoreCurrentChatPid();
    await loadAllData();
    await loadEmojis();
    
    if (currentChatPid && chats[currentChatPid]) {
        document.getElementById('chatPlaceholder').style.display = 'none';
        document.getElementById('chatWindow').style.display = 'flex';
        document.getElementById('targetNameDisplay').textContent = getUserDisplayName(currentChatPid);
        const statusEl = document.getElementById('onlineStatus');
        const online = chats[currentChatPid] ? chats[currentChatPid].online : false;
        statusEl.textContent = online ? '在线' : '离线';
        statusEl.style.color = online ? 'var(--success-color)' : 'var(--text-muted)';
        renderMessages();
        await markAsRead(currentChatPid);
    }
    
    updateChatList();
    connectWebSocket();
    
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.emoji-panel') && !e.target.closest('.tool-btn[onclick="toggleEmojiPanel()"]')) {
            hideEmojiPanel();
        }
    });
}

async function loadAllData() {
    await loadConversations();
    if (currentChatPid && chats[currentChatPid]) {
        const messages = await loadConversationMessages(currentChatPid);
        chats[currentChatPid].messages = messages;
        renderMessages();
    }
    updateChatList();
}

async function loadConversations() {
    const data = await apiGet('getConversations', { pid: myPid });
    
    if (!data || !data.success) {
        showToast('加载会话失败', 'error');
        return;
    }

    chats = {};
    userInfoCache = {};
    pendingMessages = {};

    for (const conv of data.conversations) {
        const otherPid = conv.other_pid;
        userInfoCache[otherPid] = {
            pid: otherPid,
            nickname: conv.other_nickname,
            username: conv.other_username,
            online: conv.is_online
        };

        const messages = await loadConversationMessages(otherPid);

        chats[otherPid] = {
            messages: messages,
            unread: conv.unread_count || 0,
            lastMessage: conv.last_message || '',
            lastTime: conv.last_time_timestamp || null,
            online: conv.is_online,
            conversationId: conv.conversation_id
        };
    }

    updateChatList();
}

async function loadConversationMessages(otherPid) {
    const data = await apiGet('getConversationMessages', {
        pid: myPid,
        otherPid: otherPid
    });

    if (data && data.success && data.messages) {
        return data.messages;
    }
    return [];
}

function handleSearchInput(event) {
    const keyword = event.target.value.trim();

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

function handleSearchKeyPress(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        doSearch();
    }
}

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

    const data = await apiGet('search', { keyword: keyword });

    if (!data) return;

    if (data.success && data.users.length > 0) {
        const users = data.users.filter(u => u.pid !== myPid);
        showSearchResults(users);
    } else {
        showSearchResults([]);
    }
}

function showSearchResults(users) {
    const container = document.getElementById('searchResults');

    if (users.length === 0) {
        container.innerHTML = '<div class="search-result-item empty">未找到相关用户</div>';
        container.style.display = 'block';
        return;
    }

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

function hideSearchResults() {
    document.getElementById('searchResults').style.display = 'none';
}

function selectSearchResult(pid) {
    hideSearchResults();
    document.getElementById('searchInput').value = '';
    startChatWithPid(pid);
}

async function startChatWithPid(pid) {
    if (pid === myPid) {
        showToast('不能和自己聊天', 'error');
        return;
    }

    if (!chats[pid]) {
        const messages = await loadConversationMessages(pid);
        const unreadCount = await getUnreadCount(pid);

        chats[pid] = {
            messages: messages,
            unread: unreadCount,
            lastMessage: messages.length > 0 ? messages[messages.length - 1].text : '',
            lastTime: messages.length > 0 ? messages[messages.length - 1].time : null,
            online: false
        };
    }

    if (!userInfoCache[pid]) {
        const result = await apiGet('getUser', { pid: pid });
        if (result && result.success) {
            userInfoCache[pid] = result.user;
            chats[pid].online = result.user.online;
            updateChatList();
        }
    }

    openChat(pid);
    updateChatList();
}

function connectWebSocket() {
    const wsUrl = 'ws://' + window.location.hostname + ':9000';
    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
        console.log('WebSocket connected');
        if (myPid && authToken) {
            ws.send(JSON.stringify({
                type: 'register',
                pid: myPid,
                token: authToken
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

function handleWebSocketMessage(data) {
    const type = data.type;

    switch (type) {
        case 'registered':
            console.log('Registered successfully');
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
            handleIncomingMessage(data);
            break;

        case 'sent':
            handleSentConfirmation(data);
            break;

        case 'messagesRead':
            handleMessagesRead(data);
            break;

        case 'userStatus':
            updateUserStatus(data.pid, data.online);
            break;

        case 'status':
            updateUserStatus(data.pid, data.online);
            break;

        case 'pong':
            break;

        case 'recall':
            handleRecallMessage(data);
            break;

        case 'recallError':
            handleRecallError(data);
            break;

        case 'registerError':
            showToast(data.error || 'WebSocket鉴权失败', 'error');
            console.error('WebSocket registration error:', data.error);
            break;

        case 'error':
            showToast(data.error || '操作失败', 'error');
            console.error('WebSocket error:', data.error);
            break;
    }
}

function handleIncomingMessage(data) {
    const chatPid = data.from;

    if (!chats[chatPid]) {
        chats[chatPid] = {
            messages: [],
            unread: 0,
            lastMessage: '',
            lastTime: null,
            online: false
        };
    }

    const msg = {
        id: data.messageId,
        from: data.from,
        to: data.to,
        text: data.text,
        time: data.time,
        status: data.status || 'delivered',
        message_type: data.message_type || 'text'
    };

    if (data.message_type === 'emoji') {
        msg.emoji_code = data.emoji_code;
        msg.emoji_name = data.emoji_name;
        msg.text = data.text;
    } else if (data.message_type === 'image' || data.message_type === 'file') {
        msg.file_path = data.file_path;
        msg.file_name = data.file_name;
        msg.file_size = data.file_size;
        msg.file_mime = data.file_mime;
    }

    chats[chatPid].messages.push(msg);
    
    if (data.message_type === 'emoji') {
        chats[chatPid].lastMessage = '[表情]';
    } else if (data.message_type === 'image') {
        chats[chatPid].lastMessage = '[图片]';
    } else if (data.message_type === 'file') {
        chats[chatPid].lastMessage = '[文件] ' + (data.file_name || '');
    } else {
        chats[chatPid].lastMessage = data.text;
    }
    chats[chatPid].lastTime = data.time;

    if (chatPid !== currentChatPid) {
        chats[chatPid].unread++;
    } else {
        markAsRead(chatPid);
    }

    if (!userInfoCache[chatPid]) {
        apiGet('getUser', { pid: chatPid }).then(result => {
            if (result && result.success) {
                userInfoCache[chatPid] = result.user;
                updateChatList();
            }
        });
    }

    updateChatList();

    if (currentChatPid === chatPid) {
        renderMessages();
    }
}

function handleSentConfirmation(data) {
    const toPid = data.to;
    const messageId = data.messageId;

    if (toPid && chats[toPid]) {
        for (let i = chats[toPid].messages.length - 1; i >= 0; i--) {
            const msg = chats[toPid].messages[i];
            if (msg.from === myPid && (!msg.id || !msg.status)) {
                msg.id = messageId;
                msg.status = data.status || 'sent';
                break;
            }
        }

        if (currentChatPid === toPid) {
            renderMessages();
        }
        updateChatList();
    }

    if (!data.online) {
        showToast(data.info || '对方离线，消息已保存，对方上线后可查看', 'info');
    }
}

function handleMessagesRead(data) {
    const readerPid = data.readerPid;
    if (chats[readerPid]) {
        chats[readerPid].messages.forEach(msg => {
            if (msg.from === myPid && msg.status !== 'read') {
                msg.status = 'read';
            }
        });

        if (currentChatPid === readerPid) {
            renderMessages();
        }
        updateChatList();
    }
}

function handleRecallMessage(data) {
    const messageId = data.messageId;
    const fromPid = data.from;
    const toPid = data.to;

    const chatPid = fromPid === myPid ? toPid : fromPid;

    if (chats[chatPid]) {
        chats[chatPid].messages.forEach(msg => {
            if (msg.id === messageId) {
                msg.status = 'recalled';
                msg.text = '该消息已撤回';
            }
        });

        if (chats[chatPid].messages.length > 0) {
            const lastMsg = chats[chatPid].messages[chats[chatPid].messages.length - 1];
            if (lastMsg.id === messageId) {
                chats[chatPid].lastMessage = '该消息已撤回';
            }
        }

        if (currentChatPid === chatPid) {
            renderMessages();
        }
        updateChatList();
    }

    if (fromPid === myPid) {
        showToast('消息已撤回', 'success');
    } else {
        showToast('对方撤回了一条消息', 'info');
    }
}

function handleRecallError(data) {
    showToast(data.error || '撤回失败', 'error');
}

async function recallMessage(messageId) {
    if (!messageId) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'recall',
            messageId: messageId
        }));
    } else {
        const data = await apiPost('recallMessage', {
            messageId: messageId
        });

        if (data && data.success) {
            handleRecallMessage({
                messageId: messageId,
                from: data.message.from_pid,
                to: data.message.to_pid,
                time: Date.now()
            });
        } else if (data) {
            showToast(data.error || '撤回失败', 'error');
        }
    }
}

function canRecallMessage(msg) {
    if (!msg || !msg.id) return false;
    if (msg.from !== myPid) return false;
    if (msg.status === 'recalled') return false;
    
    const timeDiff = Date.now() - msg.time;
    return timeDiff <= RECALL_TIME_LIMIT;
}

function showContextMenu(e, messageId) {
    e.preventDefault();
    
    if (!currentChatPid || !chats[currentChatPid]) return;
    
    const msg = chats[currentChatPid].messages.find(m => m.id === messageId);
    if (!msg || !canRecallMessage(msg)) {
        hideContextMenu();
        return;
    }
    
    contextMenuTargetMessageId = messageId;
    
    const menu = document.getElementById('contextMenu');
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.style.display = 'block';
}

function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (menu) {
        menu.style.display = 'none';
    }
    contextMenuTargetMessageId = null;
}

function doRecallMessage() {
    if (contextMenuTargetMessageId) {
        recallMessage(contextMenuTargetMessageId);
    }
    hideContextMenu();
}

function updateUserStatus(pid, online) {
    if (chats[pid]) {
        const wasOnline = chats[pid].online;
        chats[pid].online = online;

        if (userInfoCache[pid]) {
            userInfoCache[pid].online = online;
        }

        if (pid === currentChatPid) {
            const statusEl = document.getElementById('onlineStatus');
            if (statusEl) {
                statusEl.textContent = online ? '在线' : '离线';
                statusEl.style.color = online ? 'var(--success-color)' : 'var(--text-muted)';
            }
        }

        if (wasOnline && !online) {
            if (offlineTimers[pid]) {
                clearTimeout(offlineTimers[pid]);
            }
            offlineTimers[pid] = setTimeout(function() {
                if (chats[pid] && !chats[pid].online) {
                    const systemMsg = {
                        type: 'system',
                        text: '对方已离开',
                        time: Date.now()
                    };
                    chats[pid].messages.push(systemMsg);
                    if (pid === currentChatPid) {
                        renderMessages();
                    }
                }
                delete offlineTimers[pid];
            }, OFFLINE_GRACE_PERIOD);
        } else if (!wasOnline && online) {
            if (offlineTimers[pid]) {
                clearTimeout(offlineTimers[pid]);
                delete offlineTimers[pid];
            }
            
            if (wasOnline === false && chats[pid].messages.length > 0) {
                apiGet('getConversationMessages', {
                    pid: myPid,
                    otherPid: pid
                }).then(result => {
                    if (result && result.success && result.messages) {
                        chats[pid].messages = result.messages;
                        if (pid === currentChatPid) {
                            renderMessages();
                        }
                    }
                });
            }
        }

        updateChatList();
    }
}

function getUserDisplayName(pid) {
    if (!pid) {
        return '未知用户';
    }
    if (userInfoCache[pid]) {
        return userInfoCache[pid].nickname;
    }
    return pid.substring(0, 8) + '...';
}

function copyPid() {
    navigator.clipboard.writeText(myPid).then(function() {
        showToast('PID已复制到剪贴板', 'success');
    }).catch(function() {
        const input = document.createElement('input');
        input.value = myPid;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('PID已复制到剪贴板', 'success');
    });
}

function updateChatList() {
    const chatList = document.getElementById('chatList');
    const pids = Object.keys(chats);

    if (pids.length === 0) {
        chatList.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg><p>暂无聊天</p><span>搜索用户开始聊天</span></div>';
        return;
    }

    pids.sort(function(a, b) {
        const timeA = chats[a].lastTime || 0;
        const timeB = chats[b].lastTime || 0;
        return timeB - timeA;
    });

    chatList.innerHTML = pids.map(function(pid) {
        const chat = chats[pid];
        const isActive = pid === currentChatPid;
        const timeStr = chat.lastTime ? formatTime(chat.lastTime) : '';
        const displayName = getUserDisplayName(pid);
        const onlineClass = chat.online ? 'status-online' : 'status-offline';
        const lastMessageStatus = chat.last_message_status;
        const lastMessageFrom = chat.last_message_from;
        
        let statusIndicator = '';
        if (lastMessageFrom === myPid && lastMessageStatus) {
            const statusText = lastMessageStatus === 'read' ? '已读' : 
                             lastMessageStatus === 'delivered' ? '已送达' : '已发送';
            const statusClass = lastMessageStatus === 'read' ? 'status-read' : 
                               lastMessageStatus === 'delivered' ? 'status-delivered' : 'status-sent';
            statusIndicator = `<span class="message-status ${statusClass}">${statusText}</span>`;
        }

        return '<div class="chat-item ' + (isActive ? 'active' : '') + '" onclick="openChat(\'' + pid + '\')">' +
            '<div class="avatar small ' + onlineClass + '"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>' +
            '<div class="chat-item-info">' +
            '<div class="chat-item-pid">' + escapeHtml(displayName) + '</div>' +
            '<div class="chat-item-preview">' + escapeHtml(chat.lastMessage || '开始聊天') + ' ' + statusIndicator + '</div>' +
            '</div>' +
            '<div class="chat-item-meta">' +
            '<span class="chat-item-time">' + timeStr + '</span>' +
            (chat.unread > 0 ? '<span class="unread-badge">' + chat.unread + '</span>' : '') +
            '</div>' +
            '</div>';
    }).join('');
}

async function openChat(pid) {
    currentChatPid = pid;
    saveCurrentChatPid();

    if (chats[pid]) {
        chats[pid].unread = 0;
    }

    document.getElementById('chatPlaceholder').style.display = 'none';
    document.getElementById('chatWindow').style.display = 'flex';
    document.getElementById('targetNameDisplay').textContent = getUserDisplayName(pid);

    const statusEl = document.getElementById('onlineStatus');
    const online = chats[pid] ? chats[pid].online : false;
    statusEl.textContent = online ? '在线' : '离线';
    statusEl.style.color = online ? 'var(--success-color)' : 'var(--text-muted)';

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'checkStatus',
            pid: pid
        }));
    }

    const messages = await loadConversationMessages(pid);
    if (chats[pid]) {
        chats[pid].messages = messages;
    }

    renderMessages();
    updateChatList();
    document.getElementById('messageInput').focus();

    await markAsRead(pid);
}

function closeChat() {
    currentChatPid = null;
    saveCurrentChatPid();
    document.getElementById('chatPlaceholder').style.display = 'flex';
    document.getElementById('chatWindow').style.display = 'none';
    updateChatList();
}

function renderMessages() {
    const container = document.getElementById('messages');

    if (!currentChatPid || !chats[currentChatPid]) {
        container.innerHTML = '';
        return;
    }

    const messages = chats[currentChatPid].messages;
    const displayName = getUserDisplayName(currentChatPid);

    if (messages.length === 0) {
        container.innerHTML = '<div class="system-message"><span>开始与 ' + escapeHtml(displayName) + ' 聊天</span></div>';
        return;
    }

    container.innerHTML = messages.map(function(msg) {
        if (msg.type === 'system') {
            return '<div class="system-message warning"><span>' + escapeHtml(msg.text) + '</span></div>';
        }

        const isSent = msg.from === myPid;
        const timeStr = formatTime(msg.time);
        const senderName = isSent ? myNickname : getUserDisplayName(msg.from);
        const isRecalled = msg.status === 'recalled';
        let statusHtml = '';
        let messageClass = isSent ? 'sent' : 'received';
        let contextMenuHandler = '';
        let messageContent = '';
        const messageType = msg.message_type || 'text';

        if (isRecalled) {
            messageClass += ' recalled';
            statusHtml = '<span class="message-status status-recalled">已撤回</span>';
            messageContent = '<div class="message-bubble">' + escapeHtml(msg.text) + '</div>';
        } else {
            if (messageType === 'emoji') {
                messageContent = `<div class="message-bubble emoji-bubble" title="${escapeHtml(msg.emoji_name || '')}">${msg.text}</div>`;
            } else if (messageType === 'image') {
                const imageUrl = msg.file_path ? encodeURI(msg.file_path) : '';
                const imageName = msg.file_name || '图片';
                messageContent = `
                    <div class="message-image" onclick="openImageModal('${imageUrl}', '${escapeHtml(imageName)}')" title="点击查看大图">
                        <img src="${imageUrl}" alt="${escapeHtml(imageName)}" loading="lazy">
                    </div>
                `;
            } else if (messageType === 'file') {
                const fileIcon = getFileIconHtml(msg.file_mime);
                const fileSize = formatFileSizeHtml(msg.file_size);
                const fileUrl = msg.file_path ? encodeURI(msg.file_path) : '';
                const fileName = msg.file_name || '文件';
                messageContent = `
                    <div class="message-file" onclick="downloadFile('${fileUrl}', '${escapeHtml(fileName)}')" title="点击下载">
                        <div class="message-file-icon">${fileIcon}</div>
                        <div class="message-file-info">
                            <div class="message-file-name">${escapeHtml(fileName)}</div>
                            <div class="message-file-size">${fileSize}</div>
                        </div>
                    </div>
                `;
            } else {
                messageContent = '<div class="message-bubble">' + escapeHtml(msg.text) + '</div>';
            }

            if (isSent && msg.status) {
                let statusText = '';
                let statusClass = '';
                if (msg.status === 'sent') {
                    statusText = '已发送';
                    statusClass = 'status-sent';
                } else if (msg.status === 'delivered') {
                    statusText = '已送达';
                    statusClass = 'status-delivered';
                } else if (msg.status === 'read') {
                    statusText = '已读';
                    statusClass = 'status-read';
                }
                statusHtml = `<span class="message-status ${statusClass}">${statusText}</span>`;
            }
        }

        let recallBtn = '';
        if (msg.id && canRecallMessage(msg)) {
            contextMenuHandler = ` oncontextmenu="showContextMenu(event, '${msg.id}')"`;
            recallBtn = `<button class="recall-btn" onclick="recallMessage('${msg.id}')" title="撤回消息">
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
                </svg>
            </button>`;
        }

        return '<div class="message ' + messageClass + '" data-message-id="' + (msg.id || '') + '"' + contextMenuHandler + '>' +
            '<div class="avatar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>' +
            '<div class="message-content">' +
            '<div class="message-sender">' + escapeHtml(senderName) + '</div>' +
            messageContent +
            '<div class="message-meta">' +
            '<span class="message-time">' + timeStr + '</span>' +
            statusHtml +
            recallBtn +
            '</div>' +
            '</div>' +
            '</div>';
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function sendMessage(messageType = 'text', extraData = {}) {
    const input = document.getElementById('messageInput');
    let text = '';
    
    if (messageType === 'text') {
        text = input.value.trim();
        if (!text) return;
    } else if (messageType === 'emoji') {
        text = extraData.emoji_url || '';
    } else if (messageType === 'image' || messageType === 'file') {
        text = extraData.displayText || '';
    }

    if (!currentChatPid) return;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('连接已断开，正在重连...', 'warning');
        return;
    }

    const message = {
        from: myPid,
        to: currentChatPid,
        text: text,
        time: Date.now(),
        message_type: messageType,
        ...extraData
    };

    if (!chats[currentChatPid]) {
        chats[currentChatPid] = { messages: [], unread: 0, lastMessage: '', lastTime: null, online: false };
    }

    const tempMsg = {
        from: message.from,
        to: message.to,
        text: message.text,
        time: message.time,
        status: 'sent',
        message_type: messageType,
        ...extraData
    };

    chats[currentChatPid].messages.push(tempMsg);
    
    if (messageType === 'emoji') {
        chats[currentChatPid].lastMessage = '[表情]';
    } else if (messageType === 'image') {
        chats[currentChatPid].lastMessage = '[图片]';
    } else if (messageType === 'file') {
        chats[currentChatPid].lastMessage = '[文件] ' + (extraData.file_name || '');
    } else {
        chats[currentChatPid].lastMessage = text;
    }
    chats[currentChatPid].lastTime = message.time;

    if (messageType === 'text') {
        input.value = '';
    }

    renderMessages();
    updateChatList();

    ws.send(JSON.stringify({
        type: 'send',
        from: message.from,
        to: message.to,
        text: message.text,
        time: message.time,
        message_type: messageType,
        ...extraData
    }));

    apiPost('send', { message: message });
}

async function markAsRead(otherPid) {
    if (!myPid || !otherPid) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'markAsRead',
            userPid: myPid,
            otherPid: otherPid
        }));
    }

    const data = await apiPost('markAsRead', {
        userPid: myPid,
        otherPid: otherPid
    });

    if (data && data.success && chats[otherPid]) {
        chats[otherPid].messages.forEach(msg => {
            if (msg.to === myPid && msg.status !== 'read') {
                msg.status = 'read';
            }
        });
        chats[otherPid].unread = 0;
        updateChatList();
        if (currentChatPid === otherPid) {
            renderMessages();
        }
    }
}

async function getUnreadCount(otherPid) {
    const data = await apiGet('getUnreadCount', {
        pid: myPid,
        otherPid: otherPid
    });

    if (data && data.success) {
        return data.unreadCount;
    }
    return 0;
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + (type || '');

    setTimeout(function() { toast.classList.add('show'); }, 10);

    setTimeout(function() {
        toast.classList.remove('show');
    }, 3000);
}

setInterval(async function() {
    if (authToken && myPid) {
        const result = await apiGet('getConversations', { pid: myPid });
        if (result && result.success) {
            let needsUpdate = false;
            for (const conv of result.conversations) {
                const otherPid = conv.other_pid;
                if (chats[otherPid]) {
                    const oldUnread = chats[otherPid].unread;
                    const oldLastTime = chats[otherPid].lastTime;
                    
                    if (oldUnread !== conv.unread_count || 
                        oldLastTime !== conv.last_time_timestamp ||
                        chats[otherPid].online !== conv.is_online ||
                        chats[otherPid].lastMessage !== conv.last_message) {
                        
                        chats[otherPid].unread = conv.unread_count || 0;
                        chats[otherPid].lastTime = conv.last_time_timestamp || null;
                        chats[otherPid].online = conv.is_online;
                        chats[otherPid].lastMessage = conv.last_message || '';
                        chats[otherPid].last_message_status = conv.last_message_status;
                        chats[otherPid].last_message_from = conv.last_message_from;
                        needsUpdate = true;
                        
                        if (oldUnread < conv.unread_count && otherPid !== currentChatPid) {
                            loadConversationMessages(otherPid).then(messages => {
                                if (chats[otherPid]) {
                                    chats[otherPid].messages = messages;
                                    if (currentChatPid === otherPid) {
                                        renderMessages();
                                    }
                                }
                            });
                        }
                    }
                } else {
                    chats[otherPid] = {
                        messages: [],
                        unread: conv.unread_count || 0,
                        lastMessage: conv.last_message || '',
                        lastTime: conv.last_time_timestamp || null,
                        online: conv.is_online,
                        last_message_status: conv.last_message_status,
                        last_message_from: conv.last_message_from
                    };
                    loadConversationMessages(otherPid).then(messages => {
                        if (chats[otherPid]) {
                            chats[otherPid].messages = messages;
                            updateChatList();
                        }
                    });
                    needsUpdate = true;
                }
            }
            
            if (needsUpdate) {
                updateChatList();
                if (currentChatPid) {
                    renderMessages();
                }
            } else if (currentChatPid) {
                renderMessages();
            }
        }
    }
}, 5000);

async function loadEmojis() {
    const result = await apiGet('getEmojis');
    if (result && result.success) {
        emojis = result.emojis || [];
        emojiCategories = result.categories || [];
        if (emojiCategories.length > 0) {
            currentEmojiCategory = emojiCategories[0].category;
        }
        renderEmojiCategories();
        renderEmojiList();
    }
}

function toggleEmojiPanel() {
    const panel = document.getElementById('emojiPanel');
    if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'flex';
    } else {
        panel.style.display = 'none';
    }
}

function hideEmojiPanel() {
    const panel = document.getElementById('emojiPanel');
    if (panel) {
        panel.style.display = 'none';
    }
}

function renderEmojiCategories() {
    const container = document.getElementById('emojiCategories');
    if (!container) return;
    
    const categoryNames = {
        'face': '表情',
        'animal': '动物',
        'nature': '自然',
        'symbol': '符号',
        'gesture': '手势',
        'object': '物品'
    };
    
    container.innerHTML = emojiCategories.map(cat => {
        const name = categoryNames[cat.category] || cat.category;
        const isActive = cat.category === currentEmojiCategory;
        return `<button class="emoji-category-btn ${isActive ? 'active' : ''}" 
                        onclick="switchEmojiCategory('${cat.category}')">${name}</button>`;
    }).join('');
}

function switchEmojiCategory(category) {
    currentEmojiCategory = category;
    renderEmojiCategories();
    renderEmojiList();
}

function renderEmojiList() {
    const container = document.getElementById('emojiList');
    if (!container) return;
    
    const filteredEmojis = currentEmojiCategory 
        ? emojis.filter(e => e.category === currentEmojiCategory)
        : emojis;
    
    container.innerHTML = filteredEmojis.map(emoji => {
        return `<div class="emoji-item" 
                        onclick="selectEmoji('${emoji.code}', '${emoji.url}', '${escapeHtml(emoji.name)}')" 
                        title="${escapeHtml(emoji.name)}">${emoji.url}</div>`;
    }).join('');
}

function selectEmoji(code, url, name) {
    hideEmojiPanel();
    
    const extraData = {
        emoji_code: code,
        emoji_url: url,
        emoji_name: name
    };
    
    sendMessage('emoji', extraData);
}

function selectImage() {
    document.getElementById('imageInput').click();
}

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showToast('请选择图片文件', 'error');
        return;
    }
    
    uploadFile(file, 'image');
    event.target.value = '';
}

function selectFile() {
    document.getElementById('fileInput').click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    uploadFile(file, 'file');
    event.target.value = '';
}

async function uploadFile(file, fileType) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('file_type', fileType);
    
    const progressDiv = showUploadProgress(file.name);
    
    try {
        const result = await apiUpload('uploadFile', formData, (progress) => {
            updateUploadProgress(progressDiv, progress);
        });
        
        hideUploadProgress(progressDiv);
        
        if (result && result.success) {
            const extraData = {
                file_path: result.file_path,
                file_name: result.file_name,
                file_size: result.file_size,
                file_mime: result.file_mime,
                displayText: fileType === 'image' ? '[图片]' : '[文件] ' + result.file_name
            };
            
            sendMessage(fileType, extraData);
        } else {
            showToast(result.error || '上传失败', 'error');
        }
    } catch (e) {
        hideUploadProgress(progressDiv);
        showToast('上传失败', 'error');
    }
}

async function apiUpload(action, formData, onProgress) {
    const url = 'api.php?action=' + action + '&token=' + authToken;
    
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        
        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable && onProgress) {
                const progress = Math.round((e.loaded / e.total) * 100);
                onProgress(progress);
            }
        };
        
        xhr.onload = function() {
            try {
                const data = JSON.parse(xhr.responseText);
                resolve(data);
            } catch (e) {
                reject(e);
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('Network error'));
        };
        
        xhr.send(formData);
    });
}

function showUploadProgress(fileName) {
    const div = document.createElement('div');
    div.className = 'upload-progress';
    div.innerHTML = `
        <div class="progress-text">正在上传: ${escapeHtml(fileName)}</div>
        <div class="progress-bar">
            <div class="progress-fill" style="width: 0%"></div>
        </div>
    `;
    document.body.appendChild(div);
    return div;
}

function updateUploadProgress(div, progress) {
    const fill = div.querySelector('.progress-fill');
    if (fill) {
        fill.style.width = progress + '%';
    }
}

function hideUploadProgress(div) {
    if (div && div.parentNode) {
        div.parentNode.removeChild(div);
    }
}

function openImageModal(imageUrl, imageName) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('imageModalImg');
    const info = document.getElementById('imageModalInfo');
    
    img.src = imageUrl;
    img.alt = imageName;
    info.textContent = imageName;
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

function downloadFile(fileUrl, fileName) {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = fileName;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function getFileIconHtml(mimeType) {
    const icons = {
        'image/': '🖼️',
        'video/': '🎬',
        'audio/': '🎵',
        'application/pdf': '📄',
        'application/msword': '📝',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
        'application/vnd.ms-excel': '📊',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
        'application/vnd.ms-powerpoint': '📽️',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📽️',
        'application/zip': '📦',
        'application/x-rar-compressed': '📦',
        'application/x-7z-compressed': '📦',
        'text/plain': '📃',
        'text/csv': '📊',
    };

    for (const prefix in icons) {
        if (mimeType && mimeType.indexOf(prefix) === 0) {
            return icons[prefix];
        }
    }
    return '📁';
}

function formatFileSizeHtml(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) {
        return bytes + ' B';
    } else if (bytes < 1048576) {
        return (bytes / 1024).toFixed(2) + ' KB';
    } else if (bytes < 1073741824) {
        return (bytes / 1048576).toFixed(2) + ' MB';
    } else {
        return (bytes / 1073741824).toFixed(2) + ' GB';
    }
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeImageModal();
    }
});
