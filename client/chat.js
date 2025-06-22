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
    // Create row
    const row = document.createElement('div');
    row.className = 'message-row' + (isSelf ? ' self' : '');

    // Container for name and bubble
    const content = document.createElement('div');
    content.className = 'message-content';

    // Meta (name)
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = isSelf ? 'You' : sender;

    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (isImage) {
        bubble.innerHTML = `<img src="${escapeHTML(text)}" alt="image" />`;
    } else {
        bubble.textContent = text;
    }

    // Add meta above bubble
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

// Main logic
async function ensureSodiumReady() {
    while (typeof window.sodium === 'undefined') {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    await window.sodium.ready;
}

function logout() {
    // Clean up session and go back to landing
    sessionStorage.clear();
    window.location.href = 'index.html';
}

document.getElementById('logoutBtn').onclick = logout;

window.onload = async function () {
    // Restore username/roomCode
    username = sessionStorage.getItem('username');
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
    myKeyPair = sodium.crypto_box_keypair();

    socket = io();

    function registerAndGetUsers() {
        socket.emit('register', {
            username,
            publicKey: sodium.to_base64(myKeyPair.publicKey),
            roomCode
        });
        socket.emit('get-users');
    }

    registerAndGetUsers();

    socket.on('connect', () => {
        registerAndGetUsers();
    });

    socket.on('users', (userList) => {
        users = userList.filter(u => u.roomCode === roomCode);
        updateUsersList();
    });

    socket.on('encrypted-message', async (data) => {
        const sender = data.from;
        let senderObj = users.find(u => u.username === sender && u.roomCode === roomCode);
        if (!senderObj) {
            if (sender === username) {
                senderObj = {
                    publicKey: sodium.to_base64(myKeyPair.publicKey),
                    username,
                    roomCode
                };
            } else {
                addMessageBubble({ sender, text: "[Error: Sender info missing]", isSelf: false });
                return;
            }
        }
        const senderPublicKey = sodium.from_base64(senderObj.publicKey);
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
                addMessageBubble({ sender, text: msg, isImage: true, isSelf: sender === username });
            } else {
                msg = sodium.to_string(plain);
                addMessageBubble({ sender, text: msg, isImage: false, isSelf: sender === username });
            }
        } catch (e) {
            addMessageBubble({ sender, text: "[Decryption failed]", isImage: false, isSelf: sender === username });
        }
    });
}

// Message sending logic
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

            socket.emit('encrypted-message', {
                to: user.socketId,
                from: username,
                message: payload,
                type
            });
        }
        // Show preview on sender side
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

            socket.emit('encrypted-message', {
                to: user.socketId,
                from: username,
                message: payload,
                type
            });
        }
        addMessageBubble({ sender: 'You', text: plain, isImage: false, isSelf: true });
    }
}