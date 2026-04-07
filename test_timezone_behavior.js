const { sequelize } = require('./src/models');
const { QueryTypes } = require('sequelize');

async function testTimezone() {
  console.log('--- TIMEZONE BEHAVIOR TEST ---');
  
  // 1. Check Node Time
  const nodeLocal = new Date();
  console.log('Node Local Time:', nodeLocal.toLocaleString());
  console.log('Node ISO String:', nodeLocal.toISOString());
  
  // 2. Check Database NOW()
  const [dbNow] = await sequelize.query("SELECT NOW() as now", { type: QueryTypes.SELECT });
  console.log('Database NOW():', dbNow.now);
  
  // 3. Save a date and see what string reaches MySQL
  await sequelize.query("CREATE TABLE IF NOT EXISTS tz_test (t DATETIME)");
  await sequelize.query("INSERT INTO tz_test (t) VALUES (?)", {
    replacements: [nodeLocal]
  });
  
  const [dbStored] = await sequelize.query("SELECT t, CAST(t AS CHAR) as t_str FROM tz_test ORDER BY rowid DESC LIMIT 1", { 
    type: QueryTypes.SELECT 
  }).catch(async () => {
     // MariaDB might not have rowid
     return await sequelize.query("SELECT t, CAST(t AS CHAR) as t_str FROM tz_test LIMIT 1", { type: QueryTypes.SELECT });
  });
  
  console.log('Database Stored Date (Object):', dbStored[0].t);
  console.log('Database Stored String (Raw):', dbStored[0].t_str);
  
  await sequelize.query("DROP TABLE tz_test");
  process.exit(0);
}

testTimezone().catch(e => {
  console.error(e);
  process.exit(1);
});
