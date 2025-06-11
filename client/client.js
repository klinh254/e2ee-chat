document.addEventListener('DOMContentLoaded', function () {
    let socket;
    let username;
    let myKeyPair;
    let users = [];
    let roomCode = null;

    // Ensure sodium is loaded and ready
    async function ensureSodiumReady() {
        while (typeof window.sodium === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        await window.sodium.ready;
    }

    function randomRoomCode() {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }

    function showChatUI() {
        document.getElementById('login').style.display = 'none';
        document.getElementById('chat').style.display = '';
        document.getElementById('roomInfo').textContent = `Room: ${roomCode}`;
    }

    function addMessage(msg, cls) {
        const div = document.createElement('div');
        div.className = 'message ' + (cls || '');
        div.innerHTML = msg;
        document.getElementById('messages').appendChild(div);
        document.getElementById('messages').scrollTop = 1e9;
    }

    // UI event handlers
    document.getElementById('showJoinFormBtn').onclick = () => {
        document.getElementById('joinForm').style.display = 'flex';
        document.getElementById('roomCodeInput').focus();
    };

    document.getElementById('createBtn').onclick = async () => {
        const name = document.getElementById('usernameInput').value.trim();
        if (!name) return alert('Please enter your username!');
        username = name;
        roomCode = randomRoomCode();
        await ensureSodiumReady();
        await startChat();
    };

    document.getElementById('joinForm').onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('usernameInput').value.trim();
        const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
        if (!name) return alert('Please enter your username!');
        if (!code) return alert('Please enter the room code!');
        username = name;
        roomCode = code;
        await ensureSodiumReady();
        await startChat();
    };

    document.getElementById('sendForm').onsubmit = async (e) => {
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

        // Limit image size to 400KB for safety
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

    async function startChat() {
        myKeyPair = sodium.crypto_box_keypair();
        showChatUI();

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
            // After reconnect, re-register and fetch users
            registerAndGetUsers();
        });

        socket.on('users', (userList) => {
            users = userList.filter(u => u.roomCode === roomCode);
            let html = '<b>Online:</b> ';
            users.forEach(u => {
                if (u.username !== username) html += `${u.username} `;
            });
            document.getElementById('users').innerHTML = html;
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
                    console.error("Sender not found in users array", sender, users);
                    addMessage(`${sender}: [Error: Sender info missing]`, '');
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
                    // The sender now sends JSON {header, base64}
                    try {
                        const info = JSON.parse(sodium.to_string(plain));
                        msg = `<img src="${info.header}${info.base64}" alt="image" />`;
                    } catch {
                        msg = `<img src="${sodium.to_string(plain)}" alt="image" />`;
                    }
                } else {
                    msg = sodium.to_string(plain);
                }
            } catch (e) {
                msg = '[Decryption failed]';
            }
            addMessage(`${sender}: ${msg}`, sender === username ? 'self' : '');
        });
    }

    async function sendMessageToAll(plain, type) {
        if (type === 'image') {
            // DataURL: data:image/png;base64,xxxx
            const commaIdx = plain.indexOf(',');
            if (commaIdx === -1) {
                addMessage('You: [Invalid image data]', 'self');
                return;
            }
            const header = plain.slice(0, commaIdx + 1); // include the comma
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
            addMessage(`You: <img src="${plain}" alt="image" />`, 'self');
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
            addMessage(`You: ${plain}`, 'self');
        }
    }
});