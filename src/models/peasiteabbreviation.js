'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  /**
   * Maps the abbreviations used inside OfficeEquipment.department strings
   * (e.g. "ผบง.กฟส.สรธ.-บริหาร") to the PEA site they actually refer to, so an
   * import can resolve or verify a site instead of guessing from the text.
   */
  class PeaSiteAbbreviation extends Model {
    static associate(models) {
      PeaSiteAbbreviation.belongsTo(models.PeaSite, {
        foreignKey: 'pea_site_id',
        as: 'pea_site'
      });

      if (models.PeaSite) {
        models.PeaSite.hasMany(PeaSiteAbbreviation, {
          foreignKey: 'pea_site_id',
          as: 'abbreviations'
        });
      }
    }
  }

  PeaSiteAbbreviation.init({
    // Unit prefix the abbreviation is written under: กฟจ / กฟส / สฟฟ / กฟฟ / กฟอ
    site_type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // The abbreviation itself, including any sequence suffix that distinguishes
    // several sites in the same town (e.g. "สรธ", "มห.1", "อบ.6(ช)")
    abbr: {
      type: DataTypes.STRING,
      allowNull: false
    },
    pea_site_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'PeaSiteAbbreviation',
    tableName: 'PeaSiteAbbreviations',
    timestamps: true
  });

  return PeaSiteAbbreviation;
};
