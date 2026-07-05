const db = require('../db');

exports.buyShare = async (req, res) => {
    const userId = req.user.id;
    const { symbol, quantity, price } = req.body;
    const totalCost = quantity * price;

    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();

        const [user] = await connection.query("SELECT balance FROM users WHERE id = ?", [userId]);
        if (!user.length || user[0].balance < totalCost) {
            throw new Error("Insufficient bank balance to buy shares.");
        }

        await connection.query("UPDATE users SET balance = balance - ? WHERE id = ?", [totalCost, userId]);

        const [existing] = await connection.query("SELECT * FROM portfolio WHERE user_id = ? AND symbol = ?", [userId, symbol]);
        
        if (existing.length > 0) {
            const oldQty = existing[0].quantity;
            const oldAvg = existing[0].average_price;
            const newQty = oldQty + parseInt(quantity);
            const newAvg = ((oldQty * oldAvg) + totalCost) / newQty;

            await connection.query("UPDATE portfolio SET quantity = ?, average_price = ? WHERE id = ?", [newQty, newAvg, existing[0].id]);
        } else {
            await connection.query("INSERT INTO portfolio (user_id, symbol, quantity, average_price) VALUES (?, ?, ?, ?)", [userId, symbol, quantity, price]);
        }

        await connection.query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'debit', ?, ?)", 
            [userId, totalCost, `Share Purchase: ${quantity} units of ${symbol} @ Rs. ${price}`]);

        await connection.commit();
        res.json({ message: "Share purchase successful!" });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ message: err.message || "Failed to buy shares" });
    } finally {
        connection.release();
    }
};


exports.sellShare = async (req, res) => {
    const userId = req.user.id;
    const { symbol, quantity, price } = req.body; 
    const totalEarnings = quantity * price;

    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();

        const [existing] = await connection.query("SELECT * FROM portfolio WHERE user_id = ? AND symbol = ?", [userId, symbol]);
        if (!existing.length || existing[0].quantity < quantity) {
            throw new Error("You do not have enough units to sell.");
        }

        await connection.query("UPDATE users SET balance = balance + ? WHERE id = ?", [totalEarnings, userId]);

        const newQty = existing[0].quantity - parseInt(quantity);
        if (newQty === 0) {
            await connection.query("DELETE FROM portfolio WHERE id = ?", [existing[0].id]);
        } else {
            await connection.query("UPDATE portfolio SET quantity = ? WHERE id = ?", [newQty, existing[0].id]);
        }

        await connection.query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'credit', ?, ?)", 
            [userId, totalEarnings, `Share Sell: ${quantity} units of ${symbol} @ Rs. ${price}`]);

        await connection.commit();
        res.json({ message: "Share sold successfully!" });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ message: err.message || "Failed to sell shares" });
    } finally {
        connection.release();
    }
};


exports.getPortfolio = async (req, res) => {
    const [rows] = await db.promise().query("SELECT * FROM portfolio WHERE user_id = ?", [req.user.id]);
    res.json(rows);
};


exports.requestLoan = async (req, res) => {
    const { amount, purpose } = req.body;
    const interestRate = 12.0; 
    try {
        await db.promise().query(
            "INSERT INTO loans (user_id, amount, interest_rate, remaining_balance, status) VALUES (?, ?, ?, ?, 'pending')",
            [req.user.id, amount, interestRate, amount]
        );
        res.json({ message: "Loan request submitted to admin for approval." });
    } catch (err) {
        res.status(500).json({ message: "Loan request failed" });
    }
};

exports.getLoans = async (req, res) => {
    const [rows] = await db.promise().query("SELECT * FROM loans WHERE user_id = ?", [req.user.id]);
    res.json(rows);
};

exports.createFD = async (req, res) => {
    const { amount, durationMonths } = req.body;
    const rates = { "6": 7, "12": 9, "24": 11 };
    const interestRate = rates[durationMonths];

    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [user] = await connection.query("SELECT balance FROM users WHERE id = ?", [req.user.id]);
        if (user[0].balance < amount) throw new Error("Insufficient balance to lock in FD");

        await connection.query("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, req.user.id]);
        
        const maturityDate = new Date();
        maturityDate.setMonth(maturityDate.getMonth() + parseInt(durationMonths));

        await connection.query(
            "INSERT INTO fixed_deposits (user_id, amount, interest_rate, duration_months, start_date, maturity_date) VALUES (?, ?, ?, ?, CURDATE(), ?)",
            [req.user.id, amount, interestRate, durationMonths, maturityDate]
        );

        await connection.query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'debit', ?, ?)", 
            [req.user.id, amount, `Fixed Deposit Created (${durationMonths} months)`]);

        await connection.commit();
        res.json({ message: "FD created successfully!" });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ message: err.message });
    } finally {
        connection.release();
    }
};

exports.getFDs = async (req, res) => {
    const [rows] = await db.promise().query("SELECT * FROM fixed_deposits WHERE user_id = ?", [req.user.id]);
    res.json(rows);
};

exports.scheduleTransfer = async (req, res) => {
    res.json({ message: "Transaction scheduled successfully!" });
};