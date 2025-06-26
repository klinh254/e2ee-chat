function randomRoomCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function logout() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'index.html';
}

document.getElementById('logoutBtn').onclick = logout;

function joinRoom(code) {
    sessionStorage.setItem('roomCode', code);
    window.location.href = 'chat.html';
}

async function fetchUserRooms(username, token) {
    const res = await fetch(`/api/rooms/${username}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        const data = await res.json();
        const userRooms = document.getElementById('userRooms');
        if (data.rooms.length === 0) {
            userRooms.innerHTML = '<i>You have not joined any rooms.</i>';
        } else {
            userRooms.innerHTML = data.rooms.map(code =>
                `<button class="btn" onclick="joinRoom('${code}')">${code}</button>`
            ).join(' ');
        }
    } else {
        document.getElementById('userRooms').innerHTML = '<i>Could not load rooms.</i>';
    }
}

window.joinRoom = joinRoom;

window.onload = async function() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    const privateKey = localStorage.getItem('privateKey');
    if (!token || !username || !privateKey) {
        window.location.href = 'index.html';
        return;
    }
    document.getElementById('welcomeUser').textContent = username;
    await fetchUserRooms(username, token);
};

document.getElementById('createRoomBtn').onclick = () => {
    const roomCode = randomRoomCode();
    sessionStorage.setItem('roomCode', roomCode);
    window.location.href = 'chat.html';
};

document.getElementById('joinRoomForm').onsubmit = (e) => {
    e.preventDefault();
    const code = document.getElementById('joinRoomCode').value.trim().toUpperCase();
    if (!code) return alert('Please enter the room code!');
    sessionStorage.setItem('roomCode', code);
    window.location.href = 'chat.html';
};