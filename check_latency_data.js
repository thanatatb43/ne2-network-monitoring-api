const { LatencyRecent } = require('./src/models');

async function checkData() {
  try {
    const data = await LatencyRecent.findAll({
      limit: 20,
      order: [['checked_at', 'DESC']]
    });
    console.log('Recent Latency Data (last 20):');
    console.table(data.map(d => ({
      id: d.id,
      device_id: d.device_id,
      latency_ms: d.latency_ms,
      packet_loss: d.packet_loss,
      status: d.status,
      checked_at: d.checked_at
    })));

    const summary = await LatencyRecent.findAll({
      attributes: [
        ['device_id', 'device_id'],
        [require('sequelize').fn('AVG', require('sequelize').col('latency_ms')), 'avg_latency']
      ],
      group: ['device_id']
    });
    console.log('\nAverage Latency per Device:');
    console.table(summary.map(s => ({
      device_id: s.get('device_id'),
      avg_latency: s.get('avg_latency')
    })));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkData();
