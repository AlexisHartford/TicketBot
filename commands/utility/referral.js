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
    .setName('referral')
    .setDescription('Refer a user, assign the referral role, and update referral count.')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('User to refer')
        .setRequired(true)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target');

    try {
      // Check if the command executor (referrer) has already used the referral command
      const [usageRows] = await db.execute(
        'SELECT * FROM referral_uses WHERE guild_id = ? AND referrer_id = ?',
        [interaction.guild.id, interaction.member.id]
      );
      if (usageRows.length > 0) {
        return interaction.reply('You have already used your referral command.');
      }

      // Retrieve the referral role from the ticket_settings table for this guild
      const [settingsRows] = await db.execute(
        'SELECT referral_role FROM ticket_settings WHERE guild_id = ?',
        [interaction.guild.id]
      );

      if (settingsRows.length === 0 || !settingsRows[0].referral_role) {
        return interaction.reply('Referral role is not set for this server. Please set it using /setreferralrole.');
      }

      const referralRoleId = settingsRows[0].referral_role;

      // Check if the user running the command has the referral role
      if (!interaction.member.roles.cache.has(referralRoleId)) {
        return interaction.reply("You don't have the required referral role to use this command.");
      }

      // Fetch the referral role from the guild
      const referralRole = interaction.guild.roles.cache.get(referralRoleId);
      if (!referralRole) {
        return interaction.reply('The referral role set in the database no longer exists.');
      }

      // Ensure the bot can manage (assign) the role
      const botMember = await interaction.guild.members.fetchMe();
      if (referralRole.position >= botMember.roles.highest.position) {
        return interaction.reply("I don't have permission to assign that role due to role hierarchy.");
      }

      // Add the referral role to the target user
      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      const userMember = await interaction.guild.members.fetch(interaction.user.id);

      // Update the referral count for the target user:
      // If they don't exist in the referrals table, insert them with a count of 1.
      // Otherwise, increment their referral_count by 1.
      await db.execute(
        'INSERT INTO referrals (guild_id, user_id, referral_count) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE referral_count = referral_count + 1',
        [interaction.guild.id, targetUser.id]
      );

      // Record that the referrer has used the referral command
      await db.execute(
        'INSERT INTO referral_uses (guild_id, referrer_id) VALUES (?, ?)',
        [interaction.guild.id, interaction.member.id]
      );

      await interaction.reply(`${userMember} has been referred By ${targetMember}.`);
    } catch (error) {
      console.error('Error executing referral:', error);
      await interaction.reply('An error occurred while processing the referral.');
    }
  },
};
