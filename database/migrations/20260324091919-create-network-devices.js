'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('network_devices', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      index: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      pea_type: {
        type: Sequelize.STRING
      },
      pea_name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      province: {
        type: Sequelize.STRING
      },
      web: {
        type: Sequelize.STRING
      },
      gateway: {
        type: Sequelize.STRING
      },
      dhcp: {
        type: Sequelize.STRING
      },
      network_id: {
        type: Sequelize.STRING
      },
      subnet: {
        type: Sequelize.STRING
      },
      sub_ip1_gateway: {
        type: Sequelize.STRING
      },
      sub_ip1_subnet: {
        type: Sequelize.STRING
      },
      sub_ip2_gateway: {
        type: Sequelize.STRING
      },
      sub_ip2_subnet: {
        type: Sequelize.STRING
      },
      wan_gateway_mpls: {
        type: Sequelize.STRING
      },
      wan_ip_fgt: {
        type: Sequelize.STRING
      },
      vpn_main: {
        type: Sequelize.STRING
      },
      vpn_backup: {
        type: Sequelize.STRING
      },
      gateway_backup: {
        type: Sequelize.STRING
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('network_devices', ['pea_name']);
    await queryInterface.addIndex('network_devices', ['province']);
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('network_devices');
  }
};