<?php

require_once 'db.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$currentUser = null;

function getAuthToken() {
    $headers = getallheaders();
    
    if (isset($headers['Authorization'])) {
        $authHeader = $headers['Authorization'];
        if (preg_match('/Bearer\s+(.*)/i', $authHeader, $matches)) {
            return $matches[1];
        }
    }
    
    if (isset($_GET['token'])) {
        return $_GET['token'];
    }
    
    $input = json_decode(file_get_contents('php://input'), true);
    if (isset($input['token'])) {
        return $input['token'];
    }
    
    return null;
}

function authenticate() {
    global $currentUser;
    
    $token = getAuthToken();
    if (!$token) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => '未登录，请先登录']);
        exit;
    }
    
    $user = validateToken($token);
    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => '登录已过期，请重新登录']);
        exit;
    }
    
    $currentUser = $user;
    return $user;
}

function verifyOwnership($requestedPid) {
    global $currentUser;
    if (!$currentUser) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => '未登录']);
        exit;
    }
    if ($currentUser['pid'] !== $requestedPid) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => '无权访问他人数据']);
        exit;
    }
    return true;
}

try {
    cleanupExpiredTokens();
    
    $action = $_GET['action'] ?? '';
    $publicActions = ['userLogin', 'userRegister'];
    
    if (!in_array($action, $publicActions)) {
        authenticate();
    }

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
            case 'recallMessage':
                handleRecallMessage($input);
                break;
            case 'logout':
                handleLogoutPost($input);
                break;
            case 'sendFile':
                handleSendFileMessage($input);
                break;
            case 'sendEmoji':
                handleSendEmojiMessage($input);
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
        case 'verifyToken':
            handleVerifyToken();
            break;
        case 'getEmojis':
            handleGetEmojis();
            break;
        case 'uploadFile':
            handleFileUpload();
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

    $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $ipAddress = $_SERVER['REMOTE_ADDR'] ?? '';
    $token = createUserToken($user['pid'], $userAgent, $ipAddress);

    echo json_encode([
        'success' => true,
        'user' => [
            'username' => $user['username'],
            'nickname' => $user['nickname'],
            'pid' => $user['pid']
        ],
        'token' => $token
    ]);
}

function handleVerifyToken() {
    global $currentUser;
    echo json_encode([
        'success' => true,
        'user' => $currentUser
    ]);
}

function handleRegister($input) {
    global $currentUser;
    $pid = $input['pid'] ?? '';
    verifyOwnership($pid);
    
    if (strlen($pid) === 32) {
        updateUserActivity($pid, true);
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
    }
}

function handleSendMessage($input) {
    global $currentUser;
    $message = $input['message'] ?? null;
    
    if (!$message || !isset($message['to']) || !isset($message['from']) || !isset($message['text'])) {
        echo json_encode(['success' => false, 'error' => 'Invalid message']);
        return;
    }
    
    verifyOwnership($message['from']);

    $recipientOnline = isUserOnline($message['to']);
    updateUserActivity($message['from']);

    $conversationId = getOrCreateConversation($message['from'], $message['to']);
    $messageType = $message['message_type'] ?? 'text';
    $status = $recipientOnline ? 'delivered' : 'sent';
    $messageId = saveMessage(
        $conversationId, 
        $message['from'], 
        $message['to'], 
        $message['text'], 
        $status,
        $messageType,
        $message['file_path'] ?? null,
        $message['file_name'] ?? null,
        $message['file_size'] ?? null,
        $message['file_mime'] ?? null
    );

    echo json_encode([
        'success' => true,
        'online' => $recipientOnline,
        'messageId' => $messageId,
        'status' => $status,
        'message_type' => $messageType
    ]);
}

function handleSaveMessage($input) {
    global $currentUser;
    $fromPid = $input['from'] ?? '';
    $toPid = $input['to'] ?? '';
    $text = $input['text'] ?? '';
    $status = $input['status'] ?? 'sent';

    if (!$fromPid || !$toPid || !$text) {
        echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
        return;
    }
    
    verifyOwnership($fromPid);

    $conversationId = getOrCreateConversation($fromPid, $toPid);
    $messageId = saveMessage($conversationId, $fromPid, $toPid, $text, $status);

    echo json_encode([
        'success' => true,
        'messageId' => $messageId
    ]);
}

