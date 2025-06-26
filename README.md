# E2EE Chat App

A simple, real-time, end-to-end encrypted (E2EE) chat app.


## Overview

- **Frontend:** HTML/CSS/JavaScript (with libsodium.js for cryptography)
- **Backend:** Node.js/Express, Socket.io, MongoDB (Mongoose ORM)
- **Features:** E2EE for messages, user registration/login, multi-room support

## Key features

- **User Registration & Login:** Secure authentication with hashed passwords.
- **End-to-End Encryption:** All text and image messages are encrypted in the browser using ephemeral keys (libsodium), and only decrypted by the intended recipients.
- **Real-time Messaging:**  through socket
- **Host locally.**  


## Setup

### 1. Prerequisites

- **Node.js**
- **MongoDB** running locally.
- **npm**

### 2. Clone and install dependencies

- Clone this repository
- Navigate to e2ee-chat-app\server and run ```npm install ```

### 3. Start MongoDB

```bash
mongod.exe
```

### 4. Start The Server

```bash
node server.js
```
By default, the server runs on [http://localhost:3000](http://localhost:3000).



## !Note

**For educational purpose only!**  
  This is just a demo project and is not optimized enough for actual use.