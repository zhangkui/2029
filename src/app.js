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
}

async function verifyAndRestoreSession() {
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('chatUser');
    
    if (!savedToken || !savedUser) {
        return false;
    }
    
    authToken = savedToken;
    
    try {
        const result = await apiGet('verifyToken');
        if (result && result.success) {
            currentUser = result.user;
            myPid = result.user.pid;
            myNickname = result.user.nickname;
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

    await loadAllData();
    connectWebSocket();
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
        status: data.status || 'delivered'
    };

    chats[chatPid].messages.push(msg);
    chats[chatPid].lastMessage = data.text;
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
        if (offlineTimers[currentChatPid]) {
            showToast('对方暂时离线，消息可能无法送达', 'warning');
        } else {
            const systemMsg = {
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
        let statusHtml = '';

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

        return '<div class="message ' + (isSent ? 'sent' : 'received') + '">' +
            '<div class="avatar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>' +
            '<div class="message-content">' +
            '<div class="message-sender">' + escapeHtml(senderName) + '</div>' +
            '<div class="message-bubble">' + escapeHtml(msg.text) + '</div>' +
            '<div class="message-meta">' +
            '<span class="message-time">' + timeStr + '</span>' +
            statusHtml +
            '</div>' +
            '</div>' +
            '</div>';
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text || !currentChatPid) return;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('连接已断开，正在重连...', 'warning');
        return;
    }

    const message = {
        from: myPid,
        to: currentChatPid,
        text: text,
        time: Date.now()
    };

    if (!chats[currentChatPid]) {
        chats[currentChatPid] = { messages: [], unread: 0, lastMessage: '', lastTime: null, online: false };
    }

    const tempMsg = {
        from: message.from,
        to: message.to,
        text: message.text,
        time: message.time,
        status: 'sent'
    };

    chats[currentChatPid].messages.push(tempMsg);
    chats[currentChatPid].lastMessage = text;
    chats[currentChatPid].lastTime = message.time;

    input.value = '';

    renderMessages();
    updateChatList();

    ws.send(JSON.stringify({
        type: 'send',
        from: message.from,
        to: message.to,
        text: message.text,
        time: message.time
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
            }
        }
    }
}, 5000);
