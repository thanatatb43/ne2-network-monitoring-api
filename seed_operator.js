const { User } = require('./src/models');

async function createOperatorUser() {
  try {
    console.log('Creating operator user...');
    
    // Check if user already exists
    const existingUser = await User.findOne({ where: { username: 'operator' } });
    if (existingUser) {
      console.log('User "operator" already exists. Updating password and role...');
      existingUser.password_hash = 'operator'; // The beforeSave hook will hash it
      existingUser.role = 'operator';
      await existingUser.save();
    } else {
      await User.create({
        username: 'operator',
        password_hash: 'operator', // The beforeSave hook will hash it
        role: 'operator',
        first_name: 'System',
        last_name: 'Operator'
      });
      console.log('User "operator" created successfully.');
    }
  } catch (error) {
    console.error('Failed to create operator user:', error);
  } finally {
    process.exit();
  }
}

createOperatorUser();
