require('dotenv').config();
const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const db = require('./db');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'gagan_banking_secret_key_123';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'gagan_refresh_key_456';
const adminRoutes = require('./routes/admin');
const userController = require('./controllers/userController');
const shareAdminRoutes = require('./routes/shareAdmin');
const { authenticateToken } = require('./middleware/auth');
const { initializeMarketSocket } = require('./realtime/marketSocket');

const app = express();
const server = http.createServer(app);
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
// All admin routes are handled by adminRoutes
app.use('/api/admin', adminRoutes);
// All share admin routes

app.get('/admin-panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/share-admin-panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'share-admin.html'));
});

app.get('/share-admin-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'share-admin-login.html'));
});

app.get('/api/check-session', authenticateToken, async (req, res) => {
    try {
        const [users] = await db.promise().query("SELECT id, first_name, last_name, account_number, balance, hold_balance, trading_balance, role, status, profile_pic, branch FROM users WHERE id = ?", [req.user.id]);
        if (users.length === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        const user = users[0];
        res.status(200).json({ user });
    } catch (err) {
        console.error("Session check error:", err);
        res.status(500).json({ message: "Server error during session check." });
    }
});


async function generateUniqueAccountNumber() {
    let accountNumber;
    let isUnique = false;
    while (!isUnique) {
        accountNumber = Math.floor(1000000000 + Math.random() * 9000000000).toString(); // 10-digit number
        const [rows] = await db.promise().query("SELECT account_number FROM users WHERE account_number = ?", [accountNumber]);
        if (rows.length === 0) {
            isUnique = true;
        }
    }
    return accountNumber;
}

app.post('/api/register', async (req, res) => {
    const { 
        firstName, lastName, dob, gender, phone,
        accType, branch, password, transPin
    } = req.body;

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!password || !passwordRegex.test(password.trim())) {
        return res.status(400).json({ message: "Password must be 8+ characters with a letter, a number, and a special character." });
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 10);
    const hashedTransPin = await bcrypt.hash(transPin, 10);

    let accountNumber;
    try {
        accountNumber = await generateUniqueAccountNumber();
    } catch (err) {
        console.error("Error generating unique account number:", err);
        return res.status(500).json({ message: "Failed to generate unique account number." });
    }

    const sql = `INSERT INTO users (
        first_name, last_name, dob, gender, phone_number, account_number,
        branch, account_type, password, transaction_pin, balance, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`;

    const params = [
        firstName, lastName, dob, gender, phone, accountNumber,
        branch, accType, hashedPassword, hashedTransPin, 0.00
    ];

    try {
        const [result] = await db.promise().query(sql, params);
        const userId = result.insertId;

        const transSql = "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)";
        await db.promise().query(transSql, [userId, 'credit', 0.00, 'Initial Opening Balance']);

        const adminNoti = "INSERT INTO notifications (user_id, message) SELECT id, ? FROM users WHERE role = 'admin'";
        await db.promise().query(adminNoti, [`New account request from ${firstName} ${lastName} (Acc: ${accountNumber}, Phone: ${phone})`]);

        res.status(200).json({ message: "Registration successful! Your account is pending admin approval." });
    } catch (err) {
        console.error("Registration DB Error:", err.sqlMessage || err);
        if (err.code === 'ER_DUP_ENTRY' && err.sqlMessage && err.sqlMessage.includes('phone_number')) {
            return res.status(409).json({ message: "Registration failed: Phone number already registered." });
        }
        if (err.code === 'ER_DUP_ENTRY' && err.sqlMessage && err.sqlMessage.includes('account_number')) {
            return res.status(500).json({ message: "Registration failed: Generated account number already exists. Please try again." });
        }
        return res.status(500).json({ message: "Registration failed: " + (err.sqlMessage || "An unexpected error occurred.") });
    }
});

