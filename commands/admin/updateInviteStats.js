const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const mysql = require("mysql2/promise");
const config = require("../../config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updateinvitestats')
    .setDescription('Retroactively update invite stats for active invites (Admin only).'),
  async execute(interaction) {
    // Only allow administrators to run this command
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
    }
    
    // Create a MySQL pool (consider sharing a single pool globally)
    const db = mysql.createPool({
      host: config.mysql.host,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    
    try {
      // Fetch all active invites for the guild
      const invites = await interaction.guild.invites.fetch();
      
      // Group invites by inviter and sum their use counts,
      // but skip any inviter whose tag starts with "deleted_user_"
      const inviterStats = {};
      invites.forEach(invite => {
        if (invite.inviter && !invite.inviter.tag.startsWith("deleted_user_")) {
          const inviterId = invite.inviter.id;
          if (!inviterStats[inviterId]) {
            inviterStats[inviterId] = { total: 0, tag: invite.inviter.tag };
          }
          inviterStats[inviterId].total += invite.uses;
        }
      });
      
      let updatedCount = 0;
      for (const inviterId in inviterStats) {
        const { total, tag } = inviterStats[inviterId];
        await db.query(
          `INSERT INTO invite_stats (guild_id, inviter_id, inviter_tag, total_uses)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE total_uses = ?`,
          [interaction.guild.id, inviterId, tag, total, total]
        );
        updatedCount++;
      }
      
      return interaction.reply({ content: `Updated invite stats for ${updatedCount} inviter(s).`, ephemeral: true });
    } catch (error) {
      console.error("Error updating invite stats:", error);
      return interaction.reply({ content: "There was an error updating invite stats. Please try again later.", ephemeral: true });
    }
  }
};
