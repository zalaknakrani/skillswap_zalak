
const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const socketIO = require('socket.io');
require('dotenv').config();

// Database connection
const db = require('./db');

// Authentication routes
const authRouter = require('./routes/auth');

// Create Express application and HTTP server
const app = express();
const server = http.createServer(app);

// Configure Socket.IO
const io = socketIO(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// ========================================
// 1. MIDDLEWARE
// ========================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve frontend files
app.use(express.static(path.join(__dirname, 'public')));

// DASHBOARD ROUTE


// Keep this temporarily if dashboard.html and other
// existing frontend files are in the project root.
// Remove it after moving those files into public/.
app.use(express.static(__dirname));

app.get('/dashboard', (req, res) => {
    res.render('dashboard');
});

// ========================================
// 2. MYSQL CONNECTION CHECK
// ========================================

db.query('SELECT 1')
    .then(() => {
        console.log('MySQL connected successfully');
    })
    .catch((error) => {
        console.error('MySQL connection error:', error.message);
    });

// ========================================
// 3. AUTHENTICATION API ROUTES
// ========================================

// Registration: POST /api/auth/register
// Login:        POST /api/auth/login
app.use('/api/auth', authRouter);

// ========================================
// 4. EJS PAGE ROUTES
// ========================================

// Home page redirects to login
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Login page
app.get('/login', (req, res) => {
    res.render('login');
});

// Registration page
app.get('/register', (req, res) => {
    res.render('register');
});

// ========================================
// 5. SOCKET.IO CHAT
// ========================================


/* SOCKET.IO CHAT */

const userConnections = {};

// Handle new connections
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Register the user's socket
    socket.on('user_login', (email) => {
        if (!email || typeof email !== 'string') return;

        // Normalize email
        email = email.trim().toLowerCase();

        socket.data.email = email;
        userConnections[email] = socket.id;

        console.log(`${email} is online`);

        io.emit('user_online', {
            email,
            timestamp: new Date()
        });
    });

    // Send a chat message
    socket.on('send_message', (data) => {
        if (!data || !data.from || !data.to || !data.text) return;

        const from = data.from.trim().toLowerCase();
        const to = data.to.trim().toLowerCase();
        const text = String(data.text);
        const time = data.time || new Date().toISOString();

        const recipientSocketId = userConnections[to];

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('receive_message', {
                from,
                to,
                text,
                time,
                hasUnread: true
            });

            io.to(recipientSocketId).emit('message_notification', {
                from,
                preview: text.substring(0, 50),
                time
            });

            console.log(`Message delivered to ${to}`);
        } else {
            console.log(
                `${to} is offline. Message remains saved in MySQL.`
            );
        }
    });

    // Remove only this socket's registration
    socket.on('disconnect', () => {
        const email = socket.data.email;

        if (email && userConnections[email] === socket.id) {
            delete userConnections[email];

            console.log(`${email} is offline`);

            io.emit('user_offline', { email });
        }
    });
});


// ========================================
// 6. START SERVER
// ========================================

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Login page: http://localhost:${PORT}/login`);
    console.log(`Register page: http://localhost:${PORT}/register`);
});
