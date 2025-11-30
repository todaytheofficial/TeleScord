// Этот модуль содержит логику для регистрации, входа, проверки сессии и управления профилем.

const express = require('express');
const router = express.Router();
const multer = require('multer'); 
// const bcrypt = require('bcryptjs'); // В реальном проекте, используйте bcrypt для хэширования!

// --- КОНФИГУРАЦИЯ MULTER (Хранение файлов) ---
const storage = multer.memoryStorage(); 
const upload = multer({ storage: storage });

// --- КОНСТАНТЫ ИМИДЖЕЙ ---
// Надежные Placeholder URL в высоком разрешении 512x512
const AVATAR_PLACEHOLDER = 'https://placehold.co/512x512/3F51B5/FFFFFF/png?text=TS';
const DEFAULT_AVATARS = {
    'ТестовыйПользователь': 'https://placehold.co/512x512/5C70D0/FFFFFF/png?text=T',
    'Лена': 'https://placehold.co/512x512/4CAF50/FFFFFF/png?text=L',
    'Андрей': 'https://placehold.co/512x512/F44336/FFFFFF/png?text=A',
    'НовыйДруг': 'https://placehold.co/512x512/FF9800/FFFFFF/png?text=N'
};

// --- ВНИМАНИЕ: МОК-ФУНКЦИИ БЕЗОПАСНОСТИ ---
// В реальном приложении НИКОГДА не храните пароли в открытом виде.
// Используйте библиотеки, такие как 'bcrypt', для хэширования.
const MOCK_PASSWORD_FOR_TEST_USERS = 'password123';
const comparePassword = (inputPassword, storedPassword) => inputPassword === storedPassword; 
const hashPassword = (password) => password; // Для мока мы просто храним пароль в открытом виде

// --- ИМИТАЦИЯ БАЗЫ ДАННЫХ SQLite (В ПАМЯТИ) ---
// Этот класс имитирует асинхронное взаимодействие с SQLite
class SQLiteMockDB {
    constructor() {
        this.users = {}; // Key: userId, Value: userObject
        this.initializeData();
    }

    // Загрузка начальных мок-данных
    initializeData() {
        // Мы используем MOCK_PASSWORD_FOR_TEST_USERS как "хэш" для имитации
        const mockUsers = [
            { id: 'user123', username: 'ТестовыйПользователь', password: MOCK_PASSWORD_FOR_TEST_USERS, email: 'test@example.com', avatarPath: DEFAULT_AVATARS['ТестовыйПользователь'], friends: ['user456', 'user789'], requestsSent: [], requestsReceived: [] },
            { id: 'user456', username: 'Лена', password: MOCK_PASSWORD_FOR_TEST_USERS, email: 'lena@ex.com', avatarPath: DEFAULT_AVATARS['Лена'], friends: ['user123'], requestsSent: [], requestsReceived: [] },
            { id: 'user789', username: 'Андрей', password: MOCK_PASSWORD_FOR_TEST_USERS, email: 'andrei@ex.com', avatarPath: DEFAULT_AVATARS['Андрей'], friends: ['user123'], requestsSent: ['user101'], requestsReceived: [] },
            { id: 'user101', username: 'НовыйДруг', password: MOCK_PASSWORD_FOR_TEST_USERS, email: 'new@ex.com', avatarPath: DEFAULT_AVATARS['НовыйДруг'], friends: [], requestsSent: [], requestsReceived: ['user789'] }
        ];
        mockUsers.forEach(user => this.users[user.id] = user);
    }

    // Имитация DB-операций (все асинхронны)
    async run(sql, params) { 
        // В реальной жизни: db.run(sql, params, callback)
        // Здесь просто имитация задержки и успеха
        await new Promise(resolve => setTimeout(resolve, 5));
        return { changes: 1 };
    }

    async get(sql, params) {
        // В реальной жизни: db.get(sql, params, callback)
        await new Promise(resolve => setTimeout(resolve, 5));
        const username = params.username || params.email;
        if (username) return Object.values(this.users).find(u => u.username === username || u.email === username);
        if (params.id) return this.users[params.id];
        return null;
    }

    // Имитация findUserById
    async findUserById(id) {
        return await this.get('SELECT * FROM users WHERE id = ?', { id });
    }

    // Имитация findUserByUsername
    async findUserByUsername(username) {
        return await this.get('SELECT * FROM users WHERE username = ?', { username });
    }

    // Имитация сохранения/обновления пользователя
    async saveUser(user) {
        // В реальной жизни: INSERT OR REPLACE INTO users (...) VALUES (...)
        await this.run('INSERT OR REPLACE INTO users VALUES (...)', user);
        this.users[user.id] = user;
        return user;
    }
}

const dbMock = new SQLiteMockDB();

// --- Вспомогательные Функции ---

const generateToken = (payload) => `JWT_Token_${payload.id}`; 
const verifyToken = (token) => {
    if (token && token.startsWith('JWT_Token_')) {
        return { id: token.replace('JWT_Token_', '') };
    }
    return null;
};


/**
 * Преобразует ID друзей/заявок в полные объекты пользователя.
 * @param {Array<string>} ids - массив ID пользователей
 */
const mapIdsToUsers = async (ids) => {
    const users = await Promise.all(ids.map(id => dbMock.findUserById(id)));
    return users.filter(u => u).map(u => ({
        id: u.id,
        username: u.username,
        avatarPath: u.avatarPath 
    }));
};

