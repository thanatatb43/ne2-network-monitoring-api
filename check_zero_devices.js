const { NetworkDevices } = require('./src/models');

async function checkDevices() {
  try {
    const devices = await NetworkDevices.findAll({
      where: { id: [149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161] }
    });
    console.table(devices.map(d => ({
      id: d.id,
      pea_name: d.pea_name,
      gateway: d.gateway,
      wan_ip_fgt: d.wan_ip_fgt
    })));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkDevices();
