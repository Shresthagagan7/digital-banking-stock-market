const db = require('../db');

exports.getShareStats = async (req, res) => {
    try {
        const [[stockStats]] = await db.promise().query("SELECT COUNT(*) as totalStocks FROM stocks");
        // Note: Calculating total portfolio value can be complex.
        // This is a simplified version assuming a `user_portfolio` table exists.
        // For now, we will return a mock value or a simple calculation.
        // Let's assume a `user_portfolio` table with `quantity` and `stock_id`
        // and we join with `stocks` to get the price.
        const [[portfolioValue]] = await db.promise().query(`
            SELECT SUM(p.quantity * s.current_price) as totalValue
            FROM user_portfolio p
            JOIN stocks s ON p.stock_id = s.id
        `);

        res.json({
            totalStocks: stockStats.totalStocks || 0,
            totalPortfolioValue: portfolioValue.totalValue || 0
        });
    } catch (err) {
        console.error("Error fetching share stats:", err);
        res.status(500).json({ message: "Server error fetching share stats." });
    }
};

exports.getAllStocks = async (req, res) => {
    try {
        const [stocks] = await db.promise().query("SELECT * FROM stocks ORDER BY symbol ASC");
        res.json(stocks);
    } catch (err) {
        console.error("Error fetching all stocks:", err);
        res.status(500).json({ message: "Server error fetching stocks." });
    }
};

exports.addStock = async (req, res) => {
    const { symbol, name, current_price } = req.body;
    if (!symbol || !name || !current_price) {
        return res.status(400).json({ message: "All fields are required." });
    }
    try {
        await db.promise().query("INSERT INTO stocks (symbol, name, current_price) VALUES (?, ?, ?)", [symbol.toUpperCase(), name, current_price]);
        res.status(201).json({ message: "Stock added successfully." });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: "Stock symbol already exists." });
        }
        console.error("Error adding stock:", err);
        res.status(500).json({ message: "Server error adding stock." });
    }
};

exports.updateStockPrice = async (req, res) => {
    const { id } = req.params;
    const { current_price } = req.body;
    if (!current_price || isNaN(current_price)) {
        return res.status(400).json({ message: "A valid price is required." });
    }
    try {
        await db.promise().query("UPDATE stocks SET current_price = ? WHERE id = ?", [current_price, id]);
        res.json({ message: "Stock price updated successfully." });
    } catch (err) {
        console.error("Error updating stock price:", err);
        res.status(500).json({ message: "Server error updating stock price." });
    }
};

exports.getStockPriceBySymbol = async (req, res) => {
    const { symbol } = req.params;
    try {
        const [[stock]] = await db.promise().query("SELECT symbol, current_price FROM stocks WHERE symbol = ?", [symbol.toUpperCase()]);
        if (!stock) return res.status(404).json({ message: "Stock not found." });
        res.json(stock);
    } catch (err) {
        res.status(500).json({ message: "Server error." });
    }
};

