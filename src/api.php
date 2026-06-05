<?php
/**
 * 临时聊天室 API
 * 使用文件存储消息和用户状态
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// 处理预检请求
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// 消息过期时间（秒）
$messageExpiry = 3600; // 1小时
$userExpiry = 300; // 5分钟无活动则过期

// 文件存储路径
$dataDir = '/var/www/data';
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0777, true);
}

/**
 * 获取消息队列
 */
function getMessages($pid) {
    global $dataDir;
    
    $file = "$dataDir/messages_$pid.json";
    if (file_exists($file)) {
        $messages = json_decode(file_get_contents($file), true) ?: [];
        // 获取后清空
        file_put_contents($file, '[]');
        return $messages;
    }
    return [];
}

/**
 * 存储消息
 */
function storeMessage($toPid, $message) {
    global $dataDir;
    
    $file = "$dataDir/messages_$toPid.json";
    $messages = [];
    if (file_exists($file)) {
        $messages = json_decode(file_get_contents($file), true) ?: [];
    }
    $messages[] = $message;
    
    // 限制消息数量
    if (count($messages) > 100) {
        $messages = array_slice($messages, -100);
    }
    
    file_put_contents($file, json_encode($messages));
    return true;
}

/**
 * 注册用户
 */
function registerUser($pid) {
    global $dataDir;
    
    $file = "$dataDir/users.json";
    $users = [];
    if (file_exists($file)) {
        $users = json_decode(file_get_contents($file), true) ?: [];
    }
    $users[$pid] = time();
    file_put_contents($file, json_encode($users));
    return true;
}

/**
 * 注销用户
 */
function logoutUser($pid) {
    global $dataDir;
    
    $file = "$dataDir/users.json";
    if (file_exists($file)) {
        $users = json_decode(file_get_contents($file), true) ?: [];
        unset($users[$pid]);
        file_put_contents($file, json_encode($users));
    }
    
    $msgFile = "$dataDir/messages_$pid.json";
    if (file_exists($msgFile)) {
        unlink($msgFile);
    }
    
    return true;
}

/**
 * 检查用户是否在线
 */
function isUserOnline($pid) {
    global $dataDir, $userExpiry;
    
    $file = "$dataDir/users.json";
    if (file_exists($file)) {
        $users = json_decode(file_get_contents($file), true) ?: [];
        if (isset($users[$pid])) {
            // 检查是否过期
            if (time() - $users[$pid] < $userExpiry) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 更新用户活跃时间
 */
function updateUserActivity($pid) {
    global $dataDir;
    
    $file = "$dataDir/users.json";
    if (file_exists($file)) {
        $users = json_decode(file_get_contents($file), true) ?: [];
        if (isset($users[$pid])) {
            $users[$pid] = time();
            file_put_contents($file, json_encode($users));
        }
    }
}

// 处理请求
$action = $_GET['action'] ?? '';

// POST 请求
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? $action;
    
    switch ($action) {
        case 'register':
            $pid = $input['pid'] ?? '';
            if (strlen($pid) === 32) {
                registerUser($pid);
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Invalid PID']);
            }
            break;
            
        case 'send':
            $message = $input['message'] ?? null;
            if ($message && isset($message['to']) && isset($message['from']) && isset($message['text'])) {
                // 检查接收者是否在线
                $recipientOnline = isUserOnline($message['to']);
                
                if ($recipientOnline) {
                    // 存储到接收者的消息队列
                    storeMessage($message['to'], $message);
                }
                
                // 更新发送者活跃时间
                updateUserActivity($message['from']);
                echo json_encode(['success' => true, 'online' => $recipientOnline]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Invalid message']);
            }
            break;
            
        default:
            echo json_encode(['success' => false, 'error' => 'Unknown action']);
    }
    exit;
}

// GET 请求
switch ($action) {
    case 'poll':
        $pid = $_GET['pid'] ?? '';
        if (strlen($pid) === 32) {
            updateUserActivity($pid);
            $messages = getMessages($pid);
            echo json_encode(['success' => true, 'messages' => $messages]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        }
        break;
        
    case 'logout':
        $pid = $_GET['pid'] ?? '';
        if (strlen($pid) === 32) {
            logoutUser($pid);
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        }
        break;
        
    case 'check':
        $pid = $_GET['pid'] ?? '';
        if (strlen($pid) === 32) {
            $online = isUserOnline($pid);
            echo json_encode(['success' => true, 'online' => $online]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid PID']);
        }
        break;
        
    default:
        echo json_encode(['success' => false, 'error' => 'Unknown action']);
}
