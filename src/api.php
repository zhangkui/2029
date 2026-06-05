<?php

require_once 'db.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

try {
    $action = $_GET['action'] ?? '';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $action = $input['action'] ?? $action;

        switch ($action) {
            case 'userRegister':
                handleUserRegister($input);
                break;
            case 'userLogin':
                handleUserLogin($input);
                break;
            case 'register':
                handleRegister($input);
                break;
            case 'send':
                handleSendMessage($input);
                break;
            case 'saveMessage':
                handleSaveMessage($input);
                break;
            case 'markAsRead':
                handleMarkAsRead($input);
                break;
            case 'updateMessageStatus':
                handleUpdateMessageStatus($input);
                break;
            default:
                echo json_encode(['success' => false, 'error' => 'Unknown action']);
        }
        exit;
    }

    switch ($action) {
        case 'search':
            handleSearch();
            break;
        case 'getUser':
            handleGetUser();
            break;
        case 'poll':
            handlePoll();
            break;
        case 'logout':
            handleLogout();
            break;
        case 'check':
            handleCheckStatus();
            break;
        case 'getConversations':
            handleGetConversations();
            break;
        case 'getConversationMessages':
            handleGetConversationMessages();
            break;
        case 'getOrCreateConversation':
            handleGetOrCreateConversation();
            break;
        case 'getUnreadCount':
            handleGetUnreadCount();
            break;
        default:
            echo json_encode(['success' => false, 'error' => 'Unknown action']);
    }
} catch (Exception $e) {
    error_log('API Error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'error' => '服务器错误']);
}

function handleUserRegister($input) {
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';
    $nickname = trim($input['nickname'] ?? '');

    if (strlen($username) < 3 || strlen($username) > 20) {
        echo json_encode(['success' => false, 'error' => '用户名长度必须在3-20个字符之间']);
        return;
    }

    if (!preg_match('/^[a-zA-Z0-9_]+$/', $username)) {
        echo json_encode(['success' => false, 'error' => '用户名只能包含字母、数字和下划线']);
        return;
    }

    if (strlen($password) < 6) {
        echo json_encode(['success' => false, 'error' => '密码长度不能少于6位']);
        return;
    }

    if (strlen($nickname) < 1 || strlen($nickname) > 20) {
        echo json_encode(['success' => false, 'error' => '昵称长度必须在1-20个字符之间']);
        return;
    }

    $existingUser = getUserByUsername($username);
    if ($existingUser) {
        echo json_encode(['success' => false, 'error' => '用户名已存在']);
        return;
    }

    $user = registerUser($username, $nickname, $password);

    echo json_encode([
        'success' => true,
        'user' => $user
    ]);
}

function handleUserLogin($input) {
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';

    $user = getUserByUsername($username);
    if (!$user || !password_verify($password, $user['password'])) {
        echo json_encode(['success' => false, 'error' => '用户名或密码错误']);
        return;
    }

    echo json_encode([
        'success' => true,
        'user' => [
            'username' => $user['username'],
            'nickname' => $user['nickname'],
            'pid' => $user['pid']
        ]
    ]);
}

function handleRegister($input) {
    $pid = $input['pid'] ?? '';
    if (strlen($pid) === 32) {
        updateUserActivity($pid, true);
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
    }
}

function handleSendMessage($input) {
    $message = $input['message'] ?? null;
    if (!$message || !isset($message['to']) || !isset($message['from']) || !isset($message['text'])) {
        echo json_encode(['success' => false, 'error' => 'Invalid message']);
        return;
    }

    $recipientOnline = isUserOnline($message['to']);
    updateUserActivity($message['from']);

    $conversationId = getOrCreateConversation($message['from'], $message['to']);
    $status = $recipientOnline ? 'delivered' : 'sent';
    $messageId = saveMessage($conversationId, $message['from'], $message['to'], $message['text'], $status);

    echo json_encode([
        'success' => true,
        'online' => $recipientOnline,
        'messageId' => $messageId,
        'status' => $status
    ]);
}

function handleSaveMessage($input) {
    $fromPid = $input['from'] ?? '';
    $toPid = $input['to'] ?? '';
    $text = $input['text'] ?? '';
    $status = $input['status'] ?? 'sent';

    if (!$fromPid || !$toPid || !$text) {
        echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
        return;
    }

    $conversationId = getOrCreateConversation($fromPid, $toPid);
    $messageId = saveMessage($conversationId, $fromPid, $toPid, $text, $status);

    echo json_encode([
        'success' => true,
        'messageId' => $messageId
    ]);
}

function handleMarkAsRead($input) {
    $userPid = $input['userPid'] ?? '';
    $otherPid = $input['otherPid'] ?? '';

    if (!$userPid || !$otherPid) {
        echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
        return;
    }

    $conversationId = getOrCreateConversation($userPid, $otherPid);

    $count = markMessagesAsRead($conversationId, $userPid);
    updateLastReadAt($conversationId, $userPid);

    echo json_encode([
        'success' => true,
        'markedCount' => $count,
        'conversationId' => $conversationId
    ]);
}

function handleUpdateMessageStatus($input) {
    $messageId = $input['messageId'] ?? '';
    $status = $input['status'] ?? '';

    if (!$messageId || !in_array($status, ['sent', 'delivered', 'read'])) {
        echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
        return;
    }

    $count = updateMessageStatus($messageId, $status);

    echo json_encode([
        'success' => true,
        'updatedCount' => $count
    ]);
}

function handleSearch() {
    $keyword = trim($_GET['keyword'] ?? '');
    $myPid = $_GET['myPid'] ?? '';

    if (strlen($keyword) < 1) {
        echo json_encode(['success' => false, 'error' => '请输入搜索关键词']);
        return;
    }

    $results = searchUsers($keyword, $myPid);

    foreach ($results as &$result) {
        $result['online'] = isUserOnline($result['pid']);
    }

    echo json_encode(['success' => true, 'users' => $results]);
}

function handleGetUser() {
    $pid = $_GET['pid'] ?? '';
    $username = $_GET['username'] ?? '';

    $user = null;
    if ($pid) {
        $user = getUserByPid($pid);
    } else if ($username) {
        $user = getUserByUsername($username);
    }

    if ($user) {
        $user['online'] = isUserOnline($user['pid']);
        echo json_encode(['success' => true, 'user' => $user]);
    } else {
        echo json_encode(['success' => false, 'error' => '用户不存在']);
    }
}

function handlePoll() {
    $pid = $_GET['pid'] ?? '';
    if (strlen($pid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }

    updateUserActivity($pid);
    echo json_encode(['success' => true]);
}

function handleLogout() {
    $pid = $_GET['pid'] ?? '';
    if (strlen($pid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }

    setUserOffline($pid);
    echo json_encode(['success' => true]);
}

function handleCheckStatus() {
    $pid = $_GET['pid'] ?? '';
    if (strlen($pid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }

    $online = isUserOnline($pid);
    echo json_encode(['success' => true, 'online' => $online]);
}

function handleGetConversations() {
    $pid = $_GET['pid'] ?? '';
    if (strlen($pid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }

    $conversations = getUserConversations($pid);

    foreach ($conversations as &$conv) {
        $conv['unread_count'] = (int)$conv['unread_count'];
        $conv['is_online'] = (bool)$conv['is_online'];
        $conv['last_time_timestamp'] = $conv['last_time'] ? strtotime($conv['last_time']) * 1000 : null;
    }

    echo json_encode(['success' => true, 'conversations' => $conversations]);
}

function handleGetConversationMessages() {
    $pid = $_GET['pid'] ?? '';
    $otherPid = $_GET['otherPid'] ?? '';
    $limit = (int)($_GET['limit'] ?? 100);
    $offset = (int)($_GET['offset'] ?? 0);

    if (strlen($pid) !== 32 || strlen($otherPid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }

    $conversationId = getOrCreateConversation($pid, $otherPid);
    $messages = getConversationMessages($conversationId, $limit, $offset);

    $messages = array_reverse($messages);

    echo json_encode([
        'success' => true,
        'conversationId' => $conversationId,
        'messages' => $messages
    ]);
}

function handleGetOrCreateConversation() {
    $pid1 = $_GET['pid1'] ?? '';
    $pid2 = $_GET['pid2'] ?? '';

    if (strlen($pid1) !== 32 || strlen($pid2) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }

    $conversationId = getOrCreateConversation($pid1, $pid2);
    echo json_encode(['success' => true, 'conversationId' => $conversationId]);
}

function handleGetUnreadCount() {
    $pid = $_GET['pid'] ?? '';
    $otherPid = $_GET['otherPid'] ?? '';

    if (strlen($pid) !== 32 || strlen($otherPid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }

    $conversationId = getOrCreateConversation($pid, $otherPid);
    $count = getUnreadCount($conversationId, $pid);

    echo json_encode(['success' => true, 'unreadCount' => $count]);
}