function handleMarkAsRead($input) {
    global $currentUser;
    $userPid = $input['userPid'] ?? '';
    $otherPid = $input['otherPid'] ?? '';

    if (!$userPid || !$otherPid) {
        echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
        return;
    }
    
    verifyOwnership($userPid);

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

    if (!$messageId || !in_array($status, ['sent', 'delivered', 'read', 'recalled'])) {
        echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
        return;
    }

    $count = updateMessageStatus($messageId, $status);

    echo json_encode([
        'success' => true,
        'updatedCount' => $count
    ]);
}

function handleRecallMessage($input) {
    global $currentUser;
    $messageId = $input['messageId'] ?? '';

    if (!$messageId) {
        echo json_encode(['success' => false, 'error' => 'Invalid parameters']);
        return;
    }

    $result = recallMessage($messageId, $currentUser['pid']);

    if ($result['success']) {
        $message = getMessageById($messageId);
        echo json_encode([
            'success' => true,
            'message' => $message
        ]);
    } else {
        echo json_encode($result);
    }
}

function handleSearch() {
    global $currentUser;
    $keyword = trim($_GET['keyword'] ?? '');
    $myPid = $currentUser['pid'];

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
    global $currentUser;
    $pid = $_GET['pid'] ?? '';
    verifyOwnership($pid);
    
    if (strlen($pid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }

    updateUserActivity($pid);
    echo json_encode(['success' => true]);
}

function handleLogout() {
    global $currentUser;
    $token = getAuthToken();
    if ($token) {
        deleteToken($token);
    }
    echo json_encode(['success' => true]);
}

function handleLogoutPost($input) {
    global $currentUser;
    $token = getAuthToken();
    if ($token) {
        deleteToken($token);
    }
    
    $pid = $input['pid'] ?? '';
    if ($pid && $pid === $currentUser['pid']) {
        setUserOffline($pid);
    }
    
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
    global $currentUser;
    $pid = $_GET['pid'] ?? '';
    verifyOwnership($pid);
    
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
    global $currentUser;
    $pid = $_GET['pid'] ?? '';
    $otherPid = $_GET['otherPid'] ?? '';
    $limit = (int)($_GET['limit'] ?? 100);
    $offset = (int)($_GET['offset'] ?? 0);

    if (strlen($pid) !== 32 || strlen($otherPid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }
    
    verifyOwnership($pid);

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
    global $currentUser;
    $pid1 = $_GET['pid1'] ?? '';
    $pid2 = $_GET['pid2'] ?? '';

    if (strlen($pid1) !== 32 || strlen($pid2) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }
    
    verifyOwnership($pid1);

    $conversationId = getOrCreateConversation($pid1, $pid2);
    echo json_encode(['success' => true, 'conversationId' => $conversationId]);
}

function handleGetUnreadCount() {
    global $currentUser;
    $pid = $_GET['pid'] ?? '';
    $otherPid = $_GET['otherPid'] ?? '';

    if (strlen($pid) !== 32 || strlen($otherPid) !== 32) {
        echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        return;
    }
    
    verifyOwnership($pid);

    $conversationId = getOrCreateConversation($pid, $otherPid);
    $count = getUnreadCount($conversationId, $pid);

    echo json_encode(['success' => true, 'unreadCount' => $count]);
}

function handleGetEmojis() {
    $category = $_GET['category'] ?? null;
    $emojis = getAllEmojis($category);
    $categories = getEmojiCategories();
    
    echo json_encode([
        'success' => true,
        'emojis' => $emojis,
        'categories' => $categories
    ]);
}

function handleFileUpload() {
    global $currentUser;
    
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        echo json_encode(['success' => false, 'error' => '文件上传失败']);
        return;
    }
    
    $file = $_FILES['file'];
    $fileType = $_POST['file_type'] ?? 'file';
    
    $allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];
    $allowedFileTypes = array_merge($allowedImageTypes, [
        'application/pdf', 'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip', 'application/x-rar-compressed',
        'text/plain', 'audio/mpeg', 'audio/mp3', 'video/mp4', 'video/avi'
    ]);
    
    $maxImageSize = 10 * 1024 * 1024;
    $maxFileSize = 50 * 1024 * 1024;
    
    if ($fileType === 'image') {
        if (!in_array($file['type'], $allowedImageTypes)) {
            echo json_encode(['success' => false, 'error' => '不支持的图片类型，仅支持 JPG、PNG、GIF、WEBP']);
            return;
        }
        if ($file['size'] > $maxImageSize) {
            echo json_encode(['success' => false, 'error' => '图片大小不能超过 10MB']);
            return;
        }
    } else {
        if (!in_array($file['type'], $allowedFileTypes)) {
            echo json_encode(['success' => false, 'error' => '不支持的文件类型']);
            return;
        }
        if ($file['size'] > $maxFileSize) {
            echo json_encode(['success' => false, 'error' => '文件大小不能超过 50MB']);
            return;
        }
    }
    
    $uploadDir = dirname(__DIR__) . '/uploads/';
    if (!file_exists($uploadDir)) {
        mkdir($uploadDir, 0755, true);
    }
    
    $fileExt = pathinfo($file['name'], PATHINFO_EXTENSION);
    $fileName = $currentUser['pid'] . '_' . time() . '_' . bin2hex(random_bytes(8)) . '.' . $fileExt;
    $filePath = $uploadDir . $fileName;
    
    if (move_uploaded_file($file['tmp_name'], $filePath)) {
        $relativePath = 'uploads/' . $fileName;
        echo json_encode([
            'success' => true,
            'file_path' => $relativePath,
            'file_name' => $file['name'],
            'file_size' => $file['size'],
            'file_mime' => $file['type'],
            'file_url' => $relativePath
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => '文件保存失败']);
    }
}

