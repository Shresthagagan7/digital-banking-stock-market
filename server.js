require('dotenv').config();
const express = require('express');
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

const app = express();
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
        const [users] = await db.promise().query("SELECT id, first_name, last_name, account_number, balance, hold_balance, role, status, profile_pic, branch FROM users WHERE id = ?", [req.user.id]);
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

app.post('/api/change-password', async (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;
    db.query("SELECT password FROM users WHERE id = ?", [userId], async (err, result) => {
        if (err || result.length === 0) return res.status(404).json({ message: "User not found" });

        const isMatch = await bcrypt.compare(oldPassword, result[0].password);
        if (!isMatch) return res.status(401).json({ message: "Incorrect old password" });

        const hashed = await bcrypt.hash(newPassword, 10);
        db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, userId], (err) => {
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
    const { amount, recipientAccount, transferType, recipientName } = req.body;
    const senderId = req.user.id;
    
    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: "Invalid transfer details" });
    }

    db.beginTransaction(async err => {
        if (err) return res.status(500).json({ message: "DB error" });
        try {
            const [sender] = await db.promise().query("SELECT * FROM users WHERE id = ?", [senderId]);
            if (!sender.length || sender[0].balance < amount) throw new Error("Insufficient funds or sender not found");

            if (transferType === 'same') {
                const [recip] = await db.promise().query("SELECT id FROM users WHERE account_number = ?", [recipientAccount]);
                if (!recip.length) throw new Error("Recipient account not found in this bank");
                if (recip[0].id === senderId) throw new Error("You cannot transfer money to yourself.");
                
                
                await db.promise().query("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, senderId]);
                await db.promise().query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'debit', ?, ?)", 
                    [senderId, amount, `Transfer to ${recipientName || recipientAccount}`]);
                // Notification for Sender
                await db.promise().query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", 
                    [senderId, `You sent Rs. ${amount.toLocaleString()} to Acc: ${recipientAccount}`]);

                
                await db.promise().query("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, recip[0].id]);
                await db.promise().query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'credit', ?, ?)", 
                    [recip[0].id, amount, `Received from ${sender[0].first_name} (${sender[0].account_number})`]);
                // Notification for Receiver
                await db.promise().query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", 
                    [recip[0].id, `You received Rs. ${amount.toLocaleString()} from ${sender[0].first_name}`]);
            } else {
                
                await db.promise().query("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, senderId]);
                await db.promise().query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'debit', ?, ?)", 
                    [senderId, amount, `Other Bank Transfer to ${recipientName} (${recipientAccount})`]);
                await db.promise().query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", 
                    [senderId, `Rs. ${amount.toLocaleString()} transferred to other bank (${recipientAccount})`]);
            }
            await db.promise().commit();

            
            const [newBal] = await db.promise().query("SELECT balance FROM users WHERE id = ?", [senderId]);
            res.json({ message: "Transfer Success", newBalance: newBal[0].balance });
        } catch (e) {
            await db.promise().rollback();
            res.status(400).json({ message: e.message });
        }
    });
});


app.post('/api/buy-share', authenticateToken, userController.buyShare);
app.post('/api/sell-share', authenticateToken, userController.sellShare);
app.get('/api/portfolio', authenticateToken, userController.getPortfolio);


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

app.get('/api/transactions/:userId', (req, res) => {
    db.query("SELECT * FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC", [req.params.userId], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
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

app.post('/api/update-profile', (req, res) => {
    const { userId, image } = req.body;
    db.query("UPDATE users SET profile_pic = ? WHERE id = ?", [image, userId], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ message: "Profile updated" });
    });
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

        // Now register the share admin routes, as the database is ready
        app.use('/api/share-admin', shareAdminRoutes);

        app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    } catch (error) {
        console.error("Failed to initialize application:", error);
        process.exit(1); // Exit if critical initialization fails
    }
}

// Call the initialization function to start the app
initializeApp();

// Start the background job to update share statuses
require('./controllers/update_share_status.js');