app.post('/api/login', async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) {
        return res.status(400).json({ message: "Phone and password are required." });
    }

    try {
        const searchPhone = phone.trim();
        
        const [result] = await db.promise().query(
            "SELECT * FROM users WHERE phone_number = ? OR phone_number = ? OR TRIM(LEADING '0' FROM phone_number) = TRIM(LEADING '0' FROM ?)", 
            [searchPhone, Number(searchPhone) || 0, searchPhone]
        );

        if (result.length === 0) {
            return res.status(404).json({ message: "No account found with this phone number. Please register first." });
        }

        const isMatch = await bcrypt.compare(password, result[0].password);
        if (isMatch) {
            const user = result[0];

        
            const userRole = user.role || 'user';
            const userStatus = user.status || 'pending';

            if (userRole === 'user' && userStatus !== 'active' && userStatus !== 'approved') { // 'approved' is also a valid state
                return res.status(403).json({ message: `Access Denied: Your account status is '${userStatus}'. Please contact Admin.` });
            }

            // Set different token expiry for different roles
            const tokenExpiry = (userRole === 'admin' || userRole === 'share_admin') ? '1h' : '15m';
            const refreshTokenExpiry = '7d';
            const refreshTokenMaxAge = 7 * 24 * 60 * 60 * 1000;
            const tokenMaxAge = (userRole === 'admin' || userRole === 'share_admin') ? 60 * 60 * 1000 : 15 * 60 * 1000;


            const token = jwt.sign({ id: user.id, role: userRole }, JWT_SECRET, { expiresIn: tokenExpiry });
            const refreshToken = jwt.sign({ id: user.id, role: userRole }, REFRESH_SECRET, { expiresIn: refreshTokenExpiry });

            try {
                await db.promise().query("INSERT INTO refresh_tokens (token, user_id) VALUES (?, ?)", [refreshToken, user.id]);
            } catch (tokenErr) {
                console.error("Refresh Token DB Error:", tokenErr);
               
            }
            
            // Set JWT in an httpOnly cookie
            res.cookie('authToken', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
                sameSite: 'strict',
                maxAge: tokenMaxAge 
            });
            
            // Set Refresh Token in its own httpOnly cookie
            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                path: '/api/refresh-token', // Only send to refresh token endpoint
                maxAge: refreshTokenMaxAge
            });

            delete user.password;
            return res.status(200).json({ message: "Login successful", user: user });
        } else {
            return res.status(401).json({ message: "Incorrect password" });
        }
    } catch (err) {
        console.error("Login Server Error:", err.message);
        return res.status(500).json({ message: "DB Error: " + err.message });
    }
});


app.post('/api/refresh-token', (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return res.sendStatus(401);

    db.query("SELECT * FROM refresh_tokens WHERE token = ?", [refreshToken], (err, result) => {
        if (err || result.length === 0) return res.sendStatus(403);

        jwt.verify(refreshToken, REFRESH_SECRET, (err, decoded) => {
            if (err) return res.sendStatus(403);
            
            db.query("SELECT id, role FROM users WHERE id = ?", [decoded.id], (err, users) => {
                if (err || users.length === 0) return res.sendStatus(403);
                const accessToken = jwt.sign({ id: users[0].id, role: users[0].role }, JWT_SECRET, { expiresIn: '15m' });
                
                res.cookie('authToken', accessToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 15 * 60 * 1000 // 15 minutes
                });
                res.json({ message: "Token refreshed" });
            });
        });
    });
});

app.post('/api/logout', (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    db.query("DELETE FROM refresh_tokens WHERE token = ?", [refreshToken || ''], () => {
        res.clearCookie('authToken');
        res.clearCookie('refreshToken', { path: '/api/refresh-token' });
        res.json({ message: "Logged out successfully" });
    });
});

app.post('/api/change-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!passwordRegex.test(String(newPassword || '').trim())) {
        return res.status(400).json({ message: 'Password must be 8+ characters with a letter, a number, and a special character.' });
    }
    db.query("SELECT password FROM users WHERE id = ?", [req.user.id], async (err, result) => {
        if (err || result.length === 0) return res.status(404).json({ message: "User not found" });

        const isMatch = await bcrypt.compare(oldPassword, result[0].password);
        if (!isMatch) return res.status(401).json({ message: "Incorrect old password" });

        const hashed = await bcrypt.hash(newPassword, 10);
        db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id], (err) => {
            if (err) return res.status(500).json({ message: "Failed to update password" });
            res.json({ message: "Password changed successfully!" });
        });
    });
});

