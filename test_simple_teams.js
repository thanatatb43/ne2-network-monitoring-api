const https = require('https');
const { URL } = require('url');

const simpleTest = async () => {
  const webhookUrl = "https://defaulteda31a319b9748a88bd8d0897333bb.db.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/c35dd9dd6ff34cc5beca3819ecf9b114/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=XVcwTrJO7DYpwo2npV_gvkS43j8Xp-IDmCsKYQBuNRw";
  const url = new URL(webhookUrl);
  const data = JSON.stringify({ text: "Test from Node.js simple script" });

  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    },
    rejectUnauthorized: false
  };

  const req = https.request(options, (res) => {
    console.log('Status:', res.statusCode);
    res.on('data', (d) => process.stdout.write(d));
  });

  req.on('error', (e) => console.error('Error:', e.message));
  req.write(data);
  req.end();
};

simpleTest();
