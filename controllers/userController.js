const db = require('../db');
const bcrypt = require('bcryptjs');

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

        // Check if the stock exists in the stocks table before allowing a purchase
        const [stockExists] = await connection.query("SELECT id FROM stocks WHERE symbol = ?", [symbol]);
        if (stockExists.length === 0) {
            throw new Error(`The stock with symbol '${symbol}' is not listed in the market. Cannot purchase.`);
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
    // Use LEFT JOIN to ensure all portfolio items are returned, even if the stock is not listed in the 'stocks' table.
    // This prevents portfolio items from disappearing if a stock is delisted or not present in the stocks table.
    const query = ` 
        SELECT p.symbol, p.quantity, p.average_price, s.name AS company_name, s.current_price
        FROM portfolio p
        LEFT JOIN stocks s ON p.symbol = s.symbol
        WHERE p.user_id = ?
    `;
    const [rows] = await db.promise().query(query, [req.user.id]);
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

// --- ASBA CONTROLLERS ---

exports.getOpenOfferings = async (req, res) => {
    try {
        // Fetches offerings that are currently open for application
        const [offerings] = await db.promise().query(
            "SELECT id, company_name, symbol, price_per_unit, close_date FROM share_offerings WHERE status = 'open' AND close_date >= CURDATE() ORDER BY close_date ASC"
        );
        res.json(offerings);
    } catch (err) {
        console.error("Error fetching open offerings:", err);
        res.status(500).json({ message: "Server error fetching open offerings." });
    }
};

exports.getUpcomingOfferings = async (req, res) => {
    try {
        // Fetches offerings that are not yet open
        const [offerings] = await db.promise().query(
            "SELECT company_name, symbol, open_date, close_date FROM share_offerings WHERE status = 'upcoming' AND open_date > CURDATE() ORDER BY open_date ASC"
        );
        res.json(offerings);
    } catch (err) {
        console.error("Error fetching upcoming offerings:", err);
        res.status(500).json({ message: "Server error fetching upcoming offerings." });
    }
};

exports.getMyApplications = async (req, res) => {
    try {
        const sql = `
            SELECT sa.applied_at, so.company_name, sa.applied_units, sa.allotted_units, sa.status, sa.offering_id, so.symbol, so.price_per_unit
            FROM share_applications sa
            JOIN share_offerings so ON sa.offering_id = so.id
            WHERE sa.user_id = ?
            ORDER BY sa.applied_at DESC
        `;
        const [applications] = await db.promise().query(sql, [req.user.id]);
        res.json(applications);
    } catch (err) {
        console.error("Error fetching user's share applications:", err);
        res.status(500).json({ message: "Server error fetching your applications." });
    }
};

exports.applyForShare = async (req, res) => {
    const userId = req.user.id;
    const { offeringId, units, pin } = req.body;

    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();

        // 1. Verify Transaction PIN and get user details
        const [users] = await connection.query("SELECT balance, hold_balance, transaction_pin FROM users WHERE id = ?", [userId]);
        if (users.length === 0) throw new Error("User not found.");
        const user = users[0];

        const isPinMatch = await bcrypt.compare(pin, user.transaction_pin);
        if (!isPinMatch) throw new Error("Incorrect Transaction PIN.");

        // 2. Get offering details and calculate amount
        const [offerings] = await connection.query("SELECT price_per_unit, company_name FROM share_offerings WHERE id = ? AND status = 'open'", [offeringId]);
        if (offerings.length === 0) throw new Error("This share is not open for application or does not exist.");
        const offering = offerings[0];
        const totalAmount = units * offering.price_per_unit;

        // 3. Check balance
        if (user.balance < totalAmount) throw new Error("Insufficient balance.");

        // 4. Block amount from user's balance
        await connection.query("UPDATE users SET balance = balance - ?, hold_balance = hold_balance + ? WHERE id = ?", [totalAmount, totalAmount, userId]);

        // 5. Record the application
        await connection.query(
            "INSERT INTO share_applications (user_id, offering_id, applied_units, applied_amount) VALUES (?, ?, ?, ?)",
            [userId, offeringId, units, totalAmount]
        );

        await connection.commit();
        res.status(201).json({ message: `Successfully applied for ${units} units of ${offering.company_name}. Rs. ${totalAmount.toLocaleString()} has been blocked from your account.` });
    } catch (err) {
        await connection.rollback();
        // Check for duplicate entry error
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: "You have already applied for this share." });
        }
        res.status(400).json({ message: err.message || "Failed to apply for share." });
    } finally {
        connection.release();
    }
};

exports.scheduleTransfer = async (req, res) => {
    res.json({ message: "Transaction scheduled successfully!" });
};