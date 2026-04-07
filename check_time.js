const { sequelize, LatencyRecent } = require('./src/models');

async function checkTime() {
  try {
    const [tzRes] = await sequelize.query("SELECT @@session.time_zone as session_tz");
    console.log('Session Timezone:', tzRes[0].session_tz);

    const [dbTimeRes] = await sequelize.query("SELECT NOW() as db_now");
    console.log('Database NOW():', dbTimeRes[0].db_now);
    
    const [dbUtcRes] = await sequelize.query("SELECT UTC_TIMESTAMP() as db_utc");
    console.log('Database UTC_TIMESTAMP():', dbUtcRes[0].db_utc);

    const latest = await LatencyRecent.findOne({
      order: [['checked_at', 'DESC']],
      attributes: ['checked_at']
    });
    
    if (latest) {
      console.log('Latest checked_at in DB:', latest.checked_at);
    } else {
      console.log('No latency records found.');
    }

    console.log('Node.js new Date():', new Date().toISOString());
    console.log('Node.js Local String:', new Date().toLocaleString());
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkTime();
