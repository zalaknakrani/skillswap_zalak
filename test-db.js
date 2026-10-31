
const db = require('./db');

async function testConnection() {
    try {
        const [rows] = await db.query(
            'SELECT DATABASE() AS database_name'
        );

        console.log('MySQL connected successfully!');
        console.log('Database:', rows[0].database_name);

        const [tables] = await db.query('SHOW TABLES');

        console.log('Tables found:');
        console.table(tables);
    } catch (error) {
        console.error('MySQL connection failed:', error.message);
    } finally {
        await db.end();
    }
}

testConnection();
