document.addEventListener('DOMContentLoaded', function () {
    let socket;
    let username;
    let myKeyPair;
    let users = [];
    let roomCode = null;

    // Ensure sodium is loaded and ready
    async function ensureSodiumReady() {
        // Wait for window.sodium to be defined (by CDN script)
        while (typeof window.sodium === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        // Wait for sodium.ready to resolve
        await window.sodium.ready;
    }

    // Utility functions
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
        const reader = new FileReader();
        reader.onload = async (evt) => {
            const dataUrl = evt.target.result;
            await sendMessageToAll(dataUrl, 'image');
        };
        reader.readAsDataURL(file);
    };

    // Crypto and socket logic
    async function startChat() {
        myKeyPair = sodium.crypto_box_keypair();
        showChatUI();

        socket = io();

        socket.emit('register', {
            username,
            publicKey: sodium.to_base64(myKeyPair.publicKey),
            roomCode
        });

        socket.on('users', (userList) => {
            users = userList.filter(u => u.username !== username && u.roomCode === roomCode);
            let html = '<b>Online:</b> ';
            users.forEach(u => html += `${u.username} `);
            document.getElementById('users').innerHTML = html;
        });

        socket.emit('get-users');

        socket.on('encrypted-message', async (data) => {
            const sender = data.from;
            let senderObj = users.find(u => u.username === sender);
            // Fallback for self-messages (x)
            if (!senderObj && sender === username) {
                senderObj = { publicKey: sodium.to_base64(myKeyPair.publicKey), username, roomCode };
            }
            if (!senderObj) return;

            const senderPublicKey = sodium.from_base64(senderObj.publicKey);
            const sharedKey = sodium.crypto_box_beforenm(senderPublicKey, myKeyPair.privateKey);

            const fullCipher = sodium.from_base64(data.message);
            const nonce = fullCipher.slice(0, sodium.crypto_box_NONCEBYTES);
            const cipher = fullCipher.slice(sodium.crypto_box_NONCEBYTES);
            let msg;
            try {
                const plain = sodium.crypto_box_open_easy_afternm(cipher, nonce, sharedKey);
                if (data.type === 'image') {
                    msg = `<img src="${sodium.to_string(plain)}" alt="image" />`;
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
        for (const user of users) {
            const theirPublicKey = sodium.from_base64(user.publicKey);
            const sharedKey = sodium.crypto_box_beforenm(theirPublicKey, myKeyPair.privateKey);

            const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
            const plainBytes = sodium.from_string(plain);
            const cipher = sodium.crypto_box_easy_afternm(plainBytes, nonce, sharedKey);

            const payload = sodium.to_base64(sodium.concat(nonce, cipher));

            socket.emit('encrypted-message', {
                to: user.socketId,
                from: username,
                message: payload,
                type
            });
        }
        addMessage(`You: ${type === 'image' ? '[image]' : plain}`, 'self');
    }
});