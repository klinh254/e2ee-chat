// Handles the login/landing page logic for creating/joining chat rooms

function randomRoomCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

document.getElementById('showJoinFormBtn').onclick = () => {
    document.getElementById('joinForm').style.display = 'flex';
    document.getElementById('roomCodeInput').focus();
};

document.getElementById('createBtn').onclick = () => {
    const name = document.getElementById('usernameInput').value.trim();
    if (!name) return alert('Please enter your username!');
    const roomCode = randomRoomCode();
    // Store username and roomCode in sessionStorage and redirect to chat.html
    sessionStorage.setItem('username', name);
    sessionStorage.setItem('roomCode', roomCode);
    window.location.href = 'chat.html';
};

document.getElementById('joinForm').onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('usernameInput').value.trim();
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    if (!name) return alert('Please enter your username!');
    if (!code) return alert('Please enter the room code!');
    sessionStorage.setItem('username', name);
    sessionStorage.setItem('roomCode', code);
    window.location.href = 'chat.html';
};