#!/usr/bin/env php
<?php
/**
 * WebSocket 服务器
 * 处理实时消息和在线状态
 * PHP 8+ 兼容版本
 */

error_reporting(E_ALL);
set_time_limit(0);
ob_implicit_flush();

$host = '0.0.0.0';
$port = 9000;

// 创建 socket
$socket = socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
if ($socket === false) {
    die("socket_create() 失败: " . socket_strerror(socket_last_error()) . "\n");
}

socket_set_option($socket, SOL_SOCKET, SO_REUSEADDR, 1);
socket_bind($socket, $host, $port);
socket_listen($socket);

echo "WebSocket 服务器启动在 $host:$port\n";

// 使用 spl_object_id 获取 socket 对象的唯一 ID
function getSocketId($socket) {
    return spl_object_id($socket);
}

// 客户端连接池 - socket ID => socket 对象
$clients = [];
// PID 到 socket ID 的映射
$pidToSocketId = [];
// socket ID 到 PID 的映射
$socketIdToPid = [];
// 已完成握手的 socket ID
$handshakeCompleted = [];

while (true) {
    // 构建 read 数组
    $read = [$socket];
    foreach ($clients as $client) {
        $read[] = $client;
    }
    $write = null;
    $except = null;
    
    if (socket_select($read, $write, $except, 0, 200000) < 1) {
        continue;
    }
    
    // 新连接
    if (in_array($socket, $read)) {
        $client = socket_accept($socket);
        $clientId = getSocketId($client);
        $clients[$clientId] = $client;
        echo "新连接: ID=$clientId\n";
        
        // 从 read 数组中移除主 socket
        $key = array_search($socket, $read);
        unset($read[$key]);
    }
    
    // 处理客户端消息
    foreach ($read as $client) {
        if ($client === $socket) continue;
        
        $clientId = getSocketId($client);
        $bytes = @socket_recv($client, $buffer, 2048, 0);
        
        if ($bytes === false || $bytes === 0) {
            // 连接断开
            handleDisconnect($clientId, $clients, $pidToSocketId, $socketIdToPid, $handshakeCompleted);
            continue;
        }
        
        // WebSocket 握手
        if (!isset($handshakeCompleted[$clientId])) {
            if (strpos($buffer, 'Sec-WebSocket-Key') !== false) {
                performHandshake($client, $buffer);
                $handshakeCompleted[$clientId] = true;
                echo "WebSocket 握手完成: ID=$clientId\n";
            }
            continue;
        }
        
        // 解析 WebSocket 数据帧
        $data = unmask($buffer);
        if ($data === false || $data === '') {
            continue;
        }
        
        $message = json_decode($data, true);
        if (!$message) {
            continue;
        }
        
        handleMessage($clientId, $client, $message, $clients, $pidToSocketId, $socketIdToPid);
    }
}

socket_close($socket);

/**
 * WebSocket 握手
 */
function performHandshake($client, $headers) {
    $lines = explode("\n", $headers);
    $key = '';
    
    foreach ($lines as $line) {
        if (strpos($line, 'Sec-WebSocket-Key') !== false) {
            $key = trim(substr($line, strpos($line, ':') + 1));
            break;
        }
    }
    
    $acceptKey = base64_encode(sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true));
    
    $response = "HTTP/1.1 101 Switching Protocols\r\n";
    $response .= "Upgrade: websocket\r\n";
    $response .= "Connection: Upgrade\r\n";
    $response .= "Sec-WebSocket-Accept: $acceptKey\r\n\r\n";
    
    socket_write($client, $response, strlen($response));
}

/**
 * 解析 WebSocket 数据帧
 */
function unmask($payload) {
    if (strlen($payload) < 2) {
        return false;
    }
    
    $length = ord($payload[1]) & 127;
    
    if ($length == 126) {
        if (strlen($payload) < 8) return false;
        $masks = substr($payload, 4, 4);
        $data = substr($payload, 8);
    } elseif ($length == 127) {
        if (strlen($payload) < 14) return false;
        $masks = substr($payload, 10, 4);
        $data = substr($payload, 14);
    } else {
        if (strlen($payload) < 6) return false;
        $masks = substr($payload, 2, 4);
        $data = substr($payload, 6);
    }
    
    $text = '';
    for ($i = 0; $i < strlen($data); ++$i) {
        $text .= $data[$i] ^ $masks[$i % 4];
    }
    
    return $text;
}

