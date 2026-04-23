const testFetch = async () => {
  try {
    console.log('Testing connectivity to google.com...');
    const response = await fetch('https://www.google.com');
    console.log('Response status:', response.status);
  } catch (err) {
    console.error('Fetch to google.com failed:', err.message);
  }
};

testFetch();
