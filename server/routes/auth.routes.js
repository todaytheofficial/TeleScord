// Этот модуль содержит логику для регистрации, входа, проверки сессии и управления профилем.

const express = require('express');
const router = express.Router();
const multer = require('multer'); // Для обработки загрузки файлов
const path = require('path');
// const bcrypt = require('bcryptjs'); // В реальном проекте
// const jwt = require('jsonwebtoken'); // В реальном проекте

// --- КОНФИГУРАЦИЯ MULTER (Хранение файлов) ---
// Хранение в памяти (для простоты) или на диске
const storage = multer.memoryStorage(); // Используем память для Canvas
const upload = multer({ storage: storage });

// --- СТАТУС КОДА (Для более наглядного тестирования) ---
const SECRET_KEY = 'YOUR_SUPER_SECRET_KEY';
const JWT_EXPIRE_TIME = '1h';

// --- ЗАГЛУШКИ (Мок-БД и Мок-функции) ---
const DUMMY_USERS = [
    // Обратите внимание: avatarPath теперь указывает на место, где будет храниться файл
    { id: 'user123', username: 'ТестовыйПользователь', passwordHash: 'hashedpassword', email: 'test@example.com', avatarPath: '/uploads/default_tp.png', friends: ['user456', 'user789'], requestsSent: [], requestsReceived: [] },
    { id: 'user456', username: 'Лена', passwordHash: 'hashedpassword', email: 'lena@ex.com', avatarPath: '/uploads/default_lena.png', friends: ['user123'], requestsSent: [], requestsReceived: [] },
    { id: 'user789', username: 'Андрей', passwordHash: 'hashedpassword', email: 'andrei@ex.com', avatarPath: '/uploads/default_andrei.png', friends: ['user123'], requestsSent: ['user101'], requestsReceived: [] },
    { id: 'user101', username: 'НовыйДруг', passwordHash: 'hashedpassword', email: 'new@ex.com', avatarPath: '/uploads/default_new.png', friends: [], requestsSent: [], requestsReceived: ['user789'] }
];

// Имитация хэширования и проверки
const hashPassword = (password) => 'hashedpassword';
const comparePassword = (password, hash) => hash === 'hashedpassword'; 
const generateToken = (payload) => `JWT_Token_${payload.id}`; 
const verifyToken = (token) => {
    if (token.startsWith('JWT_Token_')) {
        return { id: token.replace('JWT_Token_', '') };
    }
    return null;
};

const findUserById = (id) => DUMMY_USERS.find(u => u.id === id);
const findUserByUsername = (username) => DUMMY_USERS.find(u => u.username === username);

const saveUserToDB = (user) => {
    const index = DUMMY_USERS.findIndex(u => u.id === user.id);
    if (index !== -1) {
        DUMMY_USERS[index] = user;
    } else {
        DUMMY_USERS.push(user);
    }
    console.log(`[DB MOCK] Пользователь ${user.username} обновлен.`);
};

// --- Middleware для проверки аутентификации (проверяет куки) ---
const authMiddleware = (req, res, next) => {
    const token = req.cookies.auth_token;
    if (!token) {
        return res.status(401).json({ message: 'Нет токена аутентификации.' });
    }

    const payload = verifyToken(token);
    if (!payload) {
        return res.status(401).json({ message: 'Недействительный токен.' });
    }

    req.userId = payload.id;
    next();
};

// --- Маршруты Аутентификации ---

/** POST /api/auth/register: Регистрация */
router.post('/register', (req, res) => {
    const { username, email, password } = req.body;
    if (findUserByUsername(username)) {
        return res.status(409).json({ message: 'Имя пользователя занято.' });
    }

    const userId = `user_${Date.now()}`;
    const newUser = {
        id: userId,
        username,
        email,
        passwordHash: hashPassword(password),
        avatarPath: '/uploads/default_anon.png', // Дефолтный аватар
        friends: [],
        requestsSent: [],
        requestsReceived: []
    };
    saveUserToDB(newUser);
    
    const token = generateToken({ id: userId });
    // Куки устанавливаются: httpOnly=true (для безопасности), maxAge (1 час)
    res.cookie('auth_token', token, { httpOnly: true, maxAge: 3600000 });
    res.status(201).json({ message: 'Регистрация успешна.', userId, username, avatarPath: newUser.avatarPath });
});

