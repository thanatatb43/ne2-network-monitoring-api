'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PeaSiteAbbreviations', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      // Unit prefix the abbreviation is written under: กฟจ / กฟส / สฟฟ / กฟฟ / กฟอ
      site_type: {
        type: Sequelize.STRING,
        allowNull: false
      },
      // The abbreviation itself, including any sequence suffix that distinguishes
      // several sites in the same town (e.g. "สรธ", "มห.1", "อบ.6(ช)")
      abbr: {
        type: Sequelize.STRING,
        allowNull: false
      },
      pea_site_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      // How this pairing was established, so a later reviewer knows how much to trust it
      source: {
        type: Sequelize.STRING,
        allowNull: true
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
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

    await queryInterface.addIndex('PeaSiteAbbreviations', ['pea_site_id']);
    await queryInterface.addIndex('PeaSiteAbbreviations', ['abbr']);
    await queryInterface.addIndex('PeaSiteAbbreviations', ['site_type', 'abbr'], {
      unique: true,
      name: 'pea_site_abbreviations_type_abbr_unique'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('PeaSiteAbbreviations');
  }
};
