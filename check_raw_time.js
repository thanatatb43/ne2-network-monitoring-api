const { sequelize } = require('./src/models');
const { QueryTypes } = require('sequelize');

async function checkRawTime() {
  console.log('--- CHECKING RAW DATABASE TIME ---');
  
  // 1. Check DB NOW()
  const [dbNow] = await sequelize.query("SELECT NOW() as now, CAST(NOW() AS CHAR) as now_str", { type: QueryTypes.SELECT });
  console.log('Database NOW() (Session Adjusted):', dbNow.now);
  console.log('Database NOW() (Raw String):', dbNow.now_str);
  
  // 2. Check last 5 records in LatencyRecents
  const records = await sequelize.query("SELECT id, checked_at, CAST(checked_at AS CHAR) as checked_at_str, createdAt FROM LatencyRecents ORDER BY id DESC LIMIT 5", { 
    type: QueryTypes.SELECT 
  });
  
  console.log('\n--- LAST 5 RECORDS (RAW) ---');
  records.forEach(r => {
    console.log(`ID: ${r.id} | CheckedAt (Obj): ${r.checked_at} | CheckedAt (Hex/Str): ${r.checked_at_str} | CreatedAt: ${r.createdAt}`);
  });
  
  process.exit(0);
}

checkRawTime().catch(e => {
  console.error(e);
  process.exit(1);
});