app.post('/api/notifications/mark-read', authenticateToken, (req, res) => {
    const userId = req.user.id;
    db.query("UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE", [userId], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ message: "Notifications marked as read" });
    });
});

app.post('/api/mobile-topup', async (req, res) => {
    const { userId, amount, operator, phoneNum } = req.body;
    if (amount <= 0) return res.status(400).json({ message: "Invalid amount" });

    db.beginTransaction(async err => {
        if (err) return res.status(500).json({ message: "Transaction error" });

        try {
            const [userRows] = await db.promise().query("SELECT balance FROM users WHERE id = ?", [userId]);
            if (userRows.length === 0 || userRows[0].balance < amount) {
                throw new Error("Insufficient balance");
            }

            await db.promise().query("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, userId]);

            await db.promise().query(
                "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)",
                [userId, 'debit', amount, `Mobile Topup (${operator}): ${phoneNum}`]
            );

            await db.promise().commit();
            const [newBal] = await db.promise().query("SELECT balance FROM users WHERE id = ?", [userId]);
            res.json({ message: `Topup successful!`, newBalance: newBal[0].balance });
        } catch (error) {
            await db.promise().rollback();
            res.status(400).json({ message: error.message });
        }
    });
});


app.post('/api/transfer', authenticateToken, async (req, res) => {

    const {
        amount,
        recipientAccount,
        transferType,
        remarks,
        pin,
        recipientName
    } = req.body;

    const senderId = req.user.id;

    // Validate amount
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
        return res.status(400).json({
            message: "Invalid transfer amount."
        });
    }

    // Validate recipient
    if (!recipientAccount) {
        return res.status(400).json({
            message: "Recipient account number is required."
        });
    }

    // Validate PIN
    if (!pin) {
        return res.status(400).json({
            message: "Transaction PIN is required."
        });
    }

    // Validate transfer type
    if (transferType !== 'same' && transferType !== 'other') {
        return res.status(400).json({
            message: "Invalid transfer type."
        });
    }

    let connection;

    try {

        // Get connection from MySQL pool
        connection = await db.promise().getConnection();

        // Start transaction
        await connection.beginTransaction();

        // Get sender
        const [senderRows] = await connection.query(
            "SELECT * FROM users WHERE id = ? FOR UPDATE",
            [senderId]
        );

        if (senderRows.length === 0) {
            throw new Error("Sender account not found.");
        }

        const sender = senderRows[0];

        // Check balance
        if (Number(sender.balance) < Number(amount)) {
            throw new Error("Insufficient funds.");
        }

        // Check transaction PIN
        const isPinMatch = await bcrypt.compare(
            String(pin),
            sender.transaction_pin
        );

        if (!isPinMatch) {
            throw new Error("Invalid Transaction PIN.");
        }


        // ==========================================
        // SAME BANK TRANSFER
        // ==========================================

        if (transferType === 'same') {

            const [recipientRows] = await connection.query(
                "SELECT * FROM users WHERE account_number = ? FOR UPDATE",
                [String(recipientAccount).trim()]
            );

            if (recipientRows.length === 0) {
                throw new Error(
                    "Recipient account not found in this bank."
                );
            }

            const recipient = recipientRows[0];

            // Prevent self transfer
            if (Number(recipient.id) === Number(senderId)) {
                throw new Error(
                    "You cannot transfer money to yourself."
                );
            }

            // Remove money from sender
            await connection.query(
                "UPDATE users SET balance = balance - ? WHERE id = ?",
                [Number(amount), senderId]
            );

            // Sender transaction
            await connection.query(
                `INSERT INTO transactions
                (user_id, type, amount, description)
                VALUES (?, 'debit', ?, ?)`,
                [
                    senderId,
                    Number(amount),
                    `${remarks || 'Fund Transfer'} - To ${recipientName || recipientAccount}`
                ]
            );

            // Sender notification
            await connection.query(
                "INSERT INTO notifications (user_id, message) VALUES (?, ?)",
                [
                    senderId,
                    `You sent Rs. ${Number(amount).toLocaleString()} to Acc: ${recipientAccount}`
                ]
            );

            // Add money to recipient
            await connection.query(
                "UPDATE users SET balance = balance + ? WHERE id = ?",
                [Number(amount), recipient.id]
            );

            // Recipient transaction
            await connection.query(
                `INSERT INTO transactions
                (user_id, type, amount, description)
                VALUES (?, 'credit', ?, ?)`,
                [
                    recipient.id,
                    Number(amount),
                    `Received from ${sender.first_name} (${sender.account_number})`
                ]
            );

            // Recipient notification
            await connection.query(
                "INSERT INTO notifications (user_id, message) VALUES (?, ?)",
                [
                    recipient.id,
                    `You received Rs. ${Number(amount).toLocaleString()} from ${sender.first_name}`
                ]
            );

        }


        // ==========================================
        // OTHER BANK TRANSFER
        // ==========================================

        else if (transferType === 'other') {

            // Remove money from sender
            await connection.query(
                "UPDATE users SET balance = balance - ? WHERE id = ?",
                [Number(amount), senderId]
            );

            // Transaction record
            await connection.query(
                `INSERT INTO transactions
                (user_id, type, amount, description)
                VALUES (?, 'debit', ?, ?)`,
                [
                    senderId,
                    Number(amount),
                    `${remarks || 'Other Bank Transfer'} - To ${recipientName || 'N/A'} (${recipientAccount})`
                ]
            );

            // Notification
            await connection.query(
                "INSERT INTO notifications (user_id, message) VALUES (?, ?)",
                [
                    senderId,
                    `Rs. ${Number(amount).toLocaleString()} transferred to other bank (${recipientAccount})`
                ]
            );
        }


        // Commit transaction
        await connection.commit();


        // Get updated balance
        const [balanceRows] = await connection.query(
            "SELECT balance FROM users WHERE id = ?",
            [senderId]
        );

        return res.status(200).json({
            message: "Transfer Success",
            newBalance: balanceRows[0].balance
        });


    } catch (error) {

        console.error("TRANSFER ERROR:", error);

        // Rollback if something failed
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error(
                    "Rollback Error:",
                    rollbackError
                );
            }
        }

        return res.status(400).json({
            message: error.message || "Transfer failed."
        });


    } finally {

        // Return connection to pool
        if (connection) {
            connection.release();
        }

    }

});

