const { NetworkDevices, Clients, IpHistories, Sequelize } = require('../models');
const { scanSubnet } = require('../services/scannerService');

/**
 * Scan a network device's subnet and sync results with Clients and IpHistories
 */
const scanNetworkAndSync = async (req, res, next) => {
  const { index } = req.params;
  console.log(`[ClientController] Request to scan network index: ${index}`);

  try {
    const device = await NetworkDevices.findOne({ where: { index } });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Network device not found' });
    }

    // Collect all valid gateway/subnet pairs
    const scanTargets = [
      { gw: device.gateway, sn: device.subnet },
      { gw: device.sub_ip1_gateway, sn: device.sub_ip1_subnet },
      { gw: device.sub_ip2_gateway, sn: device.sub_ip2_subnet }
    ].filter(t => t.gw && t.gw !== '-' && t.sn && t.sn !== '-');

    if (scanTargets.length === 0) {
      return res.status(400).json({ success: false, message: 'Device has no valid gateways for scanning' });
    }

    // Reset status to offline for all clients currently associated with this site
    await Clients.update({ status: 'offline' }, { 
      where: { 
        [Sequelize.Op.or]: [
          { site: device.id.toString() },
          { main_site_id: device.id }
        ]
      } 
    });

    const allFoundDevices = [];
    for (const target of scanTargets) {
      try {
        const found = await scanSubnet(target.gw, target.sn);
        allFoundDevices.push(...found);
      } catch (err) {
        console.error(`[ClientController] Scan failed for gateway ${target.gw}:`, err);
        // Continue with other subnets
      }
    }

    // Deduplicate results by MAC address (if any overlap between subnets)
    const uniqueFound = [];
    const seenMacs = new Set();
    for (const d of allFoundDevices) {
      if (!seenMacs.has(d.mac_address)) {
        seenMacs.add(d.mac_address);
        uniqueFound.push(d);
      }
    }

    const offsetHours = process.env.DB_TIMEZONE_OFFSET !== undefined ? parseInt(process.env.DB_TIMEZONE_OFFSET) : 0;
    const now = new Date(new Date().getTime() + offsetHours * 60 * 60 * 1000);
    for (const found of uniqueFound) {
      const { ip_address, mac_address, client_name } = found;

      // 1. Check for IP Collision (IP now belongs to a different MAC)
      const existingClientByIp = await Clients.findOne({ where: { ip_address } });
      if (existingClientByIp && existingClientByIp.mac_address !== mac_address) {
        console.log(`[ClientController] IP Collision: ${ip_address} moved from ${existingClientByIp.mac_address} to ${mac_address}`);
        
        // Update history for the old client (it's no longer at this IP)
        await IpHistories.update(
          { last_seen: now },
          { where: { client_id: existingClientByIp.id, ip_address, last_seen: null }, limit: 1 }
        );

        // Disassociate old client from this IP and mark offline
        await existingClientByIp.update({ ip_address: null, status: 'offline' });
      }

      // 2. Find or Create Client by MAC
      let client = await Clients.findOne({ where: { mac_address } });

      if (client) {
        // Update existing client
        const ipChanged = client.ip_address !== ip_address;
        
        if (ipChanged) {
          // Record end of old IP if exists
          if (client.ip_address) {
            await IpHistories.update(
              { last_seen: now },
              { where: { client_id: client.id, ip_address: client.ip_address, last_seen: null }, limit: 1 }
            );
          }
          
          // Start new IP history
          await IpHistories.create({
            client_id: client.id,
            ip_address,
            first_seen: now,
            last_seen: null
          });
        }

        await client.update({
          client_name: client_name,
          ip_address,
          last_online: now,
          status: 'online', // Mark as online
          site: device.id.toString(), // Store device ID in site (string)
          main_site_id: device.id // Store device ID in main_site_id (int)
        });
      } else {
        // Create new client
        client = await Clients.create({
          client_name,
          mac_address,
          ip_address,
          first_seen: now,
          last_online: now,
          status: 'online', // Mark as online
          site: device.id.toString(), // Store device ID in site (string)
          main_site_id: device.id // Store device ID in main_site_id (int)
        });

        // Create IP history
        await IpHistories.create({
          client_id: client.id,
          ip_address,
          first_seen: now,
          last_seen: null
        });
      }
    }

    res.status(200).json({
      success: true,
      scanned_ips: uniqueFound.length,
      message: `Successfully scanned and synced ${uniqueFound.length} clients across all active subnets.`
    });
  } catch (error) {
    console.error('[ClientController] Error during scan:', error);
    next(error);
  }
};

/**
 * Get all clients associated with a specific network device ID
 * GET /api/clients/device/:id
 */
const getClientsByDevice = async (req, res, next) => {
  try {
    const { id } = req.params;

    const clients = await Clients.findAll({
      where: { 
        [Sequelize.Op.or]: [
          { site: id.toString() },
          { main_site_id: Number(id) }
        ]
      },
      order: [['last_online', 'DESC']]
    });

    res.status(200).json({
      success: true,
      count: clients.length,
      data: clients
    });
  } catch (error) {
    console.error('[ClientController] Error fetching clients:', error);
    next(error);
  }
};

module.exports = {
  scanNetworkAndSync,
  getClientsByDevice
};
