let socket;
let username;
let myKeyPair;
let users = [];
let roomCode = null;

function escapeHTML(str) {
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scrollMessages() {
    const messages = document.getElementById('messages');
    messages.scrollTop = messages.scrollHeight;
}

function addMessageBubble({ sender, text, isImage, isSelf }) {
    const messages = document.getElementById('messages');
    const row = document.createElement('div');
    row.className = 'message-row' + (isSelf ? ' self' : '');

    const content = document.createElement('div');
    content.className = 'message-content';

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = isSelf ? 'You' : sender;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (isImage) {
        bubble.innerHTML = `<img src="${escapeHTML(text)}" alt="image" />`;
    } else {
        bubble.textContent = text;
    }

    content.appendChild(meta);
    content.appendChild(bubble);
    row.appendChild(content);
    messages.appendChild(row);
    scrollMessages();
}

function updateUsersList() {
    const usersDiv = document.getElementById('users');
    if (users.length === 1) {
        usersDiv.textContent = "You are alone in this room.";
        return;
    }
    usersDiv.textContent = "Online: " + users.map(u => u.username).join(", ");
}

async function ensureSodiumReady() {
    while (typeof window.sodium === 'undefined') {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    await window.sodium.ready;
}

function leaveRoom() {
    window.location.href = 'menu.html';
}

document.getElementById('leaveRoomBtn').onclick = leaveRoom;

window.onload = async function () {
    username = localStorage.getItem('username');
    roomCode = sessionStorage.getItem('roomCode');
    if (!username || !roomCode) {
        window.location.href = 'index.html';
        return;
    }
    document.getElementById('roomInfo').textContent = `Room: ${roomCode}`;
    await ensureSodiumReady();
    await startChat();
};

async function startChat() {
    let privateKeyB64 = localStorage.getItem('privateKey');
    let publicKeyB64 = localStorage.getItem('publicKey');
    if (!privateKeyB64 || !publicKeyB64) {
        const keyPair = sodium.crypto_box_keypair();
        privateKeyB64 = sodium.to_base64(keyPair.privateKey);
        publicKeyB64 = sodium.to_base64(keyPair.publicKey);
        localStorage.setItem('privateKey', privateKeyB64);
        localStorage.setItem('publicKey', publicKeyB64);
    }
    myKeyPair = {
        privateKey: sodium.from_base64(privateKeyB64),
        publicKey: sodium.from_base64(publicKeyB64)
    };

    const token = localStorage.getItem('token');
    socket = io({
        auth: { token }
    });

    socket.on('connect', () => {
        socket.emit('join-room', { roomCode });
    });

    socket.on('connect_error', (err) => {
        console.error('Socket.IO connection error:', err.message);
        alert('Connection error: ' + err.message);
    });

    socket.on('users', (userList) => {
        users = userList.map(u => ({ ...u, roomCode }));
        // Save for use on page reloads
        localStorage.setItem('users', JSON.stringify(users));
        updateUsersList();
    });

    socket.on('chat-history', async (messages) => {
        document.getElementById('messages').innerHTML = '';
        for (const m of messages) {
            // Show messages sent to us OR sent by us
            if (m.to === username) {
                await handleIncomingEncryptedMessage(m, true);
            } else if (m.from === username) {
                // Show your own sent message as "You"
                let plain = null;
                try {
                    // Get user list from memory or localStorage
                    const usersList = users.length ? users : JSON.parse(localStorage.getItem('users') || '[]');
                    const recipientObj = usersList.find(u => u.username === m.to);
                    if (recipientObj) {
                        const theirPublicKey = sodium.from_base64(recipientObj.publicKey);
                        const sharedKey = sodium.crypto_box_beforenm(theirPublicKey, myKeyPair.privateKey);

                        const fullCipher = sodium.from_base64(m.message);
                        const nonce = fullCipher.slice(0, sodium.crypto_box_NONCEBYTES);
                        const cipher = fullCipher.slice(sodium.crypto_box_NONCEBYTES);

                        const plainBytes = sodium.crypto_box_open_easy_afternm(cipher, nonce, sharedKey);
                        if (m.type === 'image') {
                            try {
                                const info = JSON.parse(sodium.to_string(plainBytes));
                                plain = info.header + info.base64;
                            } catch {
                                plain = sodium.to_string(plainBytes);
                            }
                            addMessageBubble({ sender: 'You', text: plain, isImage: true, isSelf: true });
                        } else {
                            plain = sodium.to_string(plainBytes);
                            addMessageBubble({ sender: 'You', text: plain, isImage: false, isSelf: true });
                        }
                    } else {
                        addMessageBubble({ sender: 'You', text: "[Recipient's publicKey not found]", isImage: false, isSelf: true });
                    }
                } catch {
                    addMessageBubble({ sender: 'You', text: "[Decryption failed]", isImage: false, isSelf: true });
                }
            }
        }
    });

    socket.on('encrypted-message', async (data) => {
        // Only process messages addressed to us
        if (data.to === username) {
            await handleIncomingEncryptedMessage(data, false);
        }
    });
}

async function handleIncomingEncryptedMessage(data, isHistory) {
    if (data.from === username) return;

    const sender = data.from;
    let senderObj = users.find(u => u.username === sender && u.roomCode === roomCode);
    // fallback to user list from localStorage for history rendering after reload
    if (!senderObj && !isHistory) {
        const usersList = JSON.parse(localStorage.getItem('users') || '[]');
        senderObj = usersList.find(u => u.username === sender && u.roomCode === roomCode);
    }
    if (!senderObj) {
        addMessageBubble({ sender, text: "[Error: Sender info missing]", isImage: false, isSelf: false });
        return;
    }
    const senderPublicKey = sodium.from_base64(senderObj.publicKey);
    let isSelf = sender === username;
    const sharedKey = sodium.crypto_box_beforenm(senderPublicKey, myKeyPair.privateKey);

    const fullCipher = sodium.from_base64(data.message);
    const nonce = fullCipher.slice(0, sodium.crypto_box_NONCEBYTES);
    const cipher = fullCipher.slice(sodium.crypto_box_NONCEBYTES);
    let msg;
    try {
        const plain = sodium.crypto_box_open_easy_afternm(cipher, nonce, sharedKey);
        if (data.type === 'image') {
            try {
                const info = JSON.parse(sodium.to_string(plain));
                msg = info.header + info.base64;
            } catch {
                msg = sodium.to_string(plain);
            }
            addMessageBubble({ sender, text: msg, isImage: true, isSelf });
        } else {
            msg = sodium.to_string(plain);
            addMessageBubble({ sender, text: msg, isImage: false, isSelf });
        }
    } catch (e) {
        addMessageBubble({ sender, text: "[Decryption failed]", isImage: false, isSelf });
    }
}

document.getElementById('sendForm').onsubmit = async function (e) {
    e.preventDefault();
    const msgInput = document.getElementById('msgInput');
    let text = msgInput.value.trim();
    if (!text) return;
    await sendMessageToAll(text, 'text');
    msgInput.value = '';
};

document.getElementById('attachBtn').onclick = () => {
    document.getElementById('imageInput').click();
};

document.getElementById('imageInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
        alert("File too large! Maximum file size: 500KB.");
        return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
        const dataUrl = evt.target.result;
        await sendMessageToAll(dataUrl, 'image');
    };
    reader.readAsDataURL(file);
};

async function sendMessageToAll(plain, type) {
    if (!users) return;
    if (type === 'image') {
        const commaIdx = plain.indexOf(',');
        if (commaIdx === -1) {
            addMessageBubble({ sender: 'You', text: '[Invalid image data]', isImage: false, isSelf: true });
            return;
        }
        const header = plain.slice(0, commaIdx + 1);
        const base64 = plain.slice(commaIdx + 1);
        const jsonString = JSON.stringify({ header, base64 });
        for (const user of users) {
            if (user.username === username) continue;
            const theirPublicKey = sodium.from_base64(user.publicKey);
            const sharedKey = sodium.crypto_box_beforenm(theirPublicKey, myKeyPair.privateKey);

            const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
            const plainBytes = sodium.from_string(jsonString);
            const cipher = sodium.crypto_box_easy_afternm(plainBytes, nonce, sharedKey);

            const fullCipher = new Uint8Array(nonce.length + cipher.length);
            fullCipher.set(nonce, 0);
            fullCipher.set(cipher, nonce.length);
            const payload = sodium.to_base64(fullCipher);

            // Send per recipient, with "to" field
            socket.emit('encrypted-message', {
                roomCode,
                to: user.username,
                from: username,
                message: payload,
                type
            });
        }
        addMessageBubble({ sender: 'You', text: plain, isImage: true, isSelf: true });
    } else {
        // text message
        for (const user of users) {
            if (user.username === username) continue;
            const theirPublicKey = sodium.from_base64(user.publicKey);
            const sharedKey = sodium.crypto_box_beforenm(theirPublicKey, myKeyPair.privateKey);

            const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
            const plainBytes = sodium.from_string(plain);
            const cipher = sodium.crypto_box_easy_afternm(plainBytes, nonce, sharedKey);

            const fullCipher = new Uint8Array(nonce.length + cipher.length);
            fullCipher.set(nonce, 0);
            fullCipher.set(cipher, nonce.length);
            const payload = sodium.to_base64(fullCipher);

            // Send per recipient, with "to" field
            socket.emit('encrypted-message', {
                roomCode,
                to: user.username,
                from: username,
                message: payload,
                type
            });
        }
        addMessageBubble({ sender: 'You', text: plain, isImage: false, isSelf: true });
    }
}