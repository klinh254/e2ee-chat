// Handles registration, login, and local keypair management for seamless UX

function saveLocalCredentials({ username, token, publicKey, privateKey }) {
    localStorage.setItem('username', username);
    localStorage.setItem('token', token);
    localStorage.setItem('publicKey', publicKey);
    localStorage.setItem('privateKey', privateKey);
}

async function generateAndStoreKeyPair() {
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    localStorage.setItem('privateKey', sodium.to_base64(keyPair.privateKey));
    localStorage.setItem('publicKey', sodium.to_base64(keyPair.publicKey));
    return keyPair;
}

// Registration
document.getElementById('registerBtn').onclick = async () => {
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    if (!username || !password) return alert('Please enter username and password!');
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    const publicKey = sodium.to_base64(keyPair.publicKey);
    const privateKey = sodium.to_base64(keyPair.privateKey);

    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, publicKey })
    });
    if (res.ok) {
        alert('Registration successful! You can now login.');
        // Save the keys for immediate use
        localStorage.setItem('privateKey', privateKey);
        localStorage.setItem('publicKey', publicKey);
        localStorage.setItem('username', username);
    } else {
        const err = await res.json();
        if (err.error && err.error.includes('duplicate')) {
            alert('Username already exists. Please choose a different username.');
        } else {
            alert('Error: ' + err.error);
        }
    }
};

// Login
document.getElementById('loginBtn').onclick = async () => {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) return alert('Please enter username and password!');
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (res.ok) {
        const data = await res.json();
        let privateKey = localStorage.getItem('privateKey');
        let publicKey = localStorage.getItem('publicKey');
        // If no private key (first login on new device/after clear), generate new keys and update server
        if (!privateKey || !publicKey) {
            await sodium.ready;
            const keyPair = sodium.crypto_box_keypair();
            privateKey = sodium.to_base64(keyPair.privateKey);
            publicKey = sodium.to_base64(keyPair.publicKey);
            // Update public key on server for user
            await fetch('/api/updatePublicKey', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${data.token}`
                },
                body: JSON.stringify({ publicKey })
            });
            localStorage.setItem('privateKey', privateKey);
            localStorage.setItem('publicKey', publicKey);
        }
        saveLocalCredentials({ username: data.username, token: data.token, publicKey, privateKey });
        window.location.href = 'menu.html';
    } else {
        const err = await res.json();
        alert('Error: ' + err.error);
    }
};

// Optional: If already logged in, redirect to menu
window.onload = function() {
    if (localStorage.getItem('token') && localStorage.getItem('username') && localStorage.getItem('privateKey')) {
        window.location.href = 'menu.html';
    }
};