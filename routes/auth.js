const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is missing from .env');
}

// REGISTER
router.post('/register', async (req, res) => {
    try {
        const email = String(req.body.email || '')
            .trim()
            .toLowerCase();

        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({
                msg: 'Email and password are required'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                msg: 'Password must contain at least 8 characters'
            });
        }

        const [existing] = await db.execute(
            'SELECT user_id FROM users WHERE email = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                msg: 'Email already registered'
            });
        }

        // Generate a username from the email address.
        const base = (email.split('@')[0]
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .slice(0, 40)) || 'user';

        let username = base;
        let suffix = 1;

        while (true) {
            const [found] = await db.execute(
                'SELECT user_id FROM users WHERE username = ?',
                [username]
            );

            if (found.length === 0) break;

            username = `${base.slice(0, 40 - String(suffix).length)}${suffix}`;
            suffix++;
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await db.execute(
            `INSERT INTO users
             (username, name, email, password_hash, coins)
             VALUES (?, ?, ?, ?, 100)`,
            [username, username, email, passwordHash]
        );

        return res.status(201).json({
            msg: 'Registration successful. Please log in.',
            user_id: result.insertId
        });

    } catch (err) {
        console.error('Registration error:', err.message);

        return res.status(500).json({
            msg: 'Registration failed. Please try again.'
        });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    try {
        const email = String(req.body.email || '')
            .trim()
            .toLowerCase();

        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({
                msg: 'Email and password are required'
            });
        }

        const [rows] = await db.execute(
            `SELECT user_id, username, name, email,
                    password_hash, contact, degree,
                    country, state, city, coins
             FROM users
             WHERE email = ?`,
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                msg: 'Invalid email or password'
            });
        }

        const user = rows[0];

        const validPassword = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!validPassword) {
            return res.status(401).json({
                msg: 'Invalid email or password'
            });
        }

        const token = jwt.sign(
            { id: user.user_id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        delete user.password_hash;

        return res.json({
            msg: 'Login successful',
            user: {
                ...user,
                skills: [],
                learn: []
            },
            token
        });

    } catch (err) {
        console.error('Login error:', err.message);

        return res.status(500).json({
            msg: 'Login failed. Please try again.'
        });
    }
});


/* UPDATE USER PROFILE */
router.put('/update', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                msg: 'Please log in again.'
            });
        }

        const token = authHeader.split(' ')[1];

        let decoded;

        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                msg: 'Invalid or expired login session. Please log in again.'
            });
        }

        const name = String(req.body.name || '').trim();
        const contact = String(req.body.contact || '').trim();
        const country = String(req.body.country || '').trim();
        const state = String(req.body.state || '').trim();
        const degree = String(req.body.degree || '').trim();
        const city = String(req.body.city || '').trim();

        if (!name) {
            return res.status(400).json({
                msg: 'Name is required.'
            });
        }

        if (contact && !/^\d{10}$/.test(contact)) {
            return res.status(400).json({
                msg: 'Contact number must contain exactly 10 digits.'
            });
        }

        await db.execute(
            `UPDATE users
             SET name = ?, contact = ?, country = ?,
                 state = ?, degree = ?, city = ?
             WHERE user_id = ?`,
            [
                name,
                contact || null,
                country || null,
                state || null,
                degree || null,
                city || null,
                decoded.id
            ]
        );

        const [rows] = await db.execute(
            `SELECT user_id, username, name, email,
                    contact, degree, country, state, city, coins
             FROM users
             WHERE user_id = ?`,
            [decoded.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                msg: 'User not found.'
            });
        }

        return res.json({
            msg: 'Profile saved successfully.',
            user: rows[0]
        });

    } catch (err) {
        console.error('Profile update error:', err.message);

        return res.status(500).json({
            msg: 'Unable to save profile. Please try again.'
        });
    }
});


