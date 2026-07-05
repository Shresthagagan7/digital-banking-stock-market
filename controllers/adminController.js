const db = require('../db');

const logAction = (adminId, action, details) => {
    db.query("INSERT INTO audit_logs (admin_id, action, details) VALUES (?, ?, ?)", [adminId, action, details]);
};

exports.updateStatus = async (req, res) => {
    const { userId, status } = req.body;
    const adminId = req.user.id;
    
    try {
        await db.promise().query("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
        logAction(adminId, 'UPDATE_STATUS', `Changed user ${userId} status to ${status}`);
        res.json({ message: `Account status updated to ${status}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to update status" });
    }
};

exports.updateBalance = async (req, res) => {
    const { userId, action, amount } = req.body;
    const adminId = req.user.id;
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
    }

    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();

        let sql = "";
        let description = "";
        let type = action === 'd' ? 'credit' : 'debit';

        if (action === 'd') {
            sql = "UPDATE users SET balance = balance + ? WHERE id = ?";
            description = "Cash Deposit by Admin";
        } else if (action === 'w') {
            const [user] = await connection.query("SELECT balance FROM users WHERE id = ?", [userId]);
            if (user[0].balance < numAmount) {
                throw new Error("Insufficient balance for withdrawal");
            }
            sql = "UPDATE users SET balance = balance - ? WHERE id = ?";
            description = "Cash Withdrawal by Admin";
        }

        await connection.query(sql, [numAmount, userId]);

        await connection.query(
            "INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)",
            [userId, type, numAmount, description]
        );

        // Send Notification to User
        const notiMsg = action === 'd' ? `Admin deposited Rs. ${numAmount.toLocaleString()} into your account.` : `Admin withdrew Rs. ${numAmount.toLocaleString()} from your account.`;
        await connection.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [userId, notiMsg]);

        await connection.commit();
        logAction(adminId, 'UPDATE_BALANCE', `${action === 'd' ? 'Deposited' : 'Withdrew'} ${amount} for user ${userId}`);
        res.json({ message: "Balance updated and transaction recorded successfully" });

    } catch (err) {
        await connection.rollback();
        res.status(400).json({ message: err.message || "Balance update failed" });
    } finally {
        connection.release();
    }
};

exports.getStats = async (req, res) => {
    try {
        const [rows] = await db.promise().query("SELECT COUNT(*) as totalUsers, SUM(balance) as totalDeposits FROM users WHERE role = 'user' AND status = 'active'");
        res.json({
            totalUsers: rows[0].totalUsers || 0,
            totalDeposits: rows[0].totalDeposits || 0
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching stats" });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const [rows] = await db.promise().query("SELECT id, first_name, last_name, account_number, phone_number, balance, role, status FROM users WHERE role = 'user'");
        const users = rows.map(user => ({
            ...user,
            balance: parseFloat(user.balance)
        }));
        res.json(users);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching users" });
    }
};

exports.getPendingRequests = async (req, res) => {
    try {
        const [rows] = await db.promise().query("SELECT id, first_name, last_name, account_number, phone_number FROM users WHERE status = 'pending' AND role = 'user'");
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching pending requests" });
    }
};

exports.approveUser = async (req, res) => {
    const { userId } = req.body;
    const adminId = req.user.id;
    await db.promise().query("UPDATE users SET status = 'active' WHERE id = ?", [userId]);
    // Notify User
    await db.promise().query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [userId, "Congratulations! Your account has been approved. You can now start banking."]);
    logAction(adminId, 'APPROVE_USER', `Approved account request for user ${userId}`);
    res.json({ message: "User approved" });
};
exports.deleteUser = async (req, res) => {
    const adminId = req.user.id;
    await db.promise().query("DELETE FROM users WHERE id = ?", [req.params.id]);
    logAction(adminId, 'DELETE_USER', `Deleted user account ${req.params.id}`);
    res.json({ message: "User deleted" });
};

exports.sendDirectMessage = async (req, res) => {
    const adminId = req.user.id;
    const { userId, message } = req.body;
    try {
        await db.promise().query("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [userId, `Message from Bank: ${message}`]);
        logAction(adminId, 'SEND_MESSAGE', `Sent message to user ${userId}`);
        res.json({ message: "Message sent to user successfully!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to send message: " + err.message });
    }
};