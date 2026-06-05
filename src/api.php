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
 * 获取用户账户数据
 */
function getAccounts() {
    global $dataDir;
    $file = "$dataDir/accounts.json";
    if (file_exists($file)) {
        return json_decode(file_get_contents($file), true) ?: [];
    }
    return [];
}

/**
 * 保存用户账户数据
 */
function saveAccounts($accounts) {
    global $dataDir;
    $file = "$dataDir/accounts.json";
    file_put_contents($file, json_encode($accounts, JSON_PRETTY_PRINT));
}

/**
 * 生成32位固定PID
 */
function generateFixedPid() {
    $chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    $pid = '';
    for ($i = 0; $i < 32; $i++) {
        $pid .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return $pid;
}

/**
 * 根据PID获取用户信息
 */
function getUserByPid($pid) {
    $accounts = getAccounts();
    foreach ($accounts as $username => $user) {
        if ($user['pid'] === $pid) {
            return [
                'username' => $username,
                'nickname' => $user['nickname'],
                'pid' => $user['pid']
            ];
        }
    }
    return null;
}

/**
 * 根据用户名获取用户信息
 */
function getUserByUsername($username) {
    $accounts = getAccounts();
    if (isset($accounts[$username])) {
        return [
            'username' => $username,
            'nickname' => $accounts[$username]['nickname'],
            'pid' => $accounts[$username]['pid']
        ];
    }
    return null;
}

/**
 * 搜索用户
 * 昵称模糊搜索，用户名和PID精确匹配
 */
function searchUsers($keyword) {
    $accounts = getAccounts();
    $results = [];
    $keywordLower = strtolower($keyword);
    
    foreach ($accounts as $username => $user) {
        // 用户名精确匹配
        if (strtolower($username) === $keywordLower) {
            $results[] = [
                'username' => $username,
                'nickname' => $user['nickname'],
                'pid' => $user['pid'],
                'matchType' => 'username'
            ];
            continue;
        }
        
        // PID精确匹配
        if ($user['pid'] === $keyword) {
            $results[] = [
                'username' => $username,
                'nickname' => $user['nickname'],
                'pid' => $user['pid'],
                'matchType' => 'pid'
            ];
            continue;
        }
        
        // 昵称模糊搜索
        if (stripos($user['nickname'], $keyword) !== false) {
            $results[] = [
                'username' => $username,
                'nickname' => $user['nickname'],
                'pid' => $user['pid'],
                'matchType' => 'nickname'
            ];
        }
    }
    
    return $results;
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
        case 'userRegister':
            $username = trim($input['username'] ?? '');
            $password = $input['password'] ?? '';
            $nickname = trim($input['nickname'] ?? '');
            
            if (strlen($username) < 3 || strlen($username) > 20) {
                echo json_encode(['success' => false, 'error' => '用户名长度必须在3-20个字符之间']);
                break;
            }
            
            if (!preg_match('/^[a-zA-Z0-9_]+$/', $username)) {
                echo json_encode(['success' => false, 'error' => '用户名只能包含字母、数字和下划线']);
                break;
            }
            
            if (strlen($password) < 6) {
                echo json_encode(['success' => false, 'error' => '密码长度不能少于6位']);
                break;
            }
            
            if (strlen($nickname) < 1 || strlen($nickname) > 20) {
                echo json_encode(['success' => false, 'error' => '昵称长度必须在1-20个字符之间']);
                break;
            }
            
            $accounts = getAccounts();
            if (isset($accounts[$username])) {
                echo json_encode(['success' => false, 'error' => '用户名已存在']);
                break;
            }
            
            // 生成固定PID，确保唯一
            $pid = generateFixedPid();
            while (true) {
                $exists = false;
                foreach ($accounts as $user) {
                    if ($user['pid'] === $pid) {
                        $exists = true;
                        break;
                    }
                }
                if (!$exists) break;
                $pid = generateFixedPid();
            }
            
            $accounts[$username] = [
                'password' => password_hash($password, PASSWORD_DEFAULT),
                'nickname' => $nickname,
                'pid' => $pid,
                'createdAt' => time()
            ];
            
            saveAccounts($accounts);
            
            echo json_encode([
                'success' => true,
                'user' => [
                    'username' => $username,
                    'nickname' => $nickname,
                    'pid' => $pid
                ]
            ]);
            break;
            
        case 'userLogin':
            $username = trim($input['username'] ?? '');
            $password = $input['password'] ?? '';
            
            $accounts = getAccounts();
            if (!isset($accounts[$username])) {
                echo json_encode(['success' => false, 'error' => '用户名或密码错误']);
                break;
            }
            
            if (!password_verify($password, $accounts[$username]['password'])) {
                echo json_encode(['success' => false, 'error' => '用户名或密码错误']);
                break;
            }
            
            echo json_encode([
                'success' => true,
                'user' => [
                    'username' => $username,
                    'nickname' => $accounts[$username]['nickname'],
                    'pid' => $accounts[$username]['pid']
                ]
            ]);
            break;
            
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
                $recipientOnline = isUserOnline($message['to']);
                
                if ($recipientOnline) {
                    storeMessage($message['to'], $message);
                }
                
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
    case 'search':
        $keyword = trim($_GET['keyword'] ?? '');
        if (strlen($keyword) < 1) {
            echo json_encode(['success' => false, 'error' => '请输入搜索关键词']);
            break;
        }
        
        $results = searchUsers($keyword);
        
        // 为每个结果添加在线状态
        foreach ($results as &$result) {
            $result['online'] = isUserOnline($result['pid']);
        }
        
        echo json_encode(['success' => true, 'users' => $results]);
        break;
        
    case 'getUser':
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
        break;
        
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