// --- Middleware для проверки аутентификации ---
const authMiddleware = async (req, res, next) => {
    const token = req.cookies.auth_token;
    const payload = verifyToken(token);
    
    if (!payload) {
        return res.status(401).json({ message: 'Нет токена аутентификации или он недействителен.' });
    }

    req.userId = payload.id;
    const user = await dbMock.findUserById(req.userId);
    if (!user) {
         return res.status(404).json({ message: 'Пользователь не найден.' });
    }
    req.user = user; // Прикрепляем объект пользователя к запросу
    next();
};

// --- Маршруты Аутентификации ---

/** POST /api/auth/register: Регистрация */
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (await dbMock.findUserByUsername(username)) {
        return res.status(409).json({ message: 'Имя пользователя занято.' });
    }

    const userId = `user_${Date.now()}`;
    const newUser = {
        id: userId,
        username,
        email,
        password: hashPassword(password), // Храним (мок) пароль
        avatarPath: AVATAR_PLACEHOLDER, // Используем надежный placeholder
        friends: [],
        requestsSent: [],
        requestsReceived: []
    };
    await dbMock.saveUser(newUser);
    
    const token = generateToken({ id: userId });
    res.cookie('auth_token', token, { httpOnly: true, maxAge: 3600000 });
    res.status(201).json({ message: 'Регистрация успешна.', userId, username, avatarPath: newUser.avatarPath });
});

/** POST /api/auth/login: Вход */
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await dbMock.findUserByUsername(username);

    // ИСПРАВЛЕНО: Теперь сравниваем введенный пароль с сохраненным мок-паролем
    if (!user || !comparePassword(password, user.password)) {
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
router.get('/verify', authMiddleware, async (req, res) => {
    const user = req.user;
    
    // Получаем полные данные для списков
    const friends = await mapIdsToUsers(user.friends);
    const requestsReceived = await mapIdsToUsers(user.requestsReceived);
    
    res.json({ 
        userId: user.id, 
        username: user.username, 
        avatarPath: user.avatarPath,
        friends: friends,
        requestsReceived: requestsReceived
    });
});

// --- Маршруты Профиля и Файлов ---

/** POST /api/auth/profile/avatar: Загрузка аватара */
router.post('/profile/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
    const user = req.user;

    if (req.file) {
        // Имитация сохранения: просто генерируем URL для отображения
        const newAvatarPath = `https://placehold.co/512x512/3F51B5/FFFFFF/png?text=${user.username.substring(0,1)}_${Date.now()}`; 
        
        user.avatarPath = newAvatarPath; 
        await dbMock.saveUser(user);
        
        return res.json({ message: 'Аватар успешно обновлен.', avatarPath: newAvatarPath });
    }

    res.status(400).json({ message: 'Файл аватара не был предоставлен.' });
});

// --- Маршруты Друзей ---

/** POST /api/auth/friends/request: Отправка заявки в друзья */
router.post('/friends/request', authMiddleware, async (req, res) => {
    const { targetUsername } = req.body;
    const sender = req.user;
    const receiver = await dbMock.findUserByUsername(targetUsername);

    if (!receiver) return res.status(404).json({ message: 'Пользователь не найден.' });
    if (sender.id === receiver.id) return res.status(400).json({ message: 'Нельзя добавить себя.' });
    if (sender.friends.includes(receiver.id)) return res.status(400).json({ message: 'Вы уже друзья.' });
    if (sender.requestsSent.includes(receiver.id)) return res.status(400).json({ message: 'Заявка уже отправлена.' });
    // Проверка на взаимную заявку
    if (receiver.requestsReceived.includes(sender.id)) {
        // Если получатель уже отправил заявку, автоматически принимаем ее
        return res.status(400).json({ message: 'Этот пользователь уже отправил вам заявку. Примите ее!' }); 
    }

    // Обновляем БД
    sender.requestsSent.push(receiver.id);
    receiver.requestsReceived.push(sender.id);
    await dbMock.saveUser(sender);
    await dbMock.saveUser(receiver);
    
    // ВАЖНО: Уведомление в реальном времени (нужен доступ к Socket.IO)
    if (router.socketNotifier) {
        router.socketNotifier.notifyFriendUpdate(receiver.id, sender.id);
    }

    res.json({ message: `Заявка в друзья отправлена ${targetUsername}.` });
});

/** POST /api/auth/friends/accept: Принятие заявки в друзья */
router.post('/friends/accept', authMiddleware, async (req, res) => {
    const { senderId } = req.body;
    const acceptor = req.user;
    const sender = await dbMock.findUserById(senderId);

    if (!sender) return res.status(404).json({ message: 'Отправитель заявки не найден.' });
    if (!acceptor.requestsReceived.includes(senderId)) return res.status(400).json({ message: 'Нет входящей заявки от этого пользователя.' });

    // Обновляем БД: удаляем заявки, добавляем в друзья
    acceptor.requestsReceived = acceptor.requestsReceived.filter(id => id !== senderId);
    sender.requestsSent = sender.requestsSent.filter(id => id !== acceptor.id);

    acceptor.friends.push(senderId);
    sender.friends.push(acceptor.id);

    await dbMock.saveUser(acceptor);
    await dbMock.saveUser(sender);
    
    // ВАЖНО: Уведомление в реальном времени (нужен доступ к Socket.IO)
    if (router.socketNotifier) {
        // Уведомляем обоих
        router.socketNotifier.notifyFriendUpdate(acceptor.id, sender.id);
        router.socketNotifier.notifyFriendUpdate(sender.id, acceptor.id);
    }
    
    const newFriendData = { id: sender.id, username: sender.username, avatarPath: sender.avatarPath };

    res.json({ message: `Вы теперь друзья с ${sender.username}!`, newFriend: newFriendData });
});


module.exports = router;