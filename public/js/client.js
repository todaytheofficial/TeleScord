// --- КОНФИГУРАЦИЯ ---
let currentUserId = null;
let currentUsername = null;
let currentUserAvatar = null;
let isRegisterMode = false;
let currentDMRecipient = null; // ID текущего собеседника
const API_URL = '/api/auth'; 

// --- Инициализация Socket.IO ---
const socket = io();

// --- DOM Элементы ---
const chatApp = document.getElementById('chat-app');
const authModal = document.getElementById('auth-modal');
const settingsModal = document.getElementById('settings-modal');
const addFriendModal = document.getElementById('add-friend-modal');

const messages = document.getElementById('messages');
const chatWindow = document.getElementById('chat-window');
const dmInputArea = document.getElementById('dm-input-area');
const dmForm = document.getElementById('dm-form');
const dmInput = document.getElementById('dm-input');
const mediaUploadInput = document.getElementById('media-upload');
const dmRecipientName = document.getElementById('dm-recipient-name');

// Auth элементы
const authForm = document.getElementById('auth-form');
const authToggle = document.getElementById('toggle-auth');
const authEmail = document.getElementById('auth-email');
const authTitle = document.getElementById('auth-title');
const authMessage = document.getElementById('auth-message');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');

// Профиль/Настройки элементы
const profileButton = document.getElementById('user-profile-button');
const logoutButton = document.getElementById('logout-button');
const settingsForm = document.getElementById('profile-settings-form');
const currentAvatar = document.getElementById('current-avatar');
const currentUsernameSpan = document.getElementById('current-username');
const previewAvatar = document.getElementById('preview-avatar');
const avatarInput = document.getElementById('avatar-input');

// Друзья
const friendsList = document.getElementById('friends-list');
const requestsList = document.getElementById('requests-list');
const addFriendButton = document.getElementById('add-friend-button');
const addFriendForm = document.getElementById('add-friend-form');
const targetUsernameInput = document.getElementById('target-username');
const addFriendMessage = document.getElementById('add-friend-message');

let currentFriends = [];
let currentRequests = [];

// --- Утилиты UI ---

function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.remove('hidden');
    element.style.backgroundColor = isError ? 'rgba(244, 67, 54, 0.4)' : 'rgba(76, 175, 80, 0.4)';
    setTimeout(() => element.classList.add('hidden'), 5000);
}

function scrollToBottom() { chatWindow.scrollTop = chatWindow.scrollHeight; }
function toggleAppVisibility(isAuthenticated) {
    if (isAuthenticated) {
        authModal.classList.add('hidden');
        chatApp.classList.remove('hidden');
    } else {
        chatApp.classList.add('hidden');
        authModal.classList.remove('hidden');
    }
}

function updateUserInfo(username, avatarUrl) {
    currentUsername = username;
    currentUserAvatar = avatarUrl;
    currentUsernameSpan.textContent = username;
    // Аватар в заголовке
    currentAvatar.style.backgroundImage = `url(${avatarUrl})`;
    // Аватар в настройках
    previewAvatar.src = avatarUrl;
    document.getElementById('settings-username').value = username;
}

// --- Рендеринг (Друзья и Заявки) ---

function renderFriends(friends) {
    friendsList.innerHTML = '';
    currentFriends = friends;
    if (friends.length === 0) {
        friendsList.innerHTML = '<li class="system-message small">У вас пока нет друзей.</li>';
    }
    friends.forEach(friend => {
        const li = document.createElement('li');
        li.className = 'friend-item';
        li.dataset.userId = friend.id;
        li.onclick = () => openDM(friend);
        
        // Аватар
        const avatar = document.createElement('div');
        avatar.className = 'friend-avatar';
        avatar.style.backgroundImage = `url(${friend.avatarPath})`;
        
        li.appendChild(avatar);
        li.appendChild(document.createTextNode(friend.username));
        friendsList.appendChild(li);
        
        // Добавляем класс active, если это текущий собеседник
        if (currentDMRecipient && currentDMRecipient.id === friend.id) {
            li.classList.add('active');
        }
    });
}

