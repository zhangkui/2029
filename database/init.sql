CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    nickname VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL,
    pid CHAR(32) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pid (pid),
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 对于已存在的数据库，请执行以下迁移语句：
-- ALTER TABLE conversations MODIFY COLUMN conversation_key VARCHAR(65) NOT NULL UNIQUE;
-- ALTER TABLE messages MODIFY COLUMN status ENUM('sent', 'delivered', 'read', 'recalled') DEFAULT 'sent';

CREATE TABLE IF NOT EXISTS conversations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_key VARCHAR(65) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_conversation_key (conversation_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_members (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    user_pid CHAR(32) NOT NULL,
    last_read_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_conversation_user (conversation_id, user_pid),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    INDEX idx_user_pid (user_pid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    from_pid CHAR(32) NOT NULL,
    to_pid CHAR(32) NOT NULL,
    message_text TEXT NOT NULL,
    message_type ENUM('text', 'emoji', 'image', 'file') DEFAULT 'text',
    file_path VARCHAR(255) NULL,
    file_name VARCHAR(255) NULL,
    file_size BIGINT UNSIGNED NULL,
    file_mime VARCHAR(100) NULL,
    status ENUM('sent', 'delivered', 'read', 'recalled') DEFAULT 'sent',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    INDEX idx_conversation (conversation_id),
    INDEX idx_from_pid (from_pid),
    INDEX idx_to_pid (to_pid),
    INDEX idx_status (status),
    INDEX idx_message_type (message_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_pid CHAR(32) NOT NULL UNIQUE,
    is_online BOOLEAN DEFAULT FALSE,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_pid (user_pid),
    INDEX idx_online (is_online)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_pid CHAR(32) NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    user_agent VARCHAR(255),
    ip_address VARCHAR(45),
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_pid) REFERENCES users(pid) ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_user_pid (user_pid),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS emojis (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    url VARCHAR(255) NOT NULL,
    category VARCHAR(50) DEFAULT 'default',
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO emojis (code, name, url, category, sort_order) VALUES
('smile', '微笑', '😊', 'face', 1),
('laugh', '大笑', '😆', 'face', 2),
('happy', '开心', '😄', 'face', 3),
('love', '爱心', '😍', 'face', 4),
('kiss', '亲亲', '😘', 'face', 5),
('wink', '眨眼', '😉', 'face', 6),
('cool', '酷', '😎', 'face', 7),
('shy', '害羞', '😊', 'face', 8),
('cry', '大哭', '😭', 'face', 9),
('sad', '难过', '😢', 'face', 10),
('angry', '生气', '😠', 'face', 11),
('surprise', '惊讶', '😮', 'face', 12),
('think', '思考', '🤔', 'face', 13),
('sleep', '睡觉', '😴', 'face', 14),
('sweat', '汗', '😓', 'face', 15),
('laugh_tears', '笑哭', '😂', 'face', 16),
('dog', '狗', '🐶', 'animal', 17),
('cat', '猫', '🐱', 'animal', 18),
('panda', '熊猫', '🐼', 'animal', 19),
('rabbit', '兔子', '🐰', 'animal', 20),
('fox', '狐狸', '🦊', 'animal', 21),
('bear', '熊', '🐻', 'animal', 22),
('pig', '猪', '🐷', 'animal', 23),
('frog', '青蛙', '🐸', 'animal', 24),
('monkey', '猴子', '🐵', 'animal', 25),
('chicken', '鸡', '🐔', 'animal', 26),
('penguin', '企鹅', '🐧', 'animal', 27),
('owl', '猫头鹰', '🦉', 'animal', 28),
('butterfly', '蝴蝶', '🦋', 'animal', 29),
('bee', '蜜蜂', '🐝', 'animal', 30),
('rose', '玫瑰', '🌹', 'nature', 31),
('sun', '太阳', '☀️', 'nature', 32),
('moon', '月亮', '🌙', 'nature', 33),
('star', '星星', '⭐', 'nature', 34),
('cloud', '云', '☁️', 'nature', 35),
('rainbow', '彩虹', '🌈', 'nature', 36),
('heart', '红心', '❤️', 'symbol', 37),
('broken_heart', '心碎', '💔', 'symbol', 38),
('fire', '火焰', '🔥', 'symbol', 39),
('thumbs_up', '赞', '👍', 'gesture', 40),
('thumbs_down', '踩', '👎', 'gesture', 41),
('clap', '鼓掌', '👏', 'gesture', 42),
('wave', '挥手', '👋', 'gesture', 43),
('ok', 'OK', '👌', 'gesture', 44),
('pray', '祈祷', '🙏', 'gesture', 45),
('muscle', '肌肉', '💪', 'gesture', 46),
('gift', '礼物', '🎁', 'object', 47),
('cake', '蛋糕', '🎂', 'object', 48),
('coffee', '咖啡', '☕', 'object', 49),
('beer', '啤酒', '🍺', 'object', 50),
('pizza', '披萨', '🍕', 'object', 51),
('ice_cream', '冰淇淋', '🍦', 'object', 52),
('music', '音乐', '🎵', 'object', 53),
('movie', '电影', '🎬', 'object', 54),
('book', '书', '📚', 'object', 55),
('game', '游戏', '🎮', 'object', 56),
('phone', '手机', '📱', 'object', 57),
('computer', '电脑', '💻', 'object', 58),
('camera', '相机', '📷', 'object', 59),
('money', '钱', '💰', 'object', 60);
