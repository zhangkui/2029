#!/usr/bin/env php
<?php

error_reporting(E_ALL);
set_time_limit(0);
ob_implicit_flush();

require_once 'db.php';

$host = '0.0.0.0';
$port = 9000;

$socket = socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
if ($socket === false) {
    die("socket_create() 失败: " . socket_strerror(socket_last_error()) . "\n");
}

socket_set_option($socket, SOL_SOCKET, SO_REUSEADDR, 1);
socket_bind($socket, $host, $port);
socket_listen($socket);

echo "WebSocket 服务器启动在 $host:$port\n";

function getSocketId($socket) {
    return spl_object_id($socket);
}

$clients = [];
$pidToSocketId = [];
$socketIdToPid = [];
$handshakeCompleted = [];

while (true) {
    $read = [$socket];
    foreach ($clients as $client) {
        $read[] = $client;
    }
    $write = null;
    $except = null;

    if (socket_select($read, $write, $except, 0, 200000) < 1) {
        continue;
    }

    if (in_array($socket, $read)) {
        $client = socket_accept($socket);
        $clientId = getSocketId($client);
        $clients[$clientId] = $client;
        echo "新连接: ID=$clientId\n";

        $key = array_search($socket, $read);
        unset($read[$key]);
    }

    foreach ($read as $client) {
        if ($client === $socket) continue;

        $clientId = getSocketId($client);
        $bytes = @socket_recv($client, $buffer, 4096, 0);

        if ($bytes === false || $bytes === 0) {
            handleDisconnect($clientId, $clients, $pidToSocketId, $socketIdToPid, $handshakeCompleted);
            continue;
        }

        if (!isset($handshakeCompleted[$clientId])) {
            if (strpos($buffer, 'Sec-WebSocket-Key') !== false) {
                performHandshake($client, $buffer);
                $handshakeCompleted[$clientId] = true;
                echo "WebSocket 握手完成: ID=$clientId\n";
            }
            continue;
        }

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

function mask($text) {
    $length = strlen($text);
    $header = chr(129);

    if ($length <= 125) {
        $header .= chr($length);
    } elseif ($length <= 65535) {
        $header .= chr(126) . pack('n', $length);
    } else {
        $header .= chr(127) . pack('J', $length);
    }

    return $header . $text;
}

function sendToClient($client, $data) {
    $message = mask(json_encode($data));
    @socket_write($client, $message, strlen($message));
}

function handleDisconnect($clientId, &$clients, &$pidToSocketId, &$socketIdToPid, &$handshakeCompleted) {
    $pid = $socketIdToPid[$clientId] ?? null;

    echo "客户端断开: ID=$clientId, PID=$pid\n";

    if ($pid) {
        try {
            setUserOffline($pid);
        } catch (Exception $e) {
            error_log("Error setting user offline: " . $e->getMessage());
        }

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

function handleMessage($clientId, $client, $message, &$clients, &$pidToSocketId, &$socketIdToPid) {
    $type = $message['type'] ?? '';

    switch ($type) {
        case 'register':
            $pid = $message['pid'] ?? '';
            if (strlen($pid) === 32) {
                $pidToSocketId[$pid] = $clientId;
                $socketIdToPid[$clientId] = $pid;

                echo "用户注册: PID=$pid, ID=$clientId\n";

                try {
                    updateUserActivity($pid, true);
                } catch (Exception $e) {
                    error_log("Error updating user activity: " . $e->getMessage());
                }

                sendToClient($client, [
                    'type' => 'registered',
                    'success' => true
                ]);

                broadcastUserStatus($pid, true, $clients, $pidToSocketId, $socketIdToPid);
            }
            break;

        case 'send':
            $to = $message['to'] ?? '';
            $from = $message['from'] ?? '';
            $text = $message['text'] ?? '';
            $time = $message['time'] ?? time() * 1000;

            if ($to && $from && $text) {
                $targetSocketId = $pidToSocketId[$to] ?? null;
                $targetOnline = $targetSocketId && isset($clients[$targetSocketId]);

                $messageId = null;
                try {
                    $conversationId = getOrCreateConversation($from, $to);
                    $status = $targetOnline ? 'delivered' : 'sent';
                    $messageId = saveMessage($conversationId, $from, $to, $text, $status);
                } catch (Exception $e) {
                    error_log("Error saving message: " . $e->getMessage());
                }

                if ($targetOnline) {
                    sendToClient($clients[$targetSocketId], [
                        'type' => 'message',
                        'from' => $from,
                        'to' => $to,
                        'text' => $text,
                        'time' => $time,
                        'messageId' => $messageId,
                        'status' => 'delivered'
                    ]);

                    sendToClient($client, [
                        'type' => 'sent',
                        'success' => true,
                        'online' => true,
                        'messageId' => $messageId,
                        'status' => 'delivered',
                        'to' => $to
                    ]);

                    echo "消息发送: $from -> $to, messageId=$messageId\n";
                } else {
                    sendToClient($client, [
                        'type' => 'sent',
                        'success' => false,
                        'online' => false,
                        'messageId' => $messageId,
                        'status' => 'sent',
                        'to' => $to,
                        'error' => '对方已经离开'
                    ]);

                    echo "消息存储(对方离线): $from -> $to, messageId=$messageId\n";
                }
            }
            break;

        case 'markAsRead':
            $userPid = $message['userPid'] ?? '';
            $otherPid = $message['otherPid'] ?? '';

            if ($userPid && $otherPid) {
                try {
                    $conversationId = getOrCreateConversation($userPid, $otherPid);
                    $markedCount = markMessagesAsRead($conversationId, $userPid);
                    updateLastReadAt($conversationId, $userPid);

                    $senderSocketId = $pidToSocketId[$otherPid] ?? null;
                    if ($senderSocketId && isset($clients[$senderSocketId])) {
                        sendToClient($clients[$senderSocketId], [
                            'type' => 'messagesRead',
                            'conversationId' => $conversationId,
                            'readerPid' => $userPid,
                            'markedCount' => $markedCount
                        ]);
                    }

                    echo "标记已读: $userPid 标记了 $markedCount 条来自 $otherPid 的消息\n";
                } catch (Exception $e) {
                    error_log("Error marking messages as read: " . $e->getMessage());
                }
            }
            break;

        case 'checkStatus':
            $targetPid = $message['pid'] ?? '';
            $online = isset($pidToSocketId[$targetPid]) && isset($clients[$pidToSocketId[$targetPid]]);

            sendToClient($client, [
                'type' => 'status',
                'pid' => $targetPid,
                'online' => $online
            ]);
            break;

        case 'ping':
            $pid = $socketIdToPid[$clientId] ?? null;
            if ($pid) {
                try {
                    updateUserActivity($pid);
                } catch (Exception $e) {
                    error_log("Error updating user activity on ping: " . $e->getMessage());
                }
            }
            sendToClient($client, ['type' => 'pong']);
            break;
    }
}

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