function renderRequests(requests) {
    requestsList.innerHTML = '';
    currentRequests = requests;
    if (requests.length === 0) {
        requestsList.innerHTML = '<li class="system-message small">Заявок нет.</li>';
    }
    requests.forEach(req => {
        const li = document.createElement('li');
        li.className = 'friend-item request-item';
        
        // Аватар
        const avatar = document.createElement('div');
        avatar.className = 'friend-avatar';
        avatar.style.backgroundImage = `url(${req.avatarPath})`;
        
        li.appendChild(avatar);
        li.appendChild(document.createTextNode(req.username));
        
        // Кнопки действий
        const actions = document.createElement('div');
        actions.className = 'request-actions';
        
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'send-button small accept';
        acceptBtn.textContent = 'Принять';
        acceptBtn.onclick = (e) => {
            e.stopPropagation();
            handleFriendAction(req.id, 'accept');
        };
        actions.appendChild(acceptBtn);

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'send-button small reject';
        rejectBtn.textContent = 'Отклонить';
        rejectBtn.onclick = (e) => {
            e.stopPropagation();
            // В реальном приложении здесь будет handleFriendAction(req.id, 'reject');
            showMessage(authMessage, `Заявка от ${req.username} отклонена. (Мок)`, false);
            // Имитация удаления из списка
            currentRequests = currentRequests.filter(r => r.id !== req.id);
            renderRequests(currentRequests);
        };
        actions.appendChild(rejectBtn);

        li.appendChild(actions);
        requestsList.appendChild(li);
    });
}

// --- Логика ЛС (DM) ---

/**
 * Рендерит историю сообщений, полученную с сервера.
 * @param {Array} messagesHistory - Массив объектов сообщений.
 */
function renderChatHistory(messagesHistory) {
    messages.innerHTML = ''; // Очищаем от системного сообщения/заглушки

    if (messagesHistory.length === 0) {
        messages.innerHTML = '<li class="system-message">Начните свой диалог!</li>';
    } else {
        messagesHistory.forEach(message => {
            // Используем ту же функцию appendMessage для рендеринга
            appendMessage(message); 
        });
    }
    scrollToBottom();
}

/*** 
 * @param {object} recipient - Объект друга, с которым открывается чат.
 */
async function openDM(recipient) {
    // 🌟 НОВОЕ УСЛОВИЕ: Проверяем, не открыт ли чат уже с этим собеседником
    if (currentDMRecipient && currentDMRecipient.id === recipient.id) {
        console.log('Чат с этим пользователем уже открыт. Игнорируем повторный клик.');
        return; // Выходим из функции
    }

    // 1. Обновление UI
    currentDMRecipient = recipient;
    dmRecipientName.textContent = `Чат с ${recipient.username}`;
    dmInputArea.classList.remove('hidden');

    // Снимаем активный класс со всех и добавляем к текущему
    document.querySelectorAll('.friend-item').forEach(item => item.classList.remove('active'));
    const recipientElement = document.querySelector(`[data-user-id="${recipient.id}"]`);
    if (recipientElement) {
        recipientElement.classList.add('active');
    }

    // 2. Загрузка истории с сервера
    messages.innerHTML = '<li class="system-message">Загрузка истории...</li>'; 

    try {
        const response = await fetch(`${API_URL}/messages/history/${recipient.id}`);
        if (response.ok) {
            const history = await response.json();
            renderChatHistory(history); 
        } else {
            messages.innerHTML = '<li class="system-message error">Ошибка загрузки истории чата.</li>';
        }
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        messages.innerHTML = '<li class="system-message error">Ошибка сети при загрузке истории.</li>';
    }
}


function appendMessage(data) {
    // Если сообщение не предназначено текущему открытому DM, игнорируем его
    // Мы убираем это условие, так как history теперь загружает только нужные сообщения.
    // Оставляем только проверку на текущего собеседника для сообщений, приходящих в реальном времени.
    if (!data.isHistory && data.senderId !== currentDMRecipient?.id && data.receiverId !== currentDMRecipient?.id && data.senderId !== currentUserId) {
        return;
    }
    
    const item = document.createElement('li');
    item.classList.add('message-item');
    
    const isOutgoing = data.senderId === currentUserId;
    if (isOutgoing) {
        item.classList.add('outgoing');
    }
    
    // Автор 
    // Для загруженных сообщений может прийти `author`, но для входящих real-time нужен `currentDMRecipient?.username`
    const authorName = isOutgoing ? currentUsername : currentDMRecipient?.username || data.author || "Неизвестно";

    const authorSpan = document.createElement('span');
    authorSpan.textContent = authorName;
    authorSpan.className = 'message-author';
    item.appendChild(authorSpan);


    if (data.isMedia) {
        const mediaContainer = document.createElement('div');
        mediaContainer.className = 'media-container';
        let mediaElement;

        const mediaType = data.mediaType || '';

        if (mediaType.startsWith('image')) {
            mediaElement = document.createElement('img');
            mediaElement.alt = "Изображение от пользователя";
        } else if (mediaType.startsWith('video')) {
            mediaElement = document.createElement('video');
            mediaElement.controls = true;
            mediaElement.autoplay = false;
        } else if (mediaType.startsWith('audio')) {
            mediaElement = document.createElement('audio');
            mediaElement.controls = true;
        } else {
             // Если тип медиа неизвестен или не поддерживается, выводим ошибку/заглушку
             item.appendChild(document.createTextNode(`[Файл не поддерживается: ${mediaType}]`));
        }

        if (mediaElement) {
            mediaElement.src = data.mediaData; 
            mediaContainer.appendChild(mediaElement);
            item.appendChild(mediaContainer);
        }
        
        // Добавляем текстовое описание, если оно есть
        if (data.message && data.message.trim()) {
              const textNode = document.createElement('p');
              textNode.textContent = data.message;
              item.appendChild(textNode);
        }
    } else {
        item.appendChild(document.createTextNode(data.message));
    }
    
    messages.appendChild(item);
    scrollToBottom();
}

