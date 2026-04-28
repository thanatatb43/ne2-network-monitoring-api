const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
  class User extends Model {
    /**
     * Helper method to compare password for login
     */
    async comparePassword(candidatePassword) {
      return bcrypt.compare(candidatePassword, this.password_hash);
    }

    static associate(models) {
      User.hasMany(models.SpeedTestLog, { foreignKey: 'user_id', as: 'speedTests' });
    }
  }

  User.init({
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    password_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('user', 'computer_admin', 'network_admin', 'super_admin', 'manager', 'operator'),
      allowNull: false,
      defaultValue: 'user'
    },
    first_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    last_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pea_branch: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pea_division: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'User',
    hooks: {
      beforeSave: async (user) => {
        if (user.changed('password_hash')) {
          const salt = await bcrypt.genSalt(10);
          user.password_hash = await bcrypt.hash(user.password_hash, salt);
        }
      }
    }
  });

  return User;
};
