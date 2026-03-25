const ping = require('ping');
const { exec } = require('child_process');
const ipLib = require('ip');
const dns = require('dns').promises;

/**
 * Service to scan a subnet and discover active clients
 */
const scanSubnet = async (networkId, subnetMask) => {
  console.log(`[ScannerService] Scanning ${networkId}${subnetMask}...`);
  
  try {
    const subnet = ipLib.cidrSubnet(`${networkId}${subnetMask}`);
    const firstIP = ipLib.toLong(subnet.firstAddress);
    const lastIP = ipLib.toLong(subnet.lastAddress);
    
    const ips = [];
    for (let i = firstIP; i <= lastIP; i++) {
      ips.push(ipLib.fromLong(i));
    }

    console.log(`[ScannerService] Pinging ${ips.length} IPs...`);
    
    // Ping all IPs and capture results
    const activeIps = new Set();
    const pingBatchSize = 100;
    for (let i = 0; i < ips.length; i += pingBatchSize) {
      const batch = ips.slice(i, i + pingBatchSize);
      const results = await Promise.all(batch.map(target => 
        ping.promise.probe(target, { timeout: 1, extra: ['-c', '1'] })
      ));
      results.forEach(r => {
        if (r.alive) activeIps.add(r.host);
      });
    }

    console.log(`[ScannerService] Ping sweep complete. Found ${activeIps.size} responsive IPs.`);
    
    const arpData = await getArpTable();
    const results = [];

    for (const targetIp of Array.from(activeIps)) {
      const mac = arpData[targetIp];
      const nameRes = await dns.reverse(targetIp).catch(() => []);
      const clientName = nameRes[0] || `Device-${targetIp.replace(/\./g, '-')}`;

      if (mac) {
        results.push({
          ip_address: targetIp,
          mac_address: mac,
          client_name: clientName
        });
      } else {
        // Fallback for remote/responsive devices without ARP entry
        results.push({
          ip_address: targetIp,
          mac_address: `IP-${targetIp}`,
          client_name: clientName
        });
      }
    }

    console.log(`[ScannerService] Found ${results.length} active clients.`);
    return results;
  } catch (error) {
    console.error('[ScannerService] Scan failed:', error);
    throw error;
  }
};

/**
 * Get ARP table as an object: { "IP": "MAC" }
 */
const getArpTable = () => {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'arp -a' : 'arp -a';
    exec(command, (error, stdout) => {
      if (error) {
        console.error('[ScannerService] ARP command failed:', error);
        return resolve({});
      }

      const arpMap = {};
      const lines = stdout.split('\n');
      
      // Regex for Mac: ? (172.21.223.158) at 0:50:56:8f:8b:2e on en0 ifscope [ethernet]
      const macRegex = /\(([\d\.]+)\) at ([a-f\d:]+)/i;
      // Regex for Linux: gateway (172.21.223.1) at b8:27:eb:11:22:33 [ether] on enp0s3
      const linuxRegex = /([\d\.]+)\s+at\s+([a-f\d:]+)/i;

      lines.forEach(line => {
        const match = line.match(macRegex) || line.match(linuxRegex);
        if (match) {
          const ip = match[1];
          const mac = match[2].split(':').map(part => part.padStart(2, '0')).join(':').toLowerCase();
          arpMap[ip] = mac;
        }
      });

      resolve(arpMap);
    });
  });
};

module.exports = {
  scanSubnet
};
