// 1. Импорт модулей
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth.routes'); 
// 🌟 НОВЫЙ ИМПОРТ: sqlite3
const sqlite3 = require('sqlite3').verbose(); 

// 2. Инициализация Express и HTTP-сервера
const app = express();
const server = http.createServer(app); 

// 🌟 НАСТРОЙКА БАЗЫ ДАННЫХ SQLite
const DB_PATH = path.join(__dirname, 'telescord.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.message);
    } else {
        console.log('✅ Подключено к базе данных SQLite.');
        // Создаем таблицу сообщений, если она не существует
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            senderId TEXT NOT NULL,
            receiverId TEXT NOT NULL,
            message TEXT,
            isMedia BOOLEAN DEFAULT 0,
            mediaType TEXT,
            mediaData TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Ошибка создания таблицы messages:', err.message);
            }
        });
    }
});
// 🌟 Готовим функцию для асинхронных запросов (промисификация)
const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

// 3. Инициализация Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e7 
});

// 4. Настройка Middleware
const publicPath = path.join(__dirname, '..', 'public'); 
app.use(express.static(publicPath)); 
app.use('/uploads', express.static(publicPath)); 
app.use(express.json()); 
app.use(cookieParser()); 

// 5. Хранилище для Сокетов и Real-time
const userToSocket = {}; 

const notifyFriendUpdate = (userId, actedOnUserId) => {
    const socketId = userToSocket[userId];
    if (socketId) {
        io.to(socketId).emit('friend_update', { message: `Обновление списка друзей/заявок, инициировано: ${actedOnUserId}` });
        console.log(`[SOCKET] Отправлено friend_update пользователю: ${userId}`);
    }
}

// 6. Подключение Маршрутов Аутентификации
authRoutes.socketNotifier = { notifyFriendUpdate };
app.use('/api/auth', authRoutes); 

// 🌟 НОВЫЙ МАРШРУТ: Загрузка истории сообщений (используется клиентом)
app.get('/api/auth/messages/history/:recipientId', async (req, res) => {
    // В реальном приложении здесь должна быть middleware-проверка аутентификации
    // Для этого примера: предполагаем, что currentUserId извлекается из JWT или сессии
    // Поскольку у нас нет полной реализации auth, мы используем заглушку
    const currentUserId = req.cookies.userIdPlaceholder || 'user_id_1'; // Замените на реальную логику
    const recipientId = req.params.recipientId;

    if (!currentUserId || !recipientId) {
        return res.status(400).json({ message: 'Недостаточно данных для получения истории.' });
    }

    try {
        const history = await new Promise((resolve, reject) => {
            // Ищем сообщения, где отправитель/получатель - мы и собеседник, 
            // и наоборот, затем сортируем по времени.
            db.all(
                `SELECT senderId, receiverId, message, isMedia, mediaType, mediaData, timestamp 
                 FROM messages 
                 WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)
                 ORDER BY timestamp ASC`,
                [currentUserId, recipientId, recipientId, currentUserId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
        
        // Добавляем флаг isHistory, чтобы клиент мог отличить от live-сообщений
        const formattedHistory = history.map(msg => ({ ...msg, isHistory: true }));
        res.status(200).json(formattedHistory);
    } catch (error) {
        console.error('Ошибка при получении истории чата:', error);
        res.status(500).json({ message: 'Ошибка сервера при получении истории чата.' });
    }
});


// 7. Обработка Соединений Socket.IO (Реальное время)
io.on('connection', (socket) => {
    console.log(`🔌 Пользователь подключен: ${socket.id}`);

    // === ЛОГИКА АВТОРИЗАЦИИ SOCKET ===
    socket.on('register_socket', (data) => {
        const { userId, username } = data;
        socket.userId = userId;
        socket.username = username;
        userToSocket[userId] = socket.id;
        console.log(`[AUTH] Пользователь ${username} зарегистрировал socket.`);
    });

    // === ЛОГИКА DM (Личные Сообщения) ===
    socket.on('dm_message', async (data) => { // 🌟 Сделали async для работы с БД
        const { receiverId, message, isMedia = false, mediaType = null, mediaData = null } = data;
        const senderId = socket.userId;
        
        // 🌟 ШАГ 1: Сохранение DM в БД
        try {
            const sql = `INSERT INTO messages (senderId, receiverId, message, isMedia, mediaType, mediaData)
                         VALUES (?, ?, ?, ?, ?, ?)`;
            await dbRun(sql, [senderId, receiverId, message, isMedia, mediaType, mediaData]);
            console.log(`[DB] DM сохранено: ${senderId} -> ${receiverId}`);
        } catch (error) {
            console.error('Ошибка сохранения DM в БД:', error);
            // Можно отправить ошибку обратно клиенту, но проигнорируем для простоты
        }
        
        // Добавляем недостающие данные о себе в сообщение
        const messageData = { 
            ...data, 
            senderId: senderId,
            author: socket.username
        };
        
        // 🌟 ШАГ 2: Отправка DM
        // Отправляем сообщение отправителю (для мгновенного отображения)
        socket.emit('dm_message', messageData);
        
        // Отправляем сообщение получателю, если он онлайн
        const receiverSocketId = userToSocket[receiverId];
        if (receiverSocketId && receiverSocketId !== socket.id) {
              io.to(receiverSocketId).emit('dm_message', messageData);
        }
        
        console.log(`[DM] Сообщение от ${socket.username} (${isMedia ? mediaType : 'текст'}) отправлено ${receiverId}.`);
    });
    
// app.js (фрагмент)
const mediaUrl = data.mimeType.startsWith('image') 
    ? `https://placehold.co/512x512/3F51B5/FFFFFF/png?etxt=IMG_${Date.now()}` // <--- Это ваша синяя заглушка
    : `/uploads/mock_media.${fileExtension}`; 
callback({ success: true, url: mediaUrl });
        console.log(`[MEDIA MOCK] Файл ${data.filename} (${data.mimeType}) обработан. URL: ${mediaUrl}`);
        callback({ success: true, url: mediaUrl });
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            delete userToSocket[socket.userId];
            console.log(`🚫 Пользователь ${socket.username} отключен.`);
        }
    });


// 8. Запуск Сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Telescord Server запущен на порте ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере.`);
});