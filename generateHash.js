const { hash } = require('bcryptjs');

async function createAdminHash() {
    // --- You can set your desired password and PIN here ---
    const passwordToHash = 'gagan@123';
    const pinToHash = '1223'; // A sample PIN
    // -----------------------------------------------------------

    try {
        // Create hash using 10 salt rounds
        const hashedPassword = await hash(passwordToHash, 10);
        const hashedPin = await hash(pinToHash, 10);

        console.log("\n✅ Hashes generated successfully!");
        console.log("====================================================================================================");
        console.log(`Password Hash for '${passwordToHash}':`);
        console.log(hashedPassword);
        console.log("\n" + `PIN Hash for '${pinToHash}':`);
        console.log(hashedPin);
        console.log("====================================================================================================");
        console.log("\nInstruction: Replace 'GENERATED_PASSWORD_HASH' and 'GENERATED_PIN_HASH' in your SQL code with the hashes above.");

    } catch (error)
    {
        console.error("Error generating hashes:", error);
    }
}

createAdminHash();
