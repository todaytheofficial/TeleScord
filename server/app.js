// 1. Импорт модулей
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth.routes'); 

// 2. Инициализация Express и HTTP-сервера
const app = express();
const server = http.createServer(app); 

// 3. Инициализация Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    // Увеличиваем лимит до 10MB для файлов - это ускоряет обработку больших данных
    maxHttpBufferSize: 1e7 
});

// 4. Настройка Middleware
const publicPath = path.join(__dirname, '..', 'public'); 
app.use(express.static(publicPath)); 

// ВАЖНО: Раздача загруженных файлов (avatars/media) из папки /uploads
// Здесь мы используем ту же папку public для имитации загрузки
app.use('/uploads', express.static(publicPath)); 

app.use(express.json()); 
app.use(cookieParser()); // Включаем обработчик куки

// 5. Подключение Маршрутов Аутентификации
app.use('/api/auth', authRoutes); 

// 6. Хранилище для DM (имитация)
const dmRooms = {}; // { 'user1_user2': [{...messages...}] }
const userToSocket = {}; // { 'userId': 'socketId' }

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
        
        // В реальном проекте это было бы уведомление о статусе
    });

    // === ЛОГИКА DM (Личные Сообщения) ===
    socket.on('dm_message', (data) => {
        const { receiverId, message, author, isMedia, mediaType, mediaData } = data;
        const senderId = socket.userId;
        
        // Ключ комнаты DM: сортируем ID, чтобы обеспечить уникальность (user123_user456)
        const roomKey = [senderId, receiverId].sort().join('_');
        
        // Отправляем сообщение отправителю (для мгновенного отображения)
        socket.emit('dm_message', { ...data, senderId: senderId });
        
        // Отправляем сообщение получателю, если он онлайн
        const receiverSocketId = userToSocket[receiverId];
        if (receiverSocketId && receiverSocketId !== socket.id) {
             io.to(receiverSocketId).emit('dm_message', { ...data, senderId: senderId });
        }
        
        // Здесь будет логика сохранения DM в БД
        dmRooms[roomKey] = dmRooms[roomKey] || [];
        dmRooms[roomKey].push({ senderId, message, isMedia, mediaType, mediaData, timestamp: Date.now() });
    });
    
    // === ОБРАБОТКА ФАЙЛОВ (через Socket.IO) ===
    socket.on('media_upload', (data, callback) => {
        // Здесь происходит имитация обработки файла.
        // ВАЖНО: В текущей мок-реализации мы просто возвращаем URL
        const mediaUrl = `/uploads/${socket.userId}_${Date.now()}_${data.filename}`;
        console.log(`[MEDIA MOCK] Файл ${data.filename} загружен. URL: ${mediaUrl}`);
        // Вызываем callback с URL, который клиент будет использовать для отправки DM
        callback({ success: true, url: mediaUrl });
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            delete userToSocket[socket.userId];
            console.log(`🚫 Пользователь ${socket.username} отключен.`);
        }
    });
});

// 8. Запуск Сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Telescord Server запущен на порте ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере.`);
});