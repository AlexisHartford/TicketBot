const { SlashCommandBuilder } = require('discord.js');
const mysql = require('mysql2/promise');
const config = require('../../config'); // Adjust the path as necessary

// Create a pool using your configuration
const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setreferralrole')
    .setDescription('Set or update the referral role for this server.')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to set as referral role')
        .setRequired(true)
    ),
  async execute(interaction) {
    const role = interaction.options.getRole('role');

    // Check if the command executor has administrator permissions
    if (!interaction.member.permissions.has('ADMINISTRATOR')) {
      return interaction.reply("You don't have permission to use this command.");
    }

    try {
      // Check if a record for this guild already exists
      const [rows] = await db.execute(
        'SELECT guild_id FROM ticket_settings WHERE guild_id = ?',
        [interaction.guild.id]
      );

      if (rows.length === 0) {
        // Insert a new record if none exists
        await db.execute(
          'INSERT INTO ticket_settings (guild_id, referral_role) VALUES (?, ?)',
          [interaction.guild.id, role.id]
        );
      } else {
        // Update the existing record
        await db.execute(
          'UPDATE ticket_settings SET referral_role = ? WHERE guild_id = ?',
          [role.id, interaction.guild.id]
        );
      }
      await interaction.reply(`Referral role has been set to ${role}.`);
    } catch (error) {
      console.error('Error executing setreferralrole:', error);
      await interaction.reply('An error occurred while setting the referral role.');
    }
  },
};