/**
 * 编码 WebSocket 数据帧
 */
function mask($text) {
    $length = strlen($text);
    $header = chr(129); // 0x81 = 10000001 (FIN + text frame)
    
    if ($length <= 125) {
        $header .= chr($length);
    } elseif ($length <= 65535) {
        $header .= chr(126) . pack('n', $length);
    } else {
        $header .= chr(127) . pack('J', $length);
    }
    
    return $header . $text;
}

/**
 * 发送消息到客户端
 */
function sendToClient($client, $data) {
    $message = mask(json_encode($data));
    @socket_write($client, $message, strlen($message));
}

/**
 * 处理断开连接
 */
function handleDisconnect($clientId, &$clients, &$pidToSocketId, &$socketIdToPid, &$handshakeCompleted) {
    $pid = $socketIdToPid[$clientId] ?? null;
    
    echo "客户端断开: ID=$clientId, PID=$pid\n";
    
    // 通知其他用户该用户已离线
    if ($pid) {
        broadcastUserStatus($pid, false, $clients, $pidToSocketId, $socketIdToPid);
        unset($pidToSocketId[$pid]);
        unset($socketIdToPid[$clientId]);
    }
    
    if (isset($clients[$clientId])) {
        @socket_close($clients[$clientId]);
        unset($clients[$clientId]);
    }
    
    unset($handshakeCompleted[$clientId]);
}

/**
 * 处理客户端消息
 */
function handleMessage($clientId, $client, $message, &$clients, &$pidToSocketId, &$socketIdToPid) {
    $type = $message['type'] ?? '';
    
    switch ($type) {
        case 'register':
            // 注册用户
            $pid = $message['pid'] ?? '';
            if (strlen($pid) === 32) {
                $pidToSocketId[$pid] = $clientId;
                $socketIdToPid[$clientId] = $pid;
                
                echo "用户注册: PID=$pid, ID=$clientId\n";
                
                sendToClient($client, [
                    'type' => 'registered',
                    'success' => true
                ]);
                
                // 广播用户上线
                broadcastUserStatus($pid, true, $clients, $pidToSocketId, $socketIdToPid);
            }
            break;
            
        case 'send':
            // 发送消息
            $to = $message['to'] ?? '';
            $from = $message['from'] ?? '';
            $text = $message['text'] ?? '';
            $time = $message['time'] ?? time() * 1000;
            
            if ($to && $from && $text) {
                $targetSocketId = $pidToSocketId[$to] ?? null;
                
                if ($targetSocketId && isset($clients[$targetSocketId])) {
                    // 对方在线，发送消息
                    sendToClient($clients[$targetSocketId], [
                        'type' => 'message',
                        'from' => $from,
                        'to' => $to,
                        'text' => $text,
                        'time' => $time
                    ]);
                    
                    // 发送确认给发送者
                    sendToClient($client, [
                        'type' => 'sent',
                        'success' => true,
                        'online' => true
                    ]);
                    
                    echo "消息发送: $from -> $to\n";
                } else {
                    // 对方不在线
                    sendToClient($client, [
                        'type' => 'sent',
                        'success' => false,
                        'online' => false,
                        'error' => '对方已经离开'
                    ]);
                    
                    echo "消息发送失败(对方离线): $from -> $to\n";
                }
            }
            break;
            
        case 'checkStatus':
            // 检查用户在线状态
            $targetPid = $message['pid'] ?? '';
            $online = isset($pidToSocketId[$targetPid]) && isset($clients[$pidToSocketId[$targetPid]]);
            
            sendToClient($client, [
                'type' => 'status',
                'pid' => $targetPid,
                'online' => $online
            ]);
            break;
            
        case 'ping':
            // 心跳
            sendToClient($client, ['type' => 'pong']);
            break;
    }
}

/**
 * 广播用户在线状态
 */
function broadcastUserStatus($pid, $online, &$clients, &$pidToSocketId, &$socketIdToPid) {
    $message = [
        'type' => 'userStatus',
        'pid' => $pid,
        'online' => $online
    ];
    
    foreach ($clients as $clientId => $client) {
        if (isset($socketIdToPid[$clientId])) {
            sendToClient($client, $message);
        }
    }
    
    echo "广播用户状态: PID=$pid, online=" . ($online ? 'true' : 'false') . "\n";
}
