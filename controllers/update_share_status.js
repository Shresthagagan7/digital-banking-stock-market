const db = require('../db');

async function updateShareStatuses() {
    const connection = await db.promise().getConnection();
    try {
        const now = new Date().toISOString().slice(0, 10); // Get YYYY-MM-DD format

        // 1. Update 'upcoming' to 'open'
        // Find offerings where open_date is today or in the past, and status is 'upcoming'
        const [toOpen] = await connection.query(
            "UPDATE share_offerings SET status = 'open' WHERE open_date <= ? AND status = 'upcoming'",
            [now]
        );
        if (toOpen.affectedRows > 0) {
            console.log(`[Share Status Job] Opened ${toOpen.affectedRows} share offering(s).`);
        }

        // 2. Update 'open' to 'closed'
        // Find offerings where close_date is in the past, and status is 'open'
        const [toClose] = await connection.query(
            "UPDATE share_offerings SET status = 'closed' WHERE close_date < ? AND status = 'open'",
            [now]
        );
        if (toClose.affectedRows > 0) {
            console.log(`[Share Status Job] Closed ${toClose.affectedRows} share offering(s).`);
        }
    } catch (err) {
        console.error("[Share Status Job] Error updating share statuses:", err);
    } finally {
        connection.release();
    }
}

// Run the job every 60 seconds
setInterval(updateShareStatuses, 60 * 1000);

console.log("[Share Status Job] Background job for updating share statuses has started.");