/** POST /api/auth/login: Вход */
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = findUserByUsername(username);

    if (!user || !comparePassword(password, user.passwordHash)) {
        return res.status(401).json({ message: 'Неверные данные для входа.' });
    }

    const token = generateToken({ id: user.id });
    res.cookie('auth_token', token, { httpOnly: true, maxAge: 3600000 });
    res.json({ message: 'Вход успешен.', userId: user.id, username: user.username, avatarPath: user.avatarPath });
});

/** POST /api/auth/logout: Выход (очистка куки) */
router.post('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: 'Выход выполнен.' });
});

/** GET /api/auth/verify: Проверка сессии (куки) */
router.get('/verify', authMiddleware, (req, res) => {
    const user = findUserById(req.userId);
    if (!user) {
         return res.status(404).json({ message: 'Пользователь не найден.' });
    }
    // Отправляем данные пользователя для инициализации UI
    res.json({ 
        userId: user.id, 
        username: user.username, 
        avatarPath: user.avatarPath,
        friends: user.friends.map(id => findUserById(id)).filter(f => f),
        requestsReceived: user.requestsReceived.map(id => findUserById(id)).filter(f => f)
    });
});

// --- Маршруты Профиля и Файлов ---

/** POST /api/auth/profile/avatar: Загрузка аватара */
router.post('/profile/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
    // В реальном проекте, файл req.file сохраняется на диск, а путь - в БД
    const user = findUserById(req.userId);
    if (!user) {
        return res.status(404).json({ message: 'Пользователь не найден.' });
    }

    if (req.file) {
        // Имитация сохранения: используем уникальное имя для отображения в UI
        // В реальном приложении этот путь должен указывать на сохраненный файл
        const newAvatarPath = `/uploads/${user.id}_${Date.now()}_avatar.png`; 
        user.avatarPath = newAvatarPath; 
        saveUserToDB(user);
        
        console.log(`[FILE MOCK] Аватар для ${user.username} обновлен.`);
        return res.json({ message: 'Аватар успешно обновлен.', avatarPath: newAvatarPath });
    }

    res.status(400).json({ message: 'Файл аватара не был предоставлен.' });
});

// --- Маршруты Друзей ---

/** POST /api/auth/friends/request: Отправка заявки в друзья */
router.post('/friends/request', authMiddleware, (req, res) => {
    const { targetUsername } = req.body;
    const sender = findUserById(req.userId);
    const receiver = findUserByUsername(targetUsername);

    if (!receiver) return res.status(404).json({ message: 'Пользователь не найден.' });
    if (sender.id === receiver.id) return res.status(400).json({ message: 'Нельзя добавить себя.' });
    if (sender.friends.includes(receiver.id)) return res.status(400).json({ message: 'Вы уже друзья.' });
    if (sender.requestsSent.includes(receiver.id)) return res.status(400).json({ message: 'Заявка уже отправлена.' });
    if (receiver.requestsReceived.includes(sender.id)) return res.status(400).json({ message: 'Пользователь уже отправил вам заявку.' }); // Избегаем дубликатов

    // Имитация добавления заявки
    sender.requestsSent.push(receiver.id);
    receiver.requestsReceived.push(sender.id);
    saveUserToDB(sender);
    saveUserToDB(receiver);
    
    // В реальном проекте здесь будет Socket.IO уведомление
    res.json({ message: `Заявка в друзья отправлена ${targetUsername}.` });
});

/** POST /api/auth/friends/accept: Принятие заявки в друзья */
router.post('/friends/accept', authMiddleware, (req, res) => {
    const { senderId } = req.body;
    const acceptor = findUserById(req.userId);
    const sender = findUserById(senderId);

    if (!sender) return res.status(404).json({ message: 'Отправитель заявки не найден.' });
    if (!acceptor.requestsReceived.includes(senderId)) return res.status(400).json({ message: 'Нет входящей заявки от этого пользователя.' });

    // Перемещаем из заявок в друзья
    acceptor.requestsReceived = acceptor.requestsReceived.filter(id => id !== senderId);
    sender.requestsSent = sender.requestsSent.filter(id => id !== acceptor.id);

    // Добавляем в друзья
    acceptor.friends.push(senderId);
    sender.friends.push(acceptor.id);

    saveUserToDB(acceptor);
    saveUserToDB(sender);

    res.json({ message: `Вы теперь друзья с ${sender.username}!`, newFriend: { id: sender.id, username: sender.username, avatarPath: sender.avatarPath } });
});


module.exports = router;