// --- API ХЕНДЛЕРЫ (остаются без изменений) ---

async function initializeSession(skipUiToggle = false) {
    try {
        const response = await fetch(`${API_URL}/verify`);
        if (response.ok) {
            const data = await response.json();
            
            currentUserId = data.userId;
            updateUserInfo(data.username, data.avatarPath);

            if (!skipUiToggle) {
                 toggleAppVisibility(true);
            }
            
            // Загружаем списки друзей/заявок 
            renderFriends(data.friends);
            renderRequests(data.requestsReceived);
            
            // Регистрируем сокет (даже если skipUiToggle = true, это нужно делать)
            socket.emit('register_socket', { userId: data.userId, username: data.username });

        } else if (!skipUiToggle) {
            toggleAppVisibility(false);
        }
    } catch (error) {
        console.error('Ошибка проверки аутентификации:', error);
        if (!skipUiToggle) {
             toggleAppVisibility(false);
        }
    }
}

/** Отправка формы авторизации/регистрации */
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = authUsernameInput.value;
    const password = authPasswordInput.value;
    const email = isRegisterMode ? authEmail.value : undefined;

    const endpoint = isRegisterMode ? `${API_URL}/register` : `${API_URL}/login`;
    const payload = { username, password };
    if (email) payload.email = email;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        const isError = !response.ok;
        showMessage(authMessage, data.message, isError);

        if (response.ok) {
            // Очистка полей
            authUsernameInput.value = '';
            authPasswordInput.value = '';
            authEmail.value = '';
            authMessage.classList.add('hidden'); 
            
            // Инициализация сессии, которая обновит UI и зарегистрирует сокет
            initializeSession(false); 
        }
    } catch (error) {
        console.error('Ошибка сети:', error);
        showMessage(authMessage, 'Ошибка соединения с сервером.', true);
    }
});

/** Обновление профиля/аватара */
settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const avatarFile = avatarInput.files[0];

    if (avatarFile) {
        const formData = new FormData();
        formData.append('avatar', avatarFile);
        
        try {
            // Загрузка аватара (сервер вернет новый URL placeholder)
            const response = await fetch(`${API_URL}/profile/avatar`, {
                method: 'POST',
                body: formData 
            });

            const data = await response.json();
            if (response.ok) {
                updateUserInfo(currentUsername, data.avatarPath); // Обновляем путь к аватару
                showMessage(authMessage, 'Аватар успешно обновлен!', false);
            } else {
                showMessage(authMessage, data.message || 'Ошибка обновления аватара.', true);
            }

        } catch (error) {
            console.error('Ошибка загрузки аватара:', error);
            showMessage(authMessage, 'Ошибка сети при загрузке аватара.', true);
        }
    }
    
    settingsModal.classList.add('hidden');
});

