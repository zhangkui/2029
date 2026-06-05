<?php

class Database {
    private static $instance = null;
    private $pdo;

    private function __construct() {
        $host = getenv('DB_HOST') ?: 'db';
        $port = getenv('DB_PORT') ?: '3306';
        $dbname = getenv('DB_NAME') ?: 'chat_app';
        $user = getenv('DB_USER') ?: 'chat_user';
        $password = getenv('DB_PASSWORD') ?: 'chat_password';

        $dsn = "mysql:host=$host;port=$port;dbname=$dbname;charset=utf8mb4";
        
        try {
            $this->pdo = new PDO($dsn, $user, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (PDOException $e) {
            error_log('Database connection failed: ' . $e->getMessage());
            throw new Exception('数据库连接失败');
        }
    }

    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getConnection() {
        return $this->pdo;
    }

    public function query($sql, $params = []) {
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return $stmt;
        } catch (PDOException $e) {
            error_log('Query failed: ' . $e->getMessage() . ' SQL: ' . $sql);
            throw $e;
        }
    }

    public function fetchAll($sql, $params = []) {
        return $this->query($sql, $params)->fetchAll();
    }

    public function fetchOne($sql, $params = []) {
        $result = $this->query($sql, $params)->fetch();
        return $result ?: null;
    }

    public function insert($sql, $params = []) {
        $this->query($sql, $params);
        return $this->pdo->lastInsertId();
    }

    public function execute($sql, $params = []) {
        return $this->query($sql, $params)->rowCount();
    }

    public function beginTransaction() {
        return $this->pdo->beginTransaction();
    }

    public function commit() {
        return $this->pdo->commit();
    }

    public function rollback() {
        return $this->pdo->rollBack();
    }

    public function inTransaction() {
        return $this->pdo->inTransaction();
    }
}

function getDb() {
    return Database::getInstance();
}

function generateConversationKey($pid1, $pid2) {
    $pids = [$pid1, $pid2];
    sort($pids);
    return $pids[0] . '_' . $pids[1];
}

function getOrCreateConversation($pid1, $pid2) {
    $db = getDb();
    $conversationKey = generateConversationKey($pid1, $pid2);

    $conversation = $db->fetchOne(
        "SELECT id FROM conversations WHERE conversation_key = ?",
        [$conversationKey]
    );

    if ($conversation) {
        return $conversation['id'];
    }

    $db->beginTransaction();
    try {
        $conversationId = $db->insert(
            "INSERT INTO conversations (conversation_key) VALUES (?)",
            [$conversationKey]
        );

        $db->execute(
            "INSERT IGNORE INTO conversation_members (conversation_id, user_pid) VALUES (?, ?), (?, ?)",
            [$conversationId, $pid1, $conversationId, $pid2]
        );

        $db->commit();
        return $conversationId;
    } catch (Exception $e) {
        $db->rollBack();
        throw $e;
    }
}

function getUserByPid($pid) {
    $db = getDb();
    return $db->fetchOne(
        "SELECT id, username, nickname, pid, created_at FROM users WHERE pid = ?",
        [$pid]
    );
}

function getUserByUsername($username) {
    $db = getDb();
    return $db->fetchOne(
        "SELECT id, username, nickname, pid, password, created_at FROM users WHERE username = ?",
        [$username]
    );
}

function isUserOnline($pid) {
    $db = getDb();
    $session = $db->fetchOne(
        "SELECT is_online, last_activity FROM user_sessions WHERE user_pid = ?",
        [$pid]
    );

    if (!$session) {
        return false;
    }

    if (!$session['is_online']) {
        return false;
    }

    $lastActivity = strtotime($session['last_activity']);
    $expiry = 300;
    return (time() - $lastActivity) < $expiry;
}

function updateUserActivity($pid, $isOnline = true) {
    $db = getDb();
    return $db->execute(
        "INSERT INTO user_sessions (user_pid, is_online, last_activity) 
         VALUES (?, ?, NOW()) 
         ON DUPLICATE KEY UPDATE is_online = ?, last_activity = NOW()",
        [$pid, $isOnline ? 1 : 0, $isOnline ? 1 : 0]
    );
}

function setUserOffline($pid) {
    $db = getDb();
    return $db->execute(
        "UPDATE user_sessions SET is_online = 0 WHERE user_pid = ?",
        [$pid]
    );
}

function saveMessage($conversationId, $fromPid, $toPid, $text, $status = 'sent') {
    $db = getDb();
    return $db->insert(
        "INSERT INTO messages (conversation_id, from_pid, to_pid, message_text, status) 
         VALUES (?, ?, ?, ?, ?)",
        [$conversationId, $fromPid, $toPid, $text, $status]
    );
}

function updateMessageStatus($messageId, $status) {
    $db = getDb();
    return $db->execute(
        "UPDATE messages SET status = ? WHERE id = ?",
        [$status, $messageId]
    );
}

function markMessagesAsRead($conversationId, $userPid) {
    $db = getDb();
    return $db->execute(
        "UPDATE messages 
         SET status = 'read' 
         WHERE conversation_id = ? 
           AND to_pid = ? 
           AND status IN ('sent', 'delivered')",
        [$conversationId, $userPid]
    );
}

function updateLastReadAt($conversationId, $userPid) {
    $db = getDb();
    return $db->execute(
        "UPDATE conversation_members 
         SET last_read_at = NOW() 
         WHERE conversation_id = ? AND user_pid = ?",
        [$conversationId, $userPid]
    );
}

function getUnreadCount($conversationId, $userPid) {
    $db = getDb();
    $result = $db->fetchOne(
        "SELECT COUNT(*) as count 
         FROM messages 
         WHERE conversation_id = ? 
           AND to_pid = ? 
           AND status IN ('sent', 'delivered')",
        [$conversationId, $userPid]
    );
    return (int)($result['count'] ?? 0);
}

function getUserConversations($userPid) {
    $db = getDb();
    $sql = "SELECT 
                c.id as conversation_id,
                c.conversation_key,
                cm2.user_pid as other_pid,
                u.nickname as other_nickname,
                u.username as other_username,
                m.message_text as last_message,
                m.created_at as last_time,
                m.status as last_message_status,
                m.from_pid as last_message_from,
                COALESCE((
                    SELECT COUNT(*) 
                    FROM messages um 
                    WHERE um.conversation_id = c.id 
                      AND um.to_pid = ? 
                      AND um.status IN ('sent', 'delivered')
                ), 0) as unread_count,
                COALESCE(us.is_online, 0) as is_online
            FROM conversation_members cm
            INNER JOIN conversations c ON cm.conversation_id = c.id
            INNER JOIN conversation_members cm2 
                ON cm.conversation_id = cm2.conversation_id 
                AND cm2.user_pid != cm.user_pid
            INNER JOIN users u ON cm2.user_pid = u.pid
            LEFT JOIN messages m ON c.id = m.conversation_id
                AND m.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
            LEFT JOIN user_sessions us ON cm2.user_pid = us.user_pid
            WHERE cm.user_pid = ?
            ORDER BY m.created_at DESC, c.id DESC";

    return $db->fetchAll($sql, [$userPid, $userPid]);
}

function getConversationMessages($conversationId, $limit = 100, $offset = 0) {
    $db = getDb();
    return $db->fetchAll(
        "SELECT id, from_pid, to_pid, message_text as text, status, 
                UNIX_TIMESTAMP(created_at) * 1000 as time
         FROM messages 
         WHERE conversation_id = ? 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?",
        [$conversationId, $limit, $offset]
    );
}

function generateFixedPid() {
    $db = getDb();
    $chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    
    while (true) {
        $pid = '';
        for ($i = 0; $i < 32; $i++) {
            $pid .= $chars[random_int(0, strlen($chars) - 1)];
        }
        
        $existing = $db->fetchOne("SELECT id FROM users WHERE pid = ?", [$pid]);
        if (!$existing) {
            return $pid;
        }
    }
}

function registerUser($username, $nickname, $password) {
    $db = getDb();
    $pid = generateFixedPid();
    $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

    $db->insert(
        "INSERT INTO users (username, nickname, password, pid) VALUES (?, ?, ?, ?)",
        [$username, $nickname, $hashedPassword, $pid]
    );

    return [
        'username' => $username,
        'nickname' => $nickname,
        'pid' => $pid
    ];
}

function searchUsers($keyword, $excludePid = null) {
    $db = getDb();
    $keywordLower = strtolower($keyword);

    $sql = "SELECT username, nickname, pid, 
                CASE 
                    WHEN LOWER(username) = ? THEN 'username'
                    WHEN pid = ? THEN 'pid'
                    ELSE 'nickname'
                END as matchType
            FROM users 
            WHERE (LOWER(username) = ? OR pid = ? OR LOWER(nickname) LIKE ?)";
    
    $params = [$keywordLower, $keyword, $keywordLower, $keyword, "%$keyword%"];

    if ($excludePid) {
        $sql .= " AND pid != ?";
        $params[] = $excludePid;
    }

    $sql .= " LIMIT 20";

    return $db->fetchAll($sql, $params);
}

function generateToken() {
    return bin2hex(random_bytes(32));
}

function createUserToken($userPid, $userAgent = '', $ipAddress = '') {
    $db = getDb();
    $token = generateToken();
    
    $expiresAt = date('Y-m-d H:i:s', time() + (7 * 24 * 60 * 60));
    
    $db->execute(
        "INSERT INTO user_tokens (user_pid, token, user_agent, ip_address, expires_at) 
         VALUES (?, ?, ?, ?, ?)",
        [$userPid, $token, substr($userAgent, 0, 255), substr($ipAddress, 0, 45), $expiresAt]
    );
    
    return $token;
}

function validateToken($token) {
    $db = getDb();
    
    $result = $db->fetchOne(
        "SELECT ut.user_pid, u.username, u.nickname, ut.expires_at 
         FROM user_tokens ut 
         INNER JOIN users u ON ut.user_pid = u.pid 
         WHERE ut.token = ? AND (ut.expires_at IS NULL OR ut.expires_at > NOW())",
        [$token]
    );
    
    if ($result) {
        return [
            'pid' => $result['user_pid'],
            'username' => $result['username'],
            'nickname' => $result['nickname']
        ];
    }
    
    return null;
}

function deleteToken($token) {
    $db = getDb();
    return $db->execute(
        "DELETE FROM user_tokens WHERE token = ?",
        [$token]
    );
}

function deleteAllUserTokens($userPid) {
    $db = getDb();
    return $db->execute(
        "DELETE FROM user_tokens WHERE user_pid = ?",
        [$userPid]
    );
}

function cleanupExpiredTokens() {
    $db = getDb();
    return $db->execute(
        "DELETE FROM user_tokens WHERE expires_at IS NOT NULL AND expires_at <= NOW()"
    );
}