/* SAVE SKILLS OFFERED AND SKILLS TO LEARN */
router.post('/skills', async (req, res) => {
    let connection;

    try {
        // Verify login token
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                msg: 'Please log in again.'
            });
        }

        let decoded;

        try {
            decoded = jwt.verify(
                authHeader.split(' ')[1],
                JWT_SECRET
            );
        } catch (err) {
            return res.status(401).json({
                msg: 'Invalid or expired login session.'
            });
        }

        const skill = String(req.body.skill || '')
            .trim()
            .toUpperCase();

        const learn = String(req.body.learn || '')
            .trim()
            .toUpperCase();

        if (!skill && !learn) {
            return res.status(400).json({
                msg: 'Enter a skill you offer or want to learn.'
            });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        // Add a skill if it does not already exist.
        // Otherwise, retrieve its existing ID.
        async function getSkillId(skillName) {
            const [result] = await connection.execute(
                `INSERT INTO skills (name)
                 VALUES (?)
                 ON DUPLICATE KEY UPDATE
                 skill_id = LAST_INSERT_ID(skill_id)`,
                [skillName]
            );

            return result.insertId;
        }

        if (skill) {
            const skillId = await getSkillId(skill);

            await connection.execute(
                `INSERT IGNORE INTO skill_offering
                 (user_id, skill_id)
                 VALUES (?, ?)`,
                [decoded.id, skillId]
            );
        }

        if (learn) {
            const skillId = await getSkillId(learn);

            await connection.execute(
                `INSERT IGNORE INTO skill_interest
                 (user_id, skill_id)
                 VALUES (?, ?)`,
                [decoded.id, skillId]
            );
        }

        await connection.commit();

        return res.json({
            msg: 'Skills saved successfully.'
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
        }

        console.error('Save skills error:', err.message);

        return res.status(500).json({
            msg: 'Unable to save skills. Please try again.'
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});


/* FETCH SKILLS OFFERED AND SKILLS TO LEARN */
router.get('/skills', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                msg: 'Please log in again.'
            });
        }

        let decoded;

        try {
            decoded = jwt.verify(
                authHeader.split(' ')[1],
                JWT_SECRET
            );
        } catch (err) {
            return res.status(401).json({
                msg: 'Invalid or expired login session.'
            });
        }

        // Get skills the user offers.
        const [offeredSkills] = await db.execute(
            `SELECT s.name
             FROM skill_offering so
             JOIN skills s ON so.skill_id = s.skill_id
             WHERE so.user_id = ?
             ORDER BY s.name`,
            [decoded.id]
        );

        // Get skills the user wants to learn.
        const [learningSkills] = await db.execute(
            `SELECT s.name
             FROM skill_interest si
             JOIN skills s ON si.skill_id = s.skill_id
             WHERE si.user_id = ?
             ORDER BY s.name`,
            [decoded.id]
        );

        return res.json({
            skills: offeredSkills.map(row => row.name),
            learn: learningSkills.map(row => row.name)
        });

    } catch (err) {
        console.error('Fetch skills error:', err.message);

        return res.status(500).json({
            msg: 'Unable to load skills.'
        });
    }
});

/* GET ALL USERS AND THEIR SKILLS FROM MYSQL */
router.get('/users', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                msg: 'Please log in again.'
            });
        }

        let decoded;

        try {
            decoded = jwt.verify(
                authHeader.split(' ')[1],
                JWT_SECRET
            );
        } catch (err) {
            return res.status(401).json({
                msg: 'Invalid or expired login session.'
            });
        }

        // Get all registered users
        const [users] = await db.execute(`
            SELECT
                user_id,
                username,
                name,
                email,
                contact,
                degree,
                country,
                state,
                city,
                coins
            FROM users
        `);

        // Get skills offered by each user
        const [offered] = await db.execute(`
            SELECT so.user_id, s.name
            FROM skill_offering so
            JOIN skills s ON so.skill_id = s.skill_id
        `);

        // Get skills each user wants to learn
        const [interests] = await db.execute(`
            SELECT si.user_id, s.name
            FROM skill_interest si
            JOIN skills s ON si.skill_id = s.skill_id
        `);

        // Attach skills to their respective users
        const result = users.map(user => ({
            ...user,
            skills: offered
                .filter(s => s.user_id === user.user_id)
                .map(s => s.name),

            learn: interests
                .filter(s => s.user_id === user.user_id)
                .map(s => s.name)
        }));

        return res.json({
            users: result,
            currentUserId: decoded.id
        });

    } catch (err) {
        console.error('Fetch users error:', err.message);

        return res.status(500).json({
            msg: 'Unable to load users.'
        });
    }
});


