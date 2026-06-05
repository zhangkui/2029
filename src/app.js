// Global variables
let myPid = null;
let currentChatPid = null;
let chats = {};
let ws = null;
let reconnectTimer = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initPid();
    
    window.addEventListener('beforeunload', function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });
});

// Generate 32-char random PID
function generatePid() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let pid = '';
    for (let i = 0; i < 32; i++) {
        pid += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pid;
}

// Initialize PID
function initPid() {
    myPid = generatePid();
    document.getElementById('myPid').textContent = myPid;
    connectWebSocket();
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
            break;
            
        case 'message':
            var chatPid = data.from;
            
            if (!chats[chatPid]) {
                chats[chatPid] = { messages: [], unread: 0, lastMessage: '', lastTime: null };
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
            
            updateChatList();
            if (currentChatPid === chatPid) {
                renderMessages();
            }
            break;
            
        case 'sent':
            if (!data.online) {
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
            break;
            
        case 'userStatus':
            updateUserStatus(data.pid, data.online);
            break;
            
        case 'pong':
            break;
    }
}

// Update user status
function updateUserStatus(pid, online) {
    if (chats[pid]) {
        chats[pid].online = online;
        
        if (pid === currentChatPid) {
            var statusEl = document.getElementById('onlineStatus');
            if (statusEl) {
                statusEl.textContent = online ? '在线' : '离线';
                statusEl.style.color = online ? 'var(--success-color)' : 'var(--text-muted)';
            }
            
            if (!online) {
                var systemMsg = {
                    type: 'system',
                    text: '对方已离开',
                    time: Date.now()
                };
                chats[pid].messages.push(systemMsg);
                renderMessages();
            }
        }
    }
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

// Start new chat
function startChat() {
    var targetPid = document.getElementById('targetPid').value.trim();
    
    if (!targetPid) {
        showToast('请输入对方PID', 'error');
        return;
    }
    
    if (targetPid.length !== 32) {
        showToast('PID必须是32位', 'error');
        return;
    }
    
    if (targetPid === myPid) {
        showToast('不能和自己聊天', 'error');
        return;
    }
    
    if (!chats[targetPid]) {
        chats[targetPid] = {
            messages: [],
            unread: 0,
            lastMessage: '',
            lastTime: null
        };
        updateChatList();
    }
    
    openChat(targetPid);
    document.getElementById('targetPid').value = '';
}

// Update chat list
function updateChatList() {
    var chatList = document.getElementById('chatList');
    var pids = Object.keys(chats);
    
    if (pids.length === 0) {
        chatList.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg><p>暂无聊天</p><span>输入对方PID开始聊天</span></div>';
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
        
        return '<div class="chat-item ' + (isActive ? 'active' : '') + '" onclick="openChat(\'' + pid + '\')">' +
            '<div class="avatar small"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>' +
            '<div class="chat-item-info">' +
            '<div class="chat-item-pid">' + pid.substring(0, 8) + '...' + pid.substring(24) + '</div>' +
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
    document.getElementById('targetPidDisplay').textContent = pid;
    
    renderMessages();
    updateChatList();
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
    
    if (messages.length === 0) {
        container.innerHTML = '<div class="system-message"><span>开始与 ' + currentChatPid.substring(0, 8) + '... 聊天</span></div>';
        return;
    }
    
    container.innerHTML = messages.map(function(msg) {
        if (msg.type === 'system') {
            return '<div class="system-message warning"><span>' + escapeHtml(msg.text) + '</span></div>';
        }
        
        var isSent = msg.from === myPid;
        var timeStr = formatTime(msg.time);
        
        return '<div class="message ' + (isSent ? 'sent' : 'received') + '">' +
            '<div class="avatar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>' +
            '<div class="message-content">' +
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
        chats[currentChatPid] = { messages: [], unread: 0, lastMessage: '', lastTime: null };
    }
    chats[currentChatPid].messages.push(message);
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