exports.addShareOffering = async (req, res) => {
    const { offeringType, companyName, symbol, totalUnits, price, openDate, closeDate } = req.body;

    if (!offeringType || !companyName || !symbol || !totalUnits || !price || !openDate || !closeDate) {
        return res.status(400).json({ message: "All fields are required to add a share offering." });
    }

    try {
        const sql = `
            INSERT INTO share_offerings 
            (company_name, symbol, offering_type, total_units, price_per_unit, open_date, close_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await db.promise().query(sql, [companyName, symbol.toUpperCase(), offeringType, totalUnits, price, openDate, closeDate]);
        res.status(201).json({ message: "New share offering has been added successfully." });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: `An offering with the symbol '${symbol.toUpperCase()}' already exists.` });
        }
        console.error("Error adding share offering:", err);
        res.status(500).json({ message: "Server error while adding the share offering." });
    }
};

exports.getOfferingsForAllotment = async (req, res) => {
    try {
        const [offerings] = await db.promise().query(
            "SELECT id, company_name, symbol, status, total_units FROM share_offerings WHERE status = 'closed' ORDER BY close_date DESC"
        );
        res.json(offerings);
    } catch (err) {
        console.error("Error fetching offerings for allotment:", err);
        res.status(500).json({ message: "Server error fetching offerings." });
    }
};

exports.getApplicantsForOffering = async (req, res) => {
    const { id } = req.params;
    try {
        const sql = `
            SELECT u.id as user_id, u.first_name, u.last_name, u.account_number, sa.applied_units
            FROM share_applications sa
            JOIN users u ON sa.user_id = u.id
            WHERE sa.offering_id = ?
            ORDER BY sa.applied_at ASC
        `;
        const [applicants] = await db.promise().query(sql, [id]);
        res.json(applicants);
    } catch (err) {
        console.error("Error fetching applicants for offering:", err);
        res.status(500).json({ message: "Server error fetching applicants." });
    }
};

exports.processAllotment = async (req, res) => {
    const { offeringId, allottedUserIds } = req.body;

    if (!offeringId || !Array.isArray(allottedUserIds)) {
        return res.status(400).json({ message: "Invalid request data." });
    }

    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get offering details
        const [[offering]] = await connection.query("SELECT * FROM share_offerings WHERE id = ?", [offeringId]);
        if (!offering || offering.status !== 'closed') {
            throw new Error("This offering is not ready for allotment or does not exist.");
        }

        // 2. Get all applicants for this offering
        const [allApplicants] = await connection.query("SELECT * FROM share_applications WHERE offering_id = ?", [offeringId]);

        for (const applicant of allApplicants) {
            const userId = applicant.user_id;
            const isAllotted = allottedUserIds.includes(userId);

            if (isAllotted) {
                // User is allotted
                // a. Update application status
                await connection.query("UPDATE share_applications SET status = 'Allotted' WHERE id = ?", [applicant.id]);

                // b. Release hold amount and deduct it from actual balance (already done when applying)
                await connection.query("UPDATE users SET hold_balance = hold_balance - ? WHERE id = ?", [applicant.applied_amount, userId]);

                // c. Add shares to user's portfolio
                const [existing] = await connection.query("SELECT * FROM portfolio WHERE user_id = ? AND symbol = ?", [userId, offering.symbol]);
                if (existing.length > 0) {
                    const oldQty = existing[0].quantity;
                    const oldAvg = existing[0].average_price;
                    const newQty = oldQty + applicant.applied_units;
                    const newAvg = ((oldQty * oldAvg) + applicant.applied_amount) / newQty;
                    await connection.query("UPDATE portfolio SET quantity = ?, average_price = ? WHERE id = ?", [newQty, newAvg, existing[0].id]);
                } else {
                    await connection.query("INSERT INTO portfolio (user_id, symbol, quantity, average_price) VALUES (?, ?, ?, ?)", [userId, offering.symbol, applicant.applied_units, offering.price_per_unit]);
                }
                
                // d. Add transaction record
                await connection.query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'debit', ?, ?)",
                    [userId, applicant.applied_amount, `Allotment: ${applicant.applied_units} units of ${offering.symbol}`]);

            } else {
                // User is not allotted
                // a. Update application status
                await connection.query("UPDATE share_applications SET status = 'Not Allotted' WHERE id = ?", [applicant.id]);

                // b. Refund the blocked amount
                await connection.query("UPDATE users SET balance = balance + ?, hold_balance = hold_balance - ? WHERE id = ?", [applicant.applied_amount, applicant.applied_amount, userId]);

                // c. Send notification
                await connection.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)",
                    [userId, `Your application for ${offering.company_name} was not allotted. Rs. ${applicant.applied_amount.toLocaleString()} has been refunded to your account.`]);
            }
        }

        // 3. Update the offering status to 'allotted'
        await connection.query("UPDATE share_offerings SET status = 'allotted' WHERE id = ?", [offeringId]);

        await connection.commit();
        res.json({ message: `Allotment for ${offering.company_name} processed successfully. ${allottedUserIds.length} users were allotted shares.` });

    } catch (err) {
        await connection.rollback();
        console.error("Error processing allotment:", err);
        res.status(500).json({ message: "Failed to process allotment: " + err.message });
    } finally {
        connection.release();
    }
};