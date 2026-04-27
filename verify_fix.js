const { LatencyRecent, Sequelize } = require('./src/models');

async function verify() {
  try {
    console.log('Testing getRecentLatencySummary logic...');
    
    // 1. Raw Average (including 0s)
    const rawResult = await LatencyRecent.findAll({
      attributes: [
        [Sequelize.fn('AVG', Sequelize.col('latency_ms')), 'avg_latency']
      ],
      raw: true
    });
    console.log('Average including 0ms:', rawResult[0].avg_latency);

    // 2. Updated Average (excluding 0s via NULLIF)
    const updatedResult = await LatencyRecent.findAll({
      attributes: [
        [Sequelize.fn('AVG', Sequelize.literal('NULLIF(latency_ms, 0)')), 'avg_latency']
      ],
      raw: true
    });
    console.log('Average excluding 0ms:', updatedResult[0].avg_latency);

    if (parseFloat(updatedResult[0].avg_latency) > parseFloat(rawResult[0].avg_latency)) {
      console.log('SUCCESS: Average increased as expected by ignoring local 0ms devices.');
    } else {
      console.log('WARNING: Average did not increase. This might mean there are no 0ms samples or all samples are 0ms.');
    }

  } catch (err) {
    console.error('Verification failed:', err);
  } finally {
    process.exit();
  }
}

verify();
