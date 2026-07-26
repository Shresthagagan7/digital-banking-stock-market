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