/** Отправка DM и Медиа */
dmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const textMessage = dmInput.value.trim();
    const file = mediaUploadInput.files[0];
    
    if (!currentDMRecipient) {
        showMessage(authMessage, 'Сначала выберите собеседника!', true);
        return;
    }

    if (file) {
        // 1. Обработка файла
        const mimeType = file.type || 'application/octet-stream';
        
        // Отправляем на сервер только мета-данные файла для имитации загрузки
        socket.emit('media_upload', {
            filename: file.name,
            mimeType: mimeType
        }, (response) => {
            if (response.success) {
                // Если файл - не изображение, предупреждаем, что будет заглушка
                if (!mimeType.startsWith('image')) {
                    showMessage(authMessage, `Видео/аудио не могут быть загружены в этой среде, будет использована заглушка: ${response.url}`, false);
                }
                
                socket.emit('dm_message', {
                    receiverId: currentDMRecipient.id,
                    message: textMessage, 
                    author: currentUsername,
                    senderId: currentUserId,
                    isMedia: true,
                    mediaType: mimeType,
                    mediaData: response.url
                });
            } else {
                 showMessage(authMessage, 'Ошибка при обработке файла.', true);
            }
        });

    } else if (textMessage) {
        // 2. Отправка текстового сообщения
        socket.emit('dm_message', { 
            receiverId: currentDMRecipient.id,
            message: textMessage,
            author: currentUsername,
            senderId: currentUserId,
            isMedia: false
        });
    }

    dmInput.value = ''; 
    mediaUploadInput.value = ''; // Очищаем поле файла
});

/** Отправка заявки в друзья */
addFriendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const targetUsername = targetUsernameInput.value.trim();
    if (!targetUsername) return;

    try {
        const response = await fetch(`${API_URL}/friends/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUsername })
        });
        const data = await response.json();
        showMessage(addFriendMessage, data.message, !response.ok);
        if (response.ok) {
             targetUsernameInput.value = '';
        }
    } catch (error) {
        showMessage(addFriendMessage, 'Ошибка сети.', true);
    }
});

/** Обработка действия с заявкой (Принять) */
async function handleFriendAction(senderId, action) {
    if (action === 'accept') {
        try {
            const response = await fetch(`${API_URL}/friends/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senderId })
            });
            const data = await response.json();
            
            if (response.ok) {
                // Сервер обработал обновление и отправил 'friend_update' всем участникам через Socket.IO.
                showMessage(authMessage, data.message, false);
            } else {
                 showMessage(authMessage, data.message || 'Ошибка принятия заявки.', true);
            }
        } catch (error) {
             showMessage(authMessage, 'Ошибка сети.', true);
        }
    }
}

// --- Socket.IO ХЕНДЛЕРЫ ---

socket.on('dm_message', (data) => {
    // Входящее сообщение, которое нужно отобразить
    appendMessage(data);
});

// НОВОЕ: Обработчик для обновления списка друзей/заявок
socket.on('friend_update', () => {
    // Вызываем полную инициализацию, чтобы перечитать списки с сервера
    initializeSession(true); 
    showMessage(authMessage, 'Обновлен список друзей или заявок!', false);
});


// --- UI ХЕНДЛЕРЫ (Открытие/Закрытие Модальных окон) (Без изменений) ---

authToggle.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    authTitle.textContent = isRegisterMode ? 'Регистрация' : 'Вход';
    // ИСПРАВЛЕНИЕ: Гарантируем корректное отображение/скрытие поля Email
    authEmail.style.display = isRegisterMode ? 'block' : 'none'; 
    document.getElementById('auth-submit').textContent = isRegisterMode ? 'Зарегистрироваться' : 'Войти';
    authToggle.textContent = isRegisterMode ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
    authMessage.classList.add('hidden'); // Очищаем сообщение
    
    // Очистка полей при переключении режима
    authUsernameInput.value = '';
    authPasswordInput.value = '';
    authEmail.value = '';
});

profileButton.addEventListener('click', () => settingsModal.classList.remove('hidden'));
document.getElementById('close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));

addFriendButton.addEventListener('click', () => addFriendModal.classList.remove('hidden'));
document.getElementById('close-add-friend').addEventListener('click', () => addFriendModal.classList.add('hidden'));

// Обработка закрытия модальных окон при клике на оверлей
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
});
addFriendModal.addEventListener('click', (e) => {
    if (e.target === addFriendModal) addFriendModal.classList.add('hidden');
});


logoutButton.addEventListener('click', async () => {
    await fetch(`${API_URL}/logout`, { method: 'POST' });
    currentUserId = null;
    currentUsername = null;
    currentDMRecipient = null;
    updateUserInfo("...", "https://placehold.co/512x512/3F51B5/FFFFFF/png?text=TS"); // Сброс на надежный placeholder
    toggleAppVisibility(false);
    messages.innerHTML = '<li class="system-message">🚀 Ожидание подключения и авторизации...</li>';
    dmInputArea.classList.add('hidden');
    dmRecipientName.textContent = 'Выберите друга для начала чата';
    renderFriends([]);
    renderRequests([]);
});

avatarInput.addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewAvatar.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// --- ИНИЦИАЛИЗАЦИЯ ---
window.onload = () => initializeSession(false);