function handleSendEmojiMessage($input) {
    global $currentUser;
    $fromPid = $input['from'] ?? '';
    $toPid = $input['to'] ?? '';
    $emojiCode = $input['emoji_code'] ?? '';
    $emojiUrl = $input['emoji_url'] ?? '';
    $time = $input['time'] ?? time() * 1000;
    
    if (!$fromPid || !$toPid || !$emojiCode) {
        echo json_encode(['success' => false, 'error' => '参数不完整']);
        return;
    }
    
    verifyOwnership($fromPid);
    
    $emoji = getEmojiByCode($emojiCode);
    if (!$emoji) {
        echo json_encode(['success' => false, 'error' => '表情不存在']);
        return;
    }
    
    $recipientOnline = isUserOnline($toPid);
    updateUserActivity($fromPid);
    
    $conversationId = getOrCreateConversation($fromPid, $toPid);
    $status = $recipientOnline ? 'delivered' : 'sent';
    
    $messageId = saveMessage(
        $conversationId,
        $fromPid,
        $toPid,
        $emoji['url'],
        $status,
        'emoji',
        null,
        $emoji['name'],
        null,
        null
    );
    
    echo json_encode([
        'success' => true,
        'online' => $recipientOnline,
        'messageId' => $messageId,
        'status' => $status,
        'message' => [
            'id' => $messageId,
            'from' => $fromPid,
            'to' => $toPid,
            'text' => $emoji['url'],
            'message_type' => 'emoji',
            'emoji_code' => $emojiCode,
            'emoji_name' => $emoji['name'],
            'time' => $time,
            'status' => $status
        ]
    ]);
}

function handleSendFileMessage($input) {
    global $currentUser;
    $fromPid = $input['from'] ?? '';
    $toPid = $input['to'] ?? '';
    $filePath = $input['file_path'] ?? '';
    $fileName = $input['file_name'] ?? '';
    $fileSize = $input['file_size'] ?? 0;
    $fileMime = $input['file_mime'] ?? '';
    $messageType = $input['message_type'] ?? 'file';
    $time = $input['time'] ?? time() * 1000;
    
    if (!$fromPid || !$toPid || !$filePath) {
        echo json_encode(['success' => false, 'error' => '参数不完整']);
        return;
    }
    
    verifyOwnership($fromPid);
    
    $fullPath = dirname(__DIR__) . '/' . $filePath;
    if (!file_exists($fullPath)) {
        echo json_encode(['success' => false, 'error' => '文件不存在']);
        return;
    }
    
    $recipientOnline = isUserOnline($toPid);
    updateUserActivity($fromPid);
    
    $conversationId = getOrCreateConversation($fromPid, $toPid);
    $status = $recipientOnline ? 'delivered' : 'sent';
    
    $displayText = $messageType === 'image' ? '[图片]' : '[文件] ' . $fileName;
    
    $messageId = saveMessage(
        $conversationId,
        $fromPid,
        $toPid,
        $displayText,
        $status,
        $messageType,
        $filePath,
        $fileName,
        $fileSize,
        $fileMime
    );
    
    echo json_encode([
        'success' => true,
        'online' => $recipientOnline,
        'messageId' => $messageId,
        'status' => $status,
        'message' => [
            'id' => $messageId,
            'from' => $fromPid,
            'to' => $toPid,
            'text' => $displayText,
            'message_type' => $messageType,
            'file_path' => $filePath,
            'file_name' => $fileName,
            'file_size' => $fileSize,
            'file_mime' => $fileMime,
            'time' => $time,
            'status' => $status
        ]
    ]);
}