/* SAVE A CHAT MESSAGE TO MYSQL */
router.post('/messages', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Please log in again.' });
        }

        let decoded;

        try {
            decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ msg: 'Invalid or expired login session.' });
        }

        const { toEmail, text } = req.body;

        if (!toEmail || !text || !text.trim()) {
            return res.status(400).json({ msg: 'Recipient and message are required.' });
        }

        // Find the recipient in MySQL
        const [recipients] = await db.execute(
            'SELECT user_id, email FROM users WHERE email = ?',
            [toEmail]
        );

        if (recipients.length === 0) {
            return res.status(404).json({ msg: 'Recipient not found.' });
        }

        const receiver = recipients[0];

        if (Number(decoded.id) === Number(receiver.user_id)) {
            return res.status(400).json({ msg: 'You cannot message yourself.' });
        }

        // Save the message in MySQL
        const [result] = await db.execute(
            `INSERT INTO messages
                (sender_id, receiver_id, message_text)
             VALUES (?, ?, ?)`,
            [decoded.id, receiver.user_id, text.trim()]
        );

        return res.status(201).json({
            msg: 'Message saved successfully.',
            message: {
                id: result.insertId,
                from: decoded.id,
                to: receiver.user_id,
                text: text.trim()
            }
        });

    } catch (err) {
        console.error('Save message error:', err.message);
        return res.status(500).json({ msg: 'Unable to save message.' });
    }
});


/* GET CHAT MESSAGES FROM MYSQL */
router.get('/messages/:email', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Please log in again.' });
        }

        let decoded;

        try {
            decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ msg: 'Invalid or expired login session.' });
        }

        const otherEmail = req.params.email;

        const [users] = await db.execute(
            'SELECT user_id, email FROM users WHERE email = ?',
            [otherEmail]
        );

        if (users.length === 0) {
            return res.status(404).json({ msg: 'User not found.' });
        }

        const otherUser = users[0];

        // Only retrieve messages exchanged between these two users
        const [rows] = await db.execute(
            `SELECT
                m.message_id AS id,
                sender.email AS sender_email,
                receiver.email AS receiver_email,
                m.message_text AS text,
                m.sent_at AS time
             FROM messages m
             JOIN users sender ON m.sender_id = sender.user_id
             JOIN users receiver ON m.receiver_id = receiver.user_id
             WHERE
                (m.sender_id = ? AND m.receiver_id = ?)
                OR
                (m.sender_id = ? AND m.receiver_id = ?)
             ORDER BY m.sent_at ASC, m.message_id ASC`,
            [
                decoded.id,
                otherUser.user_id,
                otherUser.user_id,
                decoded.id
            ]
        );

        const messages = rows.map(message => ({
            id: message.id,
            from: message.sender_email,
            to: message.receiver_email,
            text: message.text,
            time: message.time
        }));

        return res.json({ messages });

    } catch (err) {
        console.error('Fetch messages error:', err.message);
        return res.status(500).json({ msg: 'Unable to load messages.' });
    }
});


/* GET UNREAD MESSAGE COUNTS */
router.get('/unread-counts', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Please log in again.' });
        }

        let decoded;

        try {
            decoded = jwt.verify(
                authHeader.split(' ')[1],
                JWT_SECRET
            );
        } catch (err) {
            return res.status(401).json({ msg: 'Invalid or expired session.' });
        }

        const [rows] = await db.execute(
            `SELECT sender.email AS email, COUNT(*) AS unreadCount
             FROM messages m
             JOIN users sender ON m.sender_id = sender.user_id
             WHERE m.receiver_id = ?
               AND m.is_read = FALSE
             GROUP BY m.sender_id, sender.email`,
            [decoded.id]
        );

        const unreadCounts = {};

        rows.forEach(row => {
            unreadCounts[row.email] = Number(row.unreadCount);
        });

        return res.json({ unreadCounts });

    } catch (err) {
        console.error('Unread counts error:', err.message);
        return res.status(500).json({ msg: 'Unable to load unread counts.' });
    }
});