app.post('/api/buy-share', authenticateToken, userController.buyShare);
app.post('/api/sell-share', authenticateToken, userController.sellShare);
app.get('/api/trading-wallet', authenticateToken, async (req, res) => {
    try {
        const [[user]] = await db.promise().query('SELECT trading_balance FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json({ tradingBalance: Number(user.trading_balance) || 0 });
    } catch (err) {
        console.error('Trading wallet fetch error:', err);
        res.status(500).json({ message: 'Could not load trading wallet.' });
    }
});

app.post('/api/change-transaction-pin', authenticateToken, async (req, res) => {
    const oldPin = String(req.body.oldPin || '');
    const newPin = String(req.body.newPin || '');
    if (!/^\d{4}$/.test(oldPin) || !/^\d{4}$/.test(newPin)) {
        return res.status(400).json({ message: 'Both transaction PINs must be exactly 4 digits.' });
    }
    if (oldPin === newPin) return res.status(400).json({ message: 'New PIN must be different from current PIN.' });
    try {
        const [[user]] = await db.promise().query('SELECT transaction_pin FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (!await bcrypt.compare(oldPin, user.transaction_pin)) return res.status(401).json({ message: 'Current transaction PIN is incorrect.' });
        const hashedPin = await bcrypt.hash(newPin, 10);
        await db.promise().query('UPDATE users SET transaction_pin = ? WHERE id = ?', [hashedPin, req.user.id]);
        res.json({ message: 'Transaction PIN changed successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Could not update transaction PIN.' });
    }
});
app.post('/api/trading-wallet/transfer', authenticateToken, async (req, res) => {
    const amount = Number(req.body.amount);
    const direction = req.body.direction;
    const pin = String(req.body.pin || '');
    if (!Number.isFinite(amount) || amount <= 0 || !['to_trading', 'to_bank'].includes(direction)) {
        return res.status(400).json({ message: 'Enter a valid transfer amount.' });
    }
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ message: 'Enter your 4-digit transaction PIN.' });
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [[user]] = await connection.query('SELECT balance, trading_balance, transaction_pin FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
        if (!user) throw new Error('User not found.');
        const isPinValid = await bcrypt.compare(pin, user.transaction_pin);
        if (!isPinValid) throw new Error('Incorrect transaction PIN.');
        const isFunding = direction === 'to_trading';
        const available = Number(isFunding ? user.balance : user.trading_balance);
        if (available < amount) throw new Error(isFunding ? 'Insufficient bank balance.' : 'Insufficient trading balance.');
        await connection.query(
            'UPDATE users SET balance = balance + ?, trading_balance = trading_balance + ? WHERE id = ?',
            [isFunding ? -amount : amount, isFunding ? amount : -amount, req.user.id]
        );
        await connection.query('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)', [
            req.user.id, isFunding ? 'debit' : 'credit', amount,
            isFunding ? 'Transfer to Trading Wallet' : 'Transfer from Trading Wallet'
        ]);
        await connection.commit();
        const [[updated]] = await connection.query('SELECT balance, trading_balance FROM users WHERE id = ?', [req.user.id]);
        res.json({ message: isFunding ? 'Funds added to trading wallet.' : 'Funds returned to bank account.', bankBalance: Number(updated.balance), tradingBalance: Number(updated.trading_balance) });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ message: err.message || 'Trading wallet transfer failed.' });
    } finally {
        connection.release();
    }
});
app.get('/api/portfolio', authenticateToken, userController.getPortfolio);
app.get('/api/watchlist', authenticateToken, userController.getWatchlist);
app.post('/api/watchlist', authenticateToken, userController.addToWatchlist);
app.delete('/api/watchlist/:symbol', authenticateToken, userController.removeFromWatchlist);


