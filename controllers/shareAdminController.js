const db = require('../db');

exports.getShareStats = async (req, res) => {
    try {
        const [[stockStats]] = await db.promise().query("SELECT COUNT(*) as totalStocks FROM stocks");
        // Corrected the query to use the 'portfolio' table and join on 'symbol'.
        const [[portfolioValue]] = await db.promise().query(`
            SELECT SUM(p.quantity * s.current_price) as totalValue
            FROM portfolio p
            JOIN stocks s ON p.symbol = s.symbol
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
        // Fetches all stocks for the admin to manage their prices.
        const query = `
            SELECT id, symbol, name, current_price 
            FROM stocks 
            ORDER BY symbol ASC`;
        const [stocks] = await db.promise().query(query);
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
    const { name, current_price } = req.body;
    if (!name || !current_price || isNaN(current_price)) {
        return res.status(400).json({ message: "A valid name and price are required." });
    }
    try {
        await db.promise().query("UPDATE stocks SET name = ?, current_price = ? WHERE id = ?", [name, current_price, id]);
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

exports.getOfferingsWithApplicants = async (req, res) => {
    try {
        const [offerings] = await db.promise().query(
            `SELECT o.id, o.company_name, o.symbol, o.status, o.total_units 
             FROM share_offerings o
             JOIN share_applications sa ON o.id = sa.offering_id
             WHERE o.status IN ('closed', 'open')
             GROUP BY o.id
             ORDER BY o.close_date DESC`
        );
        res.json(offerings);
    } catch (err) {
        console.error("Error fetching offerings with applicants:", err);
        res.status(500).json({ message: "Server error fetching offerings." });
    }
};

exports.getApplicantsForOffering = async (req, res) => {
    const { id } = req.params;
    try {
        const sql = `
            SELECT sa.id, u.id as user_id, u.first_name, u.last_name, u.account_number, sa.applied_units
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
    const { offeringId, allotments } = req.body; // Changed from allottedUserIds to allotments

    if (!offeringId || !Array.isArray(allotments)) {
        return res.status(400).json({ message: "Invalid request data." });
    }

    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get offering details
        const [[offering]] = await connection.query("SELECT * FROM share_offerings WHERE id = ? AND status IN ('open', 'closed')", [offeringId]);
        if (!offering) {
            throw new Error("This offering is not available for allotment or has already been processed.");
        }

        // If the offering is still 'open', close it first to prevent new applications during allotment.
        if (offering.status === 'open') {
            await connection.query("UPDATE share_offerings SET status = 'closed' WHERE id = ?", [offeringId]);
            console.log(`Offering ID ${offeringId} status changed from 'open' to 'closed' before allotment.`);
        }

        // 2. Get all applicants for this offering
        const [allApplicants] = await connection.query("SELECT * FROM share_applications WHERE offering_id = ?", [offeringId]);

        // Create a map for quick lookup of allotted units by applicant ID
        const allotmentMap = new Map(allotments.map(a => [a.applicantId, a.allottedUnits]));

        for (const applicant of allApplicants) {
            const userId = applicant.user_id;
            const allottedUnits = allotmentMap.get(applicant.id) || 0;

            if (allottedUnits > 0) {
                // --- User is ALLOTTED ---
                const allottedAmount = allottedUnits * offering.price_per_unit;
                const refundAmount = applicant.applied_amount - allottedAmount;

                // a. Update application status with allotted units
                await connection.query("UPDATE share_applications SET status = 'Allotted', allotted_units = ? WHERE id = ?", [allottedUnits, applicant.id]);

                // b. Update user's balance: release hold, refund if partially allotted
                await connection.query(
                    "UPDATE users SET balance = balance + ?, hold_balance = hold_balance - ? WHERE id = ?",
                    [refundAmount, applicant.applied_amount, userId]
                );

                // c. Add/Update shares in user's portfolio
                const [existing] = await connection.query("SELECT * FROM portfolio WHERE user_id = ? AND symbol = ?", [userId, offering.symbol]);
                if (existing.length > 0) {
                    await connection.query("UPDATE portfolio SET quantity = quantity + ? WHERE id = ?", [allottedUnits, existing[0].id]);
                } else {
                    await connection.query("INSERT INTO portfolio (user_id, symbol, quantity, average_price) VALUES (?, ?, ?, ?)", [userId, offering.symbol, allottedUnits, offering.price_per_unit]);
                }
                
                // d. Add transaction record for the purchase
                await connection.query("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, 'debit', ?, ?)",
                    [userId, allottedAmount, `Allotment: ${allottedUnits} units of ${offering.symbol}`]);

                // e. Send notification for allotment
                await connection.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)",
                    [userId, `Congratulations! You have been allotted ${allottedUnits} units of ${offering.company_name}.`]);

            } else {
                // --- User is NOT ALLOTTED ---
                // a. Update application status
                await connection.query("UPDATE share_applications SET status = 'Not Allotted' WHERE id = ?", [applicant.id]);

                // b. Refund the blocked amount
                await connection.query("UPDATE users SET balance = balance + ?, hold_balance = hold_balance - ? WHERE id = ?", [applicant.applied_amount, applicant.applied_amount, userId]);

                // c. Send notification for non-allotment
                await connection.query("INSERT INTO notifications (user_id, message) VALUES (?, ?)",
                    [userId, `Your application for ${offering.company_name} was not allotted. Rs. ${applicant.applied_amount.toLocaleString()} has been refunded to your account.`]);
            }
        }

        // 3. Update the offering status to 'allotted'
        await connection.query("UPDATE share_offerings SET status = 'allotted' WHERE id = ?", [offeringId]);

        await connection.commit();
        res.json({ message: `Allotment for ${offering.company_name} processed successfully. ${allotments.length} users were allotted shares.` });

    } catch (err) {
        await connection.rollback();
        console.error("Error processing allotment:", err);
        res.status(500).json({ message: "Failed to process allotment: " + err.message });
    } finally {
        connection.release();
    }
};