/* MARK MESSAGES FROM ONE USER AS READ */
router.put('/messages/:email/read', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Please log in again.' });
        }

        let decoded;

        try {
            decoded = jwt.verify(
                authHeader.split(' ')[1],
                JWT_SECRET
            );
        } catch (err) {
            return res.status(401).json({ msg: 'Invalid or expired session.' });
        }

        const otherEmail = req.params.email;

        const [users] = await db.execute(
            'SELECT user_id FROM users WHERE email = ?',
            [otherEmail]
        );

        if (users.length === 0) {
            return res.status(404).json({ msg: 'User not found.' });
        }

        await db.execute(
            `UPDATE messages
             SET is_read = TRUE
             WHERE receiver_id = ?
               AND sender_id = ?
               AND is_read = FALSE`,
            [decoded.id, users[0].user_id]
        );

        return res.json({ msg: 'Messages marked as read.' });

    } catch (err) {
        console.error('Mark messages read error:', err.message);
        return res.status(500).json({ msg: 'Unable to mark messages as read.' });
    }
});


/* SEND A SESSION REQUEST */
router.post('/session-requests', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Please log in again.' });
        }

        let decoded;

        try {
            decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ msg: 'Invalid or expired session.' });
        }

        const recipientEmail = String(req.body.recipientEmail || '')
            .trim()
            .toLowerCase();

        const sessionType = String(req.body.type || '').trim().toLowerCase();
        const skill = String(req.body.skill || '').trim();

        if (!recipientEmail || !['audio', 'video'].includes(sessionType)) {
            return res.status(400).json({
                msg: 'Recipient and valid session type are required.'
            });
        }

        const [recipients] = await db.execute(
            'SELECT user_id FROM users WHERE email = ?',
            [recipientEmail]
        );

        if (recipients.length === 0) {
            return res.status(404).json({ msg: 'Recipient not found.' });
        }

        const recipientId = recipients[0].user_id;

        if (Number(decoded.id) === Number(recipientId)) {
            return res.status(400).json({
                msg: 'You cannot send a session request to yourself.'
            });
        }

        const [result] = await db.execute(
            `INSERT INTO session_request
                (requester_id, recipient_id, session_type, skill)
             VALUES (?, ?, ?, ?)`,
            [decoded.id, recipientId, sessionType, skill]
        );

        return res.status(201).json({
            msg: 'Session request sent.',
            request: {
                id: String(result.insertId),
                requesterEmail: decoded.email,
                recipientEmail,
                type: sessionType,
                skill,
                status: 'pending',
                responded: false
            }
        });

    } catch (err) {
        console.error('Send session request error:', err.message);
        return res.status(500).json({
            msg: 'Unable to send session request.'
        });
    }
});


/* GET INCOMING SESSION REQUESTS */
router.get('/session-requests/incoming', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Please log in again.' });
        }

        let decoded;

        try {
            decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ msg: 'Invalid or expired session.' });
        }

        const [rows] = await db.execute(
            `SELECT
                sr.request_id AS id,
                requester.email AS requesterEmail,
                requester.name AS requesterName,
                recipient.email AS recipientEmail,
                sr.session_type AS type,
                sr.skill,
                sr.status,
                sr.created_at AS timestamp
             FROM session_request sr
             JOIN users requester ON sr.requester_id = requester.user_id
             JOIN users recipient ON sr.recipient_id = recipient.user_id
             WHERE sr.recipient_id = ?
               AND sr.status = 'pending'
             ORDER BY sr.created_at DESC`,
            [decoded.id]
        );

        const requests = rows.map(row => ({
            ...row,
            id: String(row.id),
            timestamp: new Date(row.timestamp).getTime(),
            responded: false
        }));

        return res.json({ requests });

    } catch (err) {
        console.error('Incoming session requests error:', err.message);
        return res.status(500).json({
            msg: 'Unable to load incoming requests.'
        });
    }
});


/* ACCEPT OR REJECT A SESSION REQUEST */
router.put('/session-requests/:id/respond', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Please log in again.' });
        }

        let decoded;

        try {
            decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ msg: 'Invalid or expired session.' });
        }

        const requestId = req.params.id;
        const action = String(req.body.action || '').trim().toLowerCase();

        if (!/^\d+$/.test(requestId) ||
            !['accepted', 'rejected'].includes(action)) {
            return res.status(400).json({
                msg: 'Invalid request ID or response.'
            });
        }

        const [result] = await db.execute(
            `UPDATE session_request
             SET status = ?, responded_at = CURRENT_TIMESTAMP
             WHERE request_id = ?
               AND recipient_id = ?
               AND status = 'pending'`,
            [action, requestId, decoded.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                msg: 'Request not found or already answered.'
            });
        }

        return res.json({
            msg: action === 'accepted'
                ? 'Session request accepted.'
                : 'Session request rejected.',
            id: requestId,
            status: action
        });

    } catch (err) {
        console.error('Respond to session request error:', err.message);
        return res.status(500).json({
            msg: 'Unable to respond to session request.'
        });
    }
});