app.post('/api/request-loan', authenticateToken, userController.requestLoan);
app.get('/api/my-loans', authenticateToken, userController.getLoans);
app.post('/api/create-fd', authenticateToken, userController.createFD);
app.get('/api/my-fds', authenticateToken, userController.getFDs);
app.post('/api/schedule-transfer', authenticateToken, userController.scheduleTransfer);
// ASBA Routes
app.get('/api/asba/offerings', authenticateToken, userController.getOpenOfferings);
app.get('/api/asba/upcoming-offerings', authenticateToken, userController.getUpcomingOfferings);
app.get('/api/asba/my-applications', authenticateToken, userController.getMyApplications);
app.post('/api/asba/apply', authenticateToken, userController.applyForShare);



app.post('/api/deposit', authenticateToken, async (req, res) => {
    const { userId, amount, branch, remarks } = req.body;
    try {
        await db.promise().query("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, userId]);
        await db.promise().query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'credit', ?, ?)", 
            [userId, amount, `Cash Deposit at ${branch}: ${remarks || 'None'}`]);
        
        // Send Notification to User
        await db.promise().query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", 
            [userId, `Rs. ${parseFloat(amount).toLocaleString()} has been deposited into your account via Cash Deposit.`]);

        const [newBal] = await db.promise().query("SELECT balance FROM users WHERE id = ?", [userId]);
        res.json({ message: "Deposit processed successfully!", newBalance: newBal[0].balance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to process deposit" });
    }
});

