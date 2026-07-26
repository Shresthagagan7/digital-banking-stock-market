const db = require('../db');

/**
 * This function checks the share_offerings table and updates the status
 * of each offering based on its open_date and close_date.
 * 
 * - If status is 'upcoming' and today's date is on or after open_date, it becomes 'open'.
 * - If status is 'open' and today's date is after close_date, it becomes 'closed'.
 */
async function updateShareStatuses() {
    console.log(`[${new Date().toISOString()}] Running share status update job...`);
    const connection = await db.promise().getConnection();
    try {
        // Update 'upcoming' to 'open'
        const [upcomingResults] = await connection.query(
            "UPDATE share_offerings SET status = 'open' WHERE status = 'upcoming' AND CURDATE() >= open_date"
        );
        if (upcomingResults.affectedRows > 0) {
            console.log(`Updated ${upcomingResults.affectedRows} offerings from 'upcoming' to 'open'.`);
        }

        // Update 'open' to 'closed'
        const [openResults] = await connection.query(
            "UPDATE share_offerings SET status = 'closed' WHERE status = 'open' AND CURDATE() > close_date"
        );
        if (openResults.affectedRows > 0) {
            console.log(`Updated ${openResults.affectedRows} offerings from 'open' to 'closed'.`);
        }

    } catch (error) {
        console.error("Error updating share statuses:", error);
    } finally {
        if (connection) connection.release();
        console.log("Share status update job finished.");
    }
}

// Run the job immediately and then every 60 seconds
updateShareStatuses();
setInterval(updateShareStatuses, 60 * 1000); // 60 seconds

console.log("Share status updater script started. Will run every minute.");