/* CHECK THE STATUS OF A SENT SESSION REQUEST */

// Check session status for either participant
router.get('/session-requests/:id', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Please log in again.' });
        }

        let decoded;

        try {
            decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ msg: 'Invalid or expired token.' });
        }

        const [rows] = await db.query(
            `SELECT request_id AS id, status
             FROM session_request
             WHERE request_id = ?
             AND (requester_id = ? OR recipient_id = ?)`,
            [req.params.id, decoded.id, decoded.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ msg: 'Session not found.' });
        }

        res.json({
            request: {
                id: String(rows[0].id),
                status: rows[0].status,
                responded: rows[0].status !== 'pending'
            }
        });

    } catch (error) {
        console.error('Session status error:', error);
        res.status(500).json({ msg: 'Server error.' });
    }
});



// End an active session


router.put('/session-requests/:id/end', async (req, res) => {
    let connection;

    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                msg: 'Please log in again.'
            });
        }

        let decoded;

        try {
            decoded = jwt.verify(
                authHeader.split(' ')[1],
                JWT_SECRET
            );
        } catch (err) {
            return res.status(401).json({
                msg: 'Invalid or expired token.'
            });
        }

        const requestId = req.params.id;

        if (!/^\d+$/.test(requestId)) {
            return res.status(400).json({
                msg: 'Invalid session request ID.'
            });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        // Get session details and lock the row
        const [sessions] = await connection.execute(
            `SELECT
                recipient_id,
                status,
                coins_transferred,
                TIMESTAMPDIFF(SECOND, responded_at, NOW()) AS duration_seconds
             FROM session_request
             WHERE request_id = ?
               AND (requester_id = ? OR recipient_id = ?)
             FOR UPDATE`,
            [requestId, decoded.id, decoded.id]
        );

        if (sessions.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                msg: 'Session request not found.'
            });
        }

        const session = sessions[0];

        if (session.status !== 'accepted') {
            await connection.rollback();

            return res.status(400).json({
                msg: 'Session is not active or has already ended.'
            });
        }

        if (session.coins_transferred) {
            await connection.rollback();

            return res.status(400).json({
                msg: 'Coins have already been rewarded.'
            });
        }

        // 5 coins for every completed 10 minutes
        const completedBlocks = Math.floor(
            Number(session.duration_seconds) / 600
        );

        const coins = completedBlocks * 5;

        // Only the teacher (recipient) receives coins
        if (coins > 0) {
            await connection.execute(
                `UPDATE users
                 SET coins = coins + ?
                 WHERE user_id = ?`,
                [coins, session.recipient_id]
            );
        }

        // End session and prevent duplicate rewards
        await connection.execute(
            `UPDATE session_request
             SET status = 'ended',
                 coins_transferred = TRUE,
                 responded_at = NOW()
             WHERE request_id = ?`,
            [requestId]
        );

        await connection.commit();

        return res.json({
            msg: 'Session ended successfully.',
            coinsEarned: coins,
            durationSeconds: Number(session.duration_seconds)
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error('End session error:', error);

        return res.status(500).json({
            msg: 'Server error.'
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});


router.get('/coins', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                msg: 'Please log in again.'
            });
        }

        let decoded;

        try {
            decoded = jwt.verify(
                authHeader.split(' ')[1],
                JWT_SECRET
            );
        } catch (err) {
            return res.status(401).json({
                msg: 'Invalid or expired token.'
            });
        }

        const [users] = await db.execute(
            'SELECT coins FROM users WHERE user_id = ?',
            [decoded.id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                msg: 'User not found.'
            });
        }

        return res.json({
            coins: users[0].coins
        });

    } catch (error) {
        console.error('Fetch coins error:', error);

        return res.status(500).json({
            msg: 'Unable to fetch coins.'
        });
    }
});


module.exports = router;