app.post('/api/withdraw', authenticateToken, async (req, res) => {
    const amount = Number(req.body.amount);
    const method = String(req.body.method || '').toLowerCase();
    const branch = String(req.body.branch || '').trim();
    const pin = String(req.body.pin || '');
    const remarks = String(req.body.remarks || '').trim().slice(0, 100);
    const dailyLimit = 100000;

    if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Enter a valid withdrawal amount.' });
    }
    if (!['atm', 'branch'].includes(method)) {
        return res.status(400).json({ message: 'Select a valid withdrawal method.' });
    }
    if (method === 'branch' && !branch) {
        return res.status(400).json({ message: 'Branch is required for cash withdrawal.' });
    }
    if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({ message: 'Enter your 4-digit transaction PIN.' });
    }

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        const [[user]] = await connection.query(
            'SELECT balance, transaction_pin, status FROM users WHERE id = ? FOR UPDATE', [req.user.id]
        );
        if (!user) throw new Error('User account not found.');
        if (user.status !== 'active') throw new Error('Only active accounts can make withdrawals.');
        if (!await bcrypt.compare(pin, user.transaction_pin)) throw new Error('Incorrect transaction PIN.');
        if (Number(user.balance) < amount) throw new Error('Insufficient available balance.');

        const [[daily]] = await connection.query(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND type = 'debit' AND description LIKE 'Withdrawal:%' AND DATE(transaction_date) = CURDATE()",
            [req.user.id]
        );
        if (Number(daily.total) + amount > dailyLimit) {
            throw new Error(`Daily withdrawal limit is Rs. ${dailyLimit.toLocaleString()}.`);
        }

        const methodLabel = method === 'atm' ? 'ATM' : `Branch Cash (${branch})`;
        const description = `Withdrawal: ${methodLabel}${remarks ? ` - ${remarks}` : ''}`;
        await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, req.user.id]);
        const [transaction] = await connection.query(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'debit', ?, ?)",
            [req.user.id, amount, description]
        );
        await connection.query('INSERT INTO notifications (user_id, message) VALUES (?, ?)', [
            req.user.id, `Rs. ${amount.toLocaleString()} withdrawn via ${methodLabel}.`
        ]);
        const [[updated]] = await connection.query('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        await connection.commit();
        res.json({
            message: 'Withdrawal processed successfully.',
            newBalance: Number(updated.balance),
            reference: `WD-${transaction.insertId}`
        });
    } catch (err) {
        if (connection) await connection.rollback();
        res.status(400).json({ message: err.message || 'Withdrawal failed.' });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/api/admin/user-by-account/:accountNumber', authenticateToken, async (req, res) => {
    const { accountNumber } = req.params;
    try {
        const [users] = await db.promise().query("SELECT first_name, last_name FROM users WHERE account_number = ?", [accountNumber]);
        if (users.length === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        res.json(users[0]);
    } catch (err) {
        console.error("Error fetching user by account number:", err);
        res.status(500).json({ message: "Server error." });
    }
});

app.get('/api/user-by-account/:accountNumber', authenticateToken, async (req, res) => {
    const { accountNumber } = req.params;
    try {
        // Ensure the account number is treated as a number for matching BIGINT in DB
        const [users] = await db.promise().query("SELECT first_name, last_name FROM users WHERE account_number = ?", [Number(accountNumber)]);
        if (users.length === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        res.json(users[0]);
    } catch (err) {
        console.error("Error fetching user by account number:", err);
        res.status(500).json({ message: "Server error." });
    }
});

app.get('/api/transactions/:userId', authenticateToken, (req, res) => {
    if (Number(req.params.userId) !== Number(req.user.id)) {
        return res.status(403).json({ message: 'You can only view your own transactions.' });
    }
    db.query("SELECT * FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC", [req.user.id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.get('/api/order-history', authenticateToken, async (req, res) => {
    try {
        const [transactions] = await db.promise().query(
            "SELECT transaction_date, type, amount, description FROM transactions WHERE user_id = ? AND (description LIKE 'Share Purchase:%' OR description LIKE 'Share Sell:%') ORDER BY transaction_date DESC",
            [req.user.id]
        );
        const orders = transactions.map(transaction => {
            const match = transaction.description.match(/^Share (Purchase|Sell): (\d+) units of ([A-Z0-9._-]+) @ Rs\. ([\d.]+)/i);
            if (!match) return null;
            return {
                transaction_date: transaction.transaction_date,
                order_type: match[1].toLowerCase() === 'purchase' ? 'Buy' : 'Sell',
                quantity: Number(match[2]),
                symbol: match[3].toUpperCase(),
                price: Number(match[4]),
                amount: Number(transaction.amount)
            };
        }).filter(Boolean);
        res.json(orders);
    } catch (err) {
        console.error('Error fetching order history:', err);
        res.status(500).json({ message: 'Server error fetching order history.' });
    }
});

app.get('/api/dashboard-data/:userId', async (req, res) => {
    try {
        const [notifications] = await db.promise().query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [req.params.userId]);
        res.json({ notifications: notifications || [] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching dashboard info" });
    }
});

app.post('/api/pay-bill', async (req, res) => {
    const { userId, amount, billType, customerId } = req.body;
    db.query("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?", [amount, userId, amount], async (err, result) => {
        if (err || result.affectedRows === 0) return res.status(400).json({ message: "Payment Failed" });
        db.query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'debit', ?, ?)", 
            [userId, amount, `${billType} Bill: ${customerId}`], async () => {
                const [newBal] = await db.promise().query("SELECT balance FROM users WHERE id = ?", [userId]);
                res.json({ message: "Bill Paid Successfully", newBalance: newBal[0].balance });
            });
    });
});

app.post('/api/admin/send-message', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Unauthorized" });
    const { userId, message } = req.body;
    try {
        await db.promise().query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [userId, `Message from Bank: ${message}`]);
        res.json({ message: "Message sent to user successfully!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to send message: " + err.message });
    }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const [[profile]] = await db.promise().query(
            'SELECT first_name, last_name, phone_number, branch, dob, gender, account_number, account_type, status, profile_pic FROM users WHERE id = ?',
            [req.user.id]
        );
        if (!profile) return res.status(404).json({ message: 'Profile not found.' });
        res.json({ profile });
    } catch (err) {
        res.status(500).json({ message: 'Could not load profile.' });
    }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
    const firstName = String(req.body.firstName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    const phone = String(req.body.phone || '').trim();
    const branch = String(req.body.branch || '').trim();
    if (!firstName || !lastName || !branch || firstName.length > 60 || lastName.length > 60 || branch.length > 100) {
        return res.status(400).json({ message: 'Enter valid name and branch details.' });
    }
    if (!/^[0-9+\-\s]{7,20}$/.test(phone)) {
        return res.status(400).json({ message: 'Enter a valid mobile number.' });
    }
    try {
        const [duplicate] = await db.promise().query('SELECT id FROM users WHERE phone_number = ? AND id <> ?', [phone, req.user.id]);
        if (duplicate.length) return res.status(409).json({ message: 'This mobile number is already registered.' });
        await db.promise().query(
            'UPDATE users SET first_name = ?, last_name = ?, phone_number = ?, branch = ? WHERE id = ?',
            [firstName, lastName, phone, branch, req.user.id]
        );
        res.json({ message: 'Profile details saved successfully.', profile: { first_name: firstName, last_name: lastName, phone_number: phone, branch } });
    } catch (err) {
        res.status(500).json({ message: 'Could not save profile details.' });
    }
});

app.post('/api/update-profile', authenticateToken, async (req, res) => {
    const image = String(req.body.image || '');
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(image) || image.length > 3000000) {
        return res.status(400).json({ message: 'Use a PNG, JPEG, or WebP image smaller than 2 MB.' });
    }
    try {
        await db.promise().query('UPDATE users SET profile_pic = ? WHERE id = ?', [image, req.user.id]);
        res.json({ message: 'Profile photo updated.' });
    } catch (err) {
        res.status(500).json({ message: 'Could not update profile photo.' });
    }
});

app.get('/api/notifications/:userId', (req, res) => {
    db.query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC", [req.params.userId], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.post('/api/forgot-password/reset', async (req, res) => {
    const { phone, newPassword } = req.body;
    if (!phone || !newPassword) {
        return res.status(400).json({ message: "Phone number and new password are required." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.query("UPDATE users SET password = ? WHERE phone_number = ?", [hashedPassword, phone], (err, result) => {
        if (err || result.affectedRows === 0) return res.status(500).json({ message: "Password reset failed" });
        res.json({ message: "Password updated successfully!" });
    });
});

const PORT = process.env.PORT || 3000;

async function initializeApp() {
    try {
        const [tradingBalanceColumn] = await db.promise().query("SHOW COLUMNS FROM `users` LIKE 'trading_balance'");
        if (tradingBalanceColumn.length === 0) {
            await db.promise().query("ALTER TABLE `users` ADD COLUMN `trading_balance` DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER `balance`");
            console.log("Column 'trading_balance' added to users.");
        }
        // Ensure the database schema is up-to-date before starting the server and registering routes
        const [columns] = await db.promise().query("SHOW COLUMNS FROM `share_applications` LIKE 'allotted_units'");
        if (columns.length === 0) {
            await db.promise().query("ALTER TABLE `share_applications` ADD COLUMN `allotted_units` INT DEFAULT 0");
            console.log("Column 'allotted_units' added to 'share_applications' table.");
        }

        // Ensure the 'portfolio' table exists
        const [portfolioTable] = await db.promise().query("SHOW TABLES LIKE 'portfolio'");
        if (portfolioTable.length === 0) {
            const createPortfolioTableSQL = `
                CREATE TABLE \`portfolio\` (
                  \`id\` INT NOT NULL AUTO_INCREMENT,
                  \`user_id\` INT NOT NULL,
                  \`symbol\` VARCHAR(10) NOT NULL,
                  \`quantity\` INT NOT NULL,
                  \`average_price\` DECIMAL(10, 2) NOT NULL,
                  PRIMARY KEY (\`id\`),
                  UNIQUE KEY \`user_symbol_unique\` (\`user_id\`, \`symbol\`)
                );`;
            await db.promise().query(createPortfolioTableSQL);
            console.log("Table 'portfolio' created successfully.");
        }

        const [priceHistoryTable] = await db.promise().query("SHOW TABLES LIKE 'stock_price_history'");
        if (priceHistoryTable.length === 0) {
            await db.promise().query(`
                CREATE TABLE \`stock_price_history\` (
                  \`id\` INT NOT NULL AUTO_INCREMENT,
                  \`symbol\` VARCHAR(10) NOT NULL,
                  \`price\` DECIMAL(10, 2) NOT NULL,
                  \`recorded_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  PRIMARY KEY (\`id\`),
                  INDEX \`stock_history_symbol_time\` (\`symbol\`, \`recorded_at\`)
                );`);
            await db.promise().query("INSERT INTO stock_price_history (symbol, price) SELECT symbol, current_price FROM stocks");
            console.log("Table 'stock_price_history' created successfully.");
        }

        const [watchlistTable] = await db.promise().query("SHOW TABLES LIKE 'watchlist'");
        if (watchlistTable.length === 0) {
            await db.promise().query(`
                CREATE TABLE \`watchlist\` (
                  \`id\` INT NOT NULL AUTO_INCREMENT,
                  \`user_id\` INT NOT NULL,
                  \`symbol\` VARCHAR(10) NOT NULL,
                  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  PRIMARY KEY (\`id\`),
                  UNIQUE KEY \`user_symbol_watchlist_unique\` (\`user_id\`, \`symbol\`),
                  INDEX \`watchlist_user_idx\` (\`user_id\`)
                );`);
            console.log("Table 'watchlist' created successfully.");
        }

        // Now register the share admin routes, as the database is ready
        app.use('/api/share-admin', shareAdminRoutes);

        initializeMarketSocket(server);
        server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    } catch (error) {
        console.error("Failed to initialize application:", error);
        process.exit(1); // Exit if critical initialization fails
    }
}

// Call the initialization function to start the app
initializeApp();

// Start the background job to update share statuses
require('./controllers/update_share